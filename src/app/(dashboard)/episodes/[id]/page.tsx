import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/auto-refresh";
import { StatusBadge } from "@/components/status-badge";
import { WorkflowTabs } from "@/components/workflow-steps";
import { requireSession } from "@/lib/auth";
import { formatDateTime, formatElapsed } from "@/lib/format";
import { dispatchAvailability } from "@/lib/github";
import { listAssets } from "@/pipeline/assets";
import { attributionText, hasShareAlike } from "@/pipeline/clips/attribution";
import { canFillScenes, descriptionWithCredits, sceneClips } from "@/pipeline/clips/episode";
import { canPick, listPicks, PICK_COUNT } from "@/pipeline/clips/picks";
import { isSelectable } from "@/pipeline/clips/select";
import { episodeCollection, isJobBusy, listAdoptedClips, listClips } from "@/pipeline/clips/store";
import { getEpisode } from "@/pipeline/episodes";
import { latestScript, scriptCostTotal } from "@/pipeline/scripts";
import { getSettings } from "@/pipeline/settings";
import { formatUsd } from "@/pipeline/script/pricing";
import { isBusy, STEP_LABELS, STEP_STATE_LABELS, STEP_TYPICAL_DURATION } from "@/pipeline/status";
import { estimateSceneCredits, scenesDone } from "@/pipeline/steps/render";
import { studioUrl, watchUrl } from "@/pipeline/youtube/links";
import { buildUploadText, hasAiScenes } from "@/pipeline/youtube/metadata";
import { isStale, runnableStep } from "@/pipeline/trigger";
import { isStage, ROUTE_LABELS, ROUTE_STAGES, STAGE_LABELS, STEP_STAGE, workflow, type Stage } from "@/pipeline/workflow";
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
import { ClipMedia, ClipMeta } from "../../clips/clip-card";
import { AdoptButton, RetryCollectButton } from "../../clips/clip-forms";
import { PickForm } from "./pick-form";
import { RunStepButton } from "./run-step-button";
import { NarrationPanel } from "./narration-panel";
import { ScenesPanel } from "./scenes-panel";
import { UploadKit } from "./upload-kit";
import { VideoReview } from "./video-review";
import { ScriptReview } from "./script-review";

export const dynamic = "force-dynamic";

// 지금 단계에서 사람이 할 일. 단계가 도는 중이거나 실패했으면 그 안내가 대신 나온다.
const NEXT_ACTION: Record<Stage, string> = {
  clips: "찾은 영상에서 장면 4개를 고르고 영상 컨셉·목차를 적으세요.",
  script: "대본을 검토하고 승인하거나 반려하세요.",
  voice: "목소리를 골라 내레이션을 만드세요.",
  scenes: "장면을 만들거나 무료 클립으로 채우세요.",
  video: "영상을 합성하고, 휴대폰으로 확인한 뒤 승인하세요.",
  upload: 'YouTube 앱에서 직접 올리고 "올렸어요" 를 누르세요.',
};

