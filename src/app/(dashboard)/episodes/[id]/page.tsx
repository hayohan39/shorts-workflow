import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/auto-refresh";
import { StatusBadge } from "@/components/status-badge";
import { requireSession } from "@/lib/auth";
import { formatDateTime, formatElapsed } from "@/lib/format";
import { dispatchAvailability } from "@/lib/github";
import { getEpisode } from "@/pipeline/episodes";
import { latestScript, scriptCostTotal } from "@/pipeline/scripts";
import { formatUsd } from "@/pipeline/script/pricing";
import { isBusy, STEP_LABELS, STEP_STATE_LABELS, STEP_TYPICAL_DURATION, type Status } from "@/pipeline/status";
import { isStale, runnableStep } from "@/pipeline/trigger";
import { RunStepButton } from "./run-step-button";
import { ScriptReview } from "./script-review";

export const dynamic = "force-dynamic";

// 사람이 볼 차례인 상태의 안내. 검토 화면은 이후 업데이트에서 이 자리에 들어온다.
const WAITING_FOR_PERSON: Partial<Record<Status, string>> = {
  script_review: "아래 대본을 검토하고 승인하거나 반려하세요.",
  approved: "장면·음성 생성은 다음 업데이트에서 추가됩니다.",
  video_review: "영상 검토 화면은 다음 업데이트에서 추가됩니다.",
  ready: "유튜브 업로드 버튼은 다음 업데이트에서 추가됩니다.",
  uploaded: "업로드가 끝났습니다.",
};

export default async function EpisodePage({ params }: PageProps<"/episodes/[id]">) {
  await requireSession();
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const [episode, script, scriptCosts] = await Promise.all([getEpisode(id), latestScript(id), scriptCostTotal(id)]);
  if (!episode) notFound();

  const busy = isBusy(episode);
  const stale = isStale(episode);
  const step = runnableStep(episode);
  const availability = dispatchAvailability();
  const canDispatch = availability.ok;
  const buttonLabel = step
    ? episode.status === "failed" || stale
      ? `${STEP_LABELS[step]} 다시 시도`
      : `${STEP_LABELS[step]} 시작`
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
        {step && !availability.ok ? (
          <p className="warn small">
            {STEP_LABELS[step]} 단계는 시작되지 않았습니다. {availability.reason}
          </p>
        ) : null}
        {!busy && !step && WAITING_FOR_PERSON[episode.status] ? (
          <p className="muted">{WAITING_FOR_PERSON[episode.status]}</p>
        ) : null}
      </section>

      {script ? <ScriptReview script={script} reviewing={episode.status === "script_review" && !busy} /> : null}
    </>
  );
}
