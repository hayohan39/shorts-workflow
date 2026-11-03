import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/auto-refresh";
import { StatusBadge } from "@/components/status-badge";
import { requireSession } from "@/lib/auth";
import { formatDateTime, formatElapsed } from "@/lib/format";
import { dispatchAvailability } from "@/lib/github";
import { listAssets } from "@/pipeline/assets";
import { attributionText, hasShareAlike } from "@/pipeline/clips/attribution";
import { canFillScenes, descriptionWithCredits, sceneClips } from "@/pipeline/clips/episode";
import { listAdoptedClips } from "@/pipeline/clips/store";
import { getEpisode } from "@/pipeline/episodes";
import { latestScript, scriptCostTotal } from "@/pipeline/scripts";
import { getSettings } from "@/pipeline/settings";
import { formatUsd } from "@/pipeline/script/pricing";
import { isBusy, STEP_LABELS, STEP_STATE_LABELS, STEP_TYPICAL_DURATION, type Status } from "@/pipeline/status";
import { estimateSceneCredits, scenesDone } from "@/pipeline/steps/render";
import { isStale, runnableStep } from "@/pipeline/trigger";
import {
  DEFAULT_VOICE_ID,
  DEFAULT_VOICE_MODEL,
  findVoice,
  isVoiceModel,
  NARRATION_CREDITS,
  VOICE_MODELS,
  VOICES,
  voiceLabel,
} from "@/pipeline/voices";
import { RunStepButton } from "./run-step-button";
import { NarrationPanel } from "./narration-panel";
import { ScenesPanel } from "./scenes-panel";
import { VideoReview } from "./video-review";
import { ScriptReview } from "./script-review";

export const dynamic = "force-dynamic";

// 사람이 볼 차례인 상태의 안내. 검토 화면은 이후 업데이트에서 이 자리에 들어온다.
const WAITING_FOR_PERSON: Partial<Record<Status, string>> = {
  script_review: "아래 대본을 검토하고 승인하거나 반려하세요.",
  approved: "목소리를 골라 내레이션을 만들고 장면 생성을 시작하세요.",
  rendering: "장면이 준비됐습니다. 내레이션을 확인하고 영상 합성을 시작하세요.",
  video_review: "아래 완성 영상을 확인하고 승인하세요. 내레이션을 바꿨으면 다시 합성하세요.",
  ready: "유튜브 업로드 버튼은 다음 업데이트에서 추가됩니다.",
  uploaded: "업로드가 끝났습니다.",
};