export default async function EpisodePage({ params, searchParams }: PageProps<"/episodes/[id]">) {
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
  const missingScenes = script ? script.scenes.filter((scene) => !scenes.has(scene.no)) : [];
  const renderEstimate = estimateSceneCredits(missingScenes);
  const finalVideo = assets.find((asset) => asset.kind === "final" && asset.url);
  const canFill = Boolean(script) && canFillScenes(episode);
  const clips = await sceneClips(scenes);

  // 영상 먼저 찾기(clips 길): 이 에피소드에서 찾은 영상과 장면에 고른 클립.
  const byClips = episode.route === "clips";
  const collection = byClips ? await episodeCollection(episode.id) : null;
  const [found, picks] = collection
    ? await Promise.all([listClips(collection.id), listPicks(episode.id)])
    : [[], []];
  const searching = collection ? isJobBusy(collection.status, collection.updatedAt) : false;
  const adopting = collection ? isJobBusy(collection.adoptStatus, collection.updatedAt) : false;
  const picked = picks.length === PICK_COUNT;

  const busy = isBusy(episode);
  const stale = isStale(episode);
  // clips 길: 클립을 고르기 전에는 대본을, 장면이 다 채워지기 전에는 합성을 시작할 수 없다.
  const nextStep = runnableStep(episode);
  const step =
    byClips && ((nextStep === "script" && !picked) || (nextStep === "compose" && missingScenes.length > 0))
      ? null
      : nextStep;
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

  const flow = workflow(episode, {
    hasNarration: narrationAssets.some((asset) => asset.url),
    scenesLeft: missingScenes.length,
    picked,
    search: searching ? "busy" : collection && collection.status !== "done" ? "failed" : null,
  });
  const tabParam = (await searchParams).tab;
  const tab: Stage = isStage(tabParam) && ROUTE_STAGES[episode.route].includes(tabParam) ? tabParam : flow.current;
  const stepTab = step ? STEP_STAGE[step] : null;
  const tabHref = (stage: Stage) => `/episodes/${episode.id}?tab=${stage}`;

  // 단계 시작 버튼은 그 단계의 탭에 둔다.
  const runButton =
    step && buttonLabel ? (
      <div className="stack">
        <RunStepButton id={episode.id} step={step} label={buttonLabel} disabled={!canDispatch} />
        {!availability.ok ? (
          <p className="warn small">
            {STEP_LABELS[step]} 단계는 시작되지 않았습니다. {availability.reason}
          </p>
        ) : null}
      </div>
    ) : null;

  return (
    <>
      <AutoRefresh active={(busy && !stale) || searching || adopting} />
      <Link href="/" className="back">
        ← 에피소드 목록
      </Link>
      <div className="row between episode-head">
        <h1>
          <span className="muted">#{episode.id}</span> {episode.topic}
        </h1>
        <StatusBadge episode={episode} />
      </div>
      <p className="muted small route-label">{byClips ? "🎬" : "✍️"} {ROUTE_LABELS[episode.route]}</p>

      <WorkflowTabs episodeId={episode.id} flow={flow} active={tab} />

      <div className={`now now-${flow.activity ?? "done"}`}>
        {busy && !stale && episode.step && episode.stepState ? (
          <>
            <p className="now-title">
              {STEP_LABELS[episode.step]} {STEP_STATE_LABELS[episode.stepState]}
              {elapsed ? <span className="muted small"> · {elapsed} 경과</span> : null}
            </p>
            <p>
              {episode.stepState === "pending"
                ? "GitHub Actions 가 작업을 받기를 기다리는 중입니다. 보통 30초 안에 시작합니다."
                : (episode.stepProgress ?? "작업을 시작했습니다.")}
            </p>
            <p className="muted small">
              보통 {STEP_TYPICAL_DURATION[episode.step]} 걸립니다. 이 화면은 5초마다 자동으로 새로 고칩니다.
            </p>
          </>
        ) : flow.current === "clips" && searching ? (
          <>
            <p className="now-title">영상을 찾는 중입니다</p>
            <p className="muted small">보통 1분 안에 끝납니다. 이 화면은 5초마다 자동으로 새로 고칩니다.</p>
          </>
        ) : flow.current === "clips" && flow.activity === "failed" ? (
          <>
            <p className="now-title">영상 찾기가 끝나지 않았습니다. 다시 시도하세요.</p>
            {collection?.error ? <p className="error prewrap small">{collection.error}</p> : null}
          </>
        ) : stale ? (
          <p className="error">응답이 없습니다. Actions 가 멈췄을 수 있습니다. 다시 시도하세요.</p>
        ) : flow.activity === null ? (
          <p className="now-title">🎉 모든 단계가 끝났습니다.</p>
        ) : (
          <p className="now-title">
            {flow.activity === "failed" && episode.step ? `${STEP_LABELS[episode.step]}에 실패했습니다. ` : ""}
            {flow.activity === "failed" ? "다시 시도하세요." : NEXT_ACTION[flow.current]}
          </p>
        )}
        {episode.error ? <p className="error prewrap small">{episode.error}</p> : null}
        {tab !== flow.current && flow.activity ? (
          <Link href={tabHref(flow.current)} scroll={false} className="button small-button">
            {STAGE_LABELS[flow.current]} 단계로 가기 →
          </Link>
        ) : null}
      </div>

      <div className="tab-panel">
        {tab === "clips" ? (
          !collection ? (
            <Empty>영상 찾기 기록이 없습니다.</Empty>
          ) : collection.status !== "done" ? (
            searching ? (
              <Empty>무료 영상 소스에서 찾는 중입니다…</Empty>
            ) : (
              <section className="stack">
                <RetryCollectButton id={collection.id} />
              </section>
            )
          ) : canPick(episode) ? (
            <>
              <p className="muted small">
                검색어: {collection.keywords.join(", ")} · <Link href={`/clips/${collection.id}`}>찾은 결과 자세히</Link>
              </p>
              {collection.shortfall ? <p className="warn small">{collection.shortfall}</p> : null}
              <PickForm
                episodeId={episode.id}
                clips={found.filter(isSelectable)}
                picked={picks.map((clip) => clip.id)}
                sceneCount={PICK_COUNT}
                {...splitOutline(episode.outline)}
                disabled={!canDispatch}
              />
            </>
          ) : (
            <section>
              <h2>고른 클립</h2>
              <ol className="scenes">
                {picks.map((clip, index) => (
                  <li key={clip.id}>
                    <strong className="small">장면 {index + 1}</strong>
                    <ClipMeta clip={clip} />
                    <ClipMedia clip={clip} />
                  </li>
                ))}
              </ol>
              <p className="muted small">대본을 반려하면 클립을 다시 고를 수 있습니다.</p>
            </section>
          )
        ) : null}

        {tab === "script" ? (
          <>
            {episode.outline ? (
              <section>
                <h2>목차</h2>
                <p className="prewrap">{episode.outline}</p>
              </section>
            ) : null}
            {stepTab === "script" ? runButton : null}
            {script ? (
              <ScriptReview script={script} reviewing={episode.status === "script_review" && !busy} />
            ) : byClips && !picked ? (
              <Empty>영상 찾기에서 장면 클립을 고르면 대본을 만듭니다.</Empty>
            ) : (
              <Empty>대본을 만들면 여기에 나옵니다.</Empty>
            )}
            {scriptCosts.runs ? (
              <p className="muted small">
                대본 생성 비용: 약 {formatUsd(scriptCosts.total)} ({scriptCosts.runs}회 생성
                {scriptCosts.unknown ? `, 그중 ${scriptCosts.unknown}회는 단가를 몰라 빠짐` : ""}
                {scriptCosts.runs > 1 ? " 합계" : ""})
              </p>
            ) : null}
          </>
        ) : null}

        {tab === "voice" ? (
          <>
            {stepTab === "voice" ? runButton : null}
            {showNarration ? (
              <NarrationPanel
                episodeId={episode.id}
                voices={VOICES.map((voice) => ({
                  id: voice.id,
                  label: voiceLabel(voice),
                }))}
                models={VOICE_MODELS.map((model) => ({
                  id: model.id,
                  label: model.label,
                }))}
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
            ) : (
              <Empty>대본을 승인하면 목소리를 골라 내레이션을 만들 수 있습니다.</Empty>
            )}
          </>
        ) : null}

        {tab === "scenes" ? (
          <>
            {stepTab === "scenes" ? (
              <>
                {runButton}
                <p className="muted small">
                  남은 장면 {missingScenes.length}개 · 약 {renderEstimate}크레딧(추천 모델 기준) · 이미
                  만든 장면은 다시 만들지 않습니다.
                </p>
              </>
            ) : null}
            {script && (scenes.size > 0 || episode.status === "rendering" || canFill) ? (
              <ScenesPanel
                episodeId={episode.id}
                scenes={script.scenes}
                done={scenes}
                adopted={canFill ? await listAdoptedClips() : []}
                canFill={canFill}
              />
            ) : (
              <Empty>대본을 승인하면 장면을 만들거나 무료 클립으로 채울 수 있습니다.</Empty>
            )}
            {clips.length > 0 && script ? (
              <section className="stack">
                <h2>영상 출처</h2>
                <p className="muted small">장면에 쓴 무료 클립의 출처입니다. 업로드할 때 설명란 끝에 붙습니다.</p>
                {hasShareAlike(clips) ? (
                  <p className="callout warn-box">
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
          </>
        ) : null}

        {tab === "video" ? (
          <>
            {byClips && script && missingScenes.length > 0 && canFill ? (
              <section className="stack">
                <p className="small">
                  고른 클립을 저장하는 중입니다. 저장이 끝나면 장면에 들어가고 합성할 수 있습니다(남은 장면 {missingScenes.length}개).
                </p>
                {collection?.adoptError && !adopting ? <p className="error prewrap small">{collection.adoptError}</p> : null}
                {collection && !adopting ? (
                  <AdoptButton id={collection.id} label="클립 저장 다시 시도" disabled={!canDispatch} />
                ) : null}
              </section>
            ) : null}
            {stepTab === "video" ? runButton : null}
            {step === "compose" && !narrationAssets.length ? (
              <p className="warn small">
                내레이션이 없습니다. <Link href={tabHref("voice")}>내레이션</Link>을 먼저 만드세요.
              </p>
            ) : null}
            {byClips && script && (scenes.size > 0 || canFill) ? (
              <ScenesPanel
                episodeId={episode.id}
                scenes={script.scenes}
                done={scenes}
                adopted={canFill ? await listAdoptedClips() : []}
                canFill={canFill}
              />
            ) : null}
            {finalVideo?.url ? (
              <VideoReview
                episodeId={episode.id}
                url={finalVideo.url}
                caption={`${Number(finalVideo.meta.seconds ?? 0).toFixed(1)}초 · 목소리 ${String(finalVideo.meta.voiceName ?? "알 수 없음")} · ${formatDateTime(finalVideo.createdAt)} 합성`}
                reviewing={episode.status === "video_review" && !busy}
              />
            ) : (
              <Empty>장면과 내레이션이 준비되면 영상을 합성합니다(크레딧 없음).</Empty>
            )}
          </>
        ) : null}

        {tab === "upload" ? (
          <>
            {episode.youtubeVideoId ? (
              <section>
                <h2>올린 영상</h2>
                <p className="row">
                  <a href={watchUrl(episode.youtubeVideoId)} target="_blank" rel="noreferrer" className="button">
                    유튜브에서 보기
                  </a>
                  <a href={studioUrl(episode.youtubeVideoId)} target="_blank" rel="noreferrer">
                    YouTube Studio
                  </a>
                </p>
              </section>
            ) : null}
            {finalVideo?.url && script && (episode.status === "ready" || episode.status === "uploaded") ? (
              <UploadKit
                episodeId={episode.id}
                downloadUrl={`${finalVideo.url}?download=1`}
                {...buildUploadText(script, clips, hasAiScenes(scenes))}
                canMark={episode.status === "ready" && !busy}
              />
            ) : (
              <Empty>영상을 승인하면 업로드에 필요한 영상·제목·설명·태그가 여기에 준비됩니다.</Empty>
            )}
          </>
        ) : null}
      </div>

      <p className="muted small meta">
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
    </>
  );
}

/** clips 길에서 적은 "컨셉: …" 과 목차를 나눈다(다시 고를 때 채워 두기 위해). */
function splitOutline(outline: string): { concept: string; outline: string } {
  const match = /^컨셉: (.*)(?:\n\n([\s\S]*))?$/.exec(outline);
  return match ? { concept: match[1], outline: match[2] ?? "" } : { concept: "", outline };
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="empty muted">{children}</p>;
}