export default async function EpisodePage({ params }: PageProps<"/episodes/[id]">) {
  await requireSession();
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const [episode, script, scriptCosts, assets, settings] = await Promise.all([
    getEpisode(id),
    latestScript(id),
    scriptCostTotal(id),
    listAssets(id),
    getSettings(),
  ]);
  if (!episode) notFound();
  const narrationAssets = assets.filter((asset) => asset.kind === "voice");
  const scenes = script ? scenesDone(assets, script.version) : new Map();
  const renderEstimate = script ? estimateSceneCredits(script.scenes.filter((scene) => !scenes.has(scene.no))) : 0;
  const finalVideo = assets.find((asset) => asset.kind === "final" && asset.url);
  const canFill = Boolean(script) && canFillScenes(episode);
  const clips = await sceneClips(scenes);

  const busy = isBusy(episode);
  const stale = isStale(episode);
  const step = runnableStep(episode);
  const availability = dispatchAvailability();
  const canDispatch = availability.ok;
  const buttonLabel = step
    ? episode.status === "failed" || stale
      ? `${STEP_LABELS[step]} 다시 시도`
      : step === "compose" && episode.status === "video_review"
        ? "다시 합성 (크레딧 없음)"
        : `${STEP_LABELS[step]} 시작${step === "compose" ? " (크레딧 없음)" : ""}`
    : null;

  // 내레이션: 대본 승인 뒤·장면 생성 뒤(또는 내레이션 생성이 실패한 뒤) 만들 수 있다.
  const narrationOpen =
    episode.status === "approved" ||
    episode.status === "rendering" ||
    episode.status === "video_review" ||
    (episode.status === "failed" && episode.step === "voice");
  const showNarration = !!script && (narrationOpen || narrationAssets.length > 0);
  const lastVoiceId = typeof narrationAssets[0]?.meta.voiceId === "string" ? narrationAssets[0].meta.voiceId : null;
  const defaultVoiceId =
    findVoice(episode.voiceId)?.id ?? findVoice(lastVoiceId)?.id ?? findVoice(settings.voice)?.id ?? DEFAULT_VOICE_ID;
  const defaultVoiceModel = [episode.voiceModel, settings.voiceModel].find(isVoiceModel) ?? DEFAULT_VOICE_MODEL;
  const narrationBlocked = !availability.ok
    ? availability.reason
    : busy
      ? "진행 중인 단계가 끝난 뒤에 만들 수 있습니다."
      : !narrationOpen
        ? "대본 승인 뒤, 영상 승인 전까지만 만들 수 있습니다."
        : null;

  const elapsed = busy && episode.stepStartedAt ? formatElapsed(episode.stepStartedAt) : null;

  return (
    <>
      <AutoRefresh active={busy && !stale} />
      <Link href="/" className="back">
        ← 에피소드 목록
      </Link>
      <div className="row between">
        <h1>
          #{episode.id} {episode.topic}
        </h1>
        <StatusBadge episode={episode} />
      </div>

      {episode.outline ? (
        <section>
          <h2>목차</h2>
          <p className="prewrap">{episode.outline}</p>
        </section>
      ) : null}

      <section>
        <h2>진행</h2>
        {episode.step && episode.stepState ? (
          <>
            <p>
              {STEP_LABELS[episode.step]}: <strong>{STEP_STATE_LABELS[episode.stepState]}</strong>
              {elapsed ? ` · ${elapsed} 경과` : ""}
            </p>
            {busy && !stale ? (
              <div className="progress">
                <p>
                  {episode.stepState === "pending"
                    ? "GitHub Actions 가 작업을 받기를 기다리는 중입니다. 보통 30초 안에 시작합니다."
                    : (episode.stepProgress ?? "작업을 시작했습니다.")}
                </p>
                <p className="muted small">
                  보통 {STEP_TYPICAL_DURATION[episode.step]} 걸립니다. 이 화면은
                  5초마다 자동으로 새로 고칩니다.
                </p>
              </div>
            ) : null}
          </>
        ) : (
          <p className="muted">아직 실행한 단계가 없습니다.</p>
        )}
        {scriptCosts.runs ? (
          <p className="small">
            대본 생성 비용: 약 {formatUsd(scriptCosts.total)} ({scriptCosts.runs}회 생성
            {scriptCosts.unknown ? `, 그중 ${scriptCosts.unknown}회는 단가를 몰라 빠짐` : ""}
            {scriptCosts.runs > 1 ? " 합계" : ""})
          </p>
        ) : null}
        {stale ? <p className="error">응답이 없습니다. Actions 가 멈췄을 수 있습니다. 다시 시도하세요.</p> : null}
        {episode.error ? <p className="error prewrap">{episode.error}</p> : null}
        <p className="muted small">
          만든 시각 {formatDateTime(episode.createdAt)} · 마지막 변경 {formatDateTime(episode.updatedAt)}
          {episode.runUrl ? (
            <>
              {" · "}
              <a href={episode.runUrl} target="_blank" rel="noreferrer">
                실행 기록
              </a>
            </>
          ) : null}
        </p>
        {step && buttonLabel ? (
          <RunStepButton id={episode.id} step={step} label={buttonLabel} disabled={!canDispatch} />
        ) : null}
        {step === "compose" && !narrationAssets.length ? (
          <p className="warn small">내레이션이 없습니다. 아래에서 내레이션을 먼저 만드세요.</p>
        ) : null}
        {step === "render" ? (
          <p className="muted small">
            남은 장면 {script ? script.scenes.length - scenes.size : 0}개 · 약 {renderEstimate}크레딧(추천 모델 기준) · 이미 만든 장면은
            다시 만들지 않습니다.
          </p>
        ) : null}
        {step && !availability.ok ? (
          <p className="warn small">
            {STEP_LABELS[step]} 단계는 시작되지 않았습니다. {availability.reason}
          </p>
        ) : null}
        {!busy && !step && WAITING_FOR_PERSON[episode.status] ? (
          <p className="muted">{WAITING_FOR_PERSON[episode.status]}</p>
        ) : null}
      </section>

      {finalVideo?.url ? (
        <VideoReview
          episodeId={episode.id}
          url={finalVideo.url}
          caption={`${Number(finalVideo.meta.seconds ?? 0).toFixed(1)}초 · 목소리 ${String(finalVideo.meta.voiceName ?? "알 수 없음")} · ${formatDateTime(finalVideo.createdAt)} 합성`}
          reviewing={episode.status === "video_review" && !busy}
        />
      ) : null}

      {showNarration ? (
        <NarrationPanel
          episodeId={episode.id}
          voices={VOICES.map((voice) => ({ id: voice.id, label: voiceLabel(voice) }))}
          models={VOICE_MODELS.map((model) => ({ id: model.id, label: model.label }))}
          defaultVoiceId={defaultVoiceId}
          defaultModel={defaultVoiceModel}
          narrations={narrationAssets
            .filter((asset) => asset.url)
            .map((asset) => ({
              id: asset.id,
              url: asset.url!,
              voiceName: String(asset.meta.voiceName ?? "알 수 없음"),
              voiceModel: asset.model ?? "",
              credits: asset.credits,
              createdAt: formatDateTime(asset.createdAt),
            }))}
          canRun={narrationBlocked === null}
          blockedReason={narrationBlocked}
          creditsPerRun={NARRATION_CREDITS}
        />
      ) : null}

      {clips.length > 0 && script ? (
        <section className="stack">
          <h2>영상 출처</h2>
          <p className="muted small">장면에 쓴 무료 클립의 출처입니다. 업로드할 때 설명란 끝에 붙습니다.</p>
          {hasShareAlike(clips) ? (
            <p className="warn-box">
              CC BY-SA(동일조건) 클립이 있습니다. 이 영상도 같은 조건으로 공개해야 한다는 해석이 있으니, 원치 않으면 장면을
              바꾸세요.
            </p>
          ) : null}
          <pre className="raw prewrap">{attributionText(clips)}</pre>
          <details>
            <summary>설명란 미리보기 (출처 포함)</summary>
            <pre className="raw prewrap">{descriptionWithCredits(script.description, clips)}</pre>
          </details>
        </section>
      ) : null}

      {script && (scenes.size > 0 || episode.status === "rendering" || canFill) ? (
        <ScenesPanel
          episodeId={episode.id}
          scenes={script.scenes}
          done={scenes}
          adopted={canFill ? await listAdoptedClips() : []}
          canFill={canFill}
        />
      ) : null}

      {script ? <ScriptReview script={script} reviewing={episode.status === "script_review" && !busy} /> : null}
    </>
  );
}
