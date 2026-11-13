import type { Dispatcher } from "@/lib/github";
import { failStep, getEpisode, requestStep, type Episode } from "@/pipeline/episodes";
import { isBusy, STEP_LABELS, type Status, type Step } from "@/pipeline/status";

// 대시보드에서 단계를 시작시키는 쪽. DB 에 "대기" 를 적고 Actions 실행을 요청한다.

/** 이 시간이 지나도록 대기·실행 중이면 Actions 가 죽은 것으로 보고 다시 시도를 허용한다. */
export const STALE_AFTER_MS = { pending: 10 * 60 * 1000, running: 60 * 60 * 1000 } as const;

export function isStale(episode: Episode, now = Date.now()): boolean {
  if (episode.stepState !== "pending" && episode.stepState !== "running") return false;
  return now - episode.updatedAt.getTime() > STALE_AFTER_MS[episode.stepState];
}

/** 지금 구현된 단계. 아직 없는 단계는 버튼을 보여 주지 않는다(docs/mvp-plan.md 의 PR 순서). */
export const IMPLEMENTED_STEPS: readonly Step[] = ["script", "voice", "render", "compose", "upload"];

/** 사람의 결정 없이 바로 이어서 돌릴 수 있는 다음 단계. */
const NEXT_STEP: Partial<Record<Status, Step>> = {
  queued: "script",
  approved: "render",
  rendering: "compose",
  // 영상 검토 중에도 크레딧 없이 다시 합성할 수 있다(내레이션을 바꿨을 때 등).
  video_review: "compose",
  ready: "upload",
};

/** 지금 화면에 "실행/다시 시도" 버튼을 보여 줄 단계. 없으면 null. */
export function runnableStep(episode: Episode, now = Date.now()): Step | null {
  let step: Step | null;
  if (isBusy(episode)) step = isStale(episode, now) ? episode.step : null;
  else if (episode.status === "failed") step = episode.step;
  else step = NEXT_STEP[episode.status] ?? null;
  return step && IMPLEMENTED_STEPS.includes(step) ? step : null;
}

/**
 * 단계를 요청하고 Actions 실행을 요청한다. 실행 요청을 보낼 수 있는 환경인지는
 * 부르는 쪽이 먼저 확인한다(dispatchAvailability).
 * 요청이 실패하면 그 단계를 실패로 기록한다(화면에 사유가 보이고 다시 시도할 수 있게).
 */
export async function triggerStep(id: number, step: Step, dispatch: Dispatcher, now = Date.now()): Promise<Episode> {
  const current = await getEpisode(id);
  if (!current) throw new Error(`에피소드 #${id} 를 찾을 수 없습니다.`);
  if (isStale(current, now) && current.step) {
    await failStep(id, current.step, `${STEP_LABELS[current.step]}이(가) 응답 없이 멈춰 중단 처리했습니다.`);
  }

  const requested = await requestStep(id, step);
  try {
    await dispatch(step, id);
    return requested;
  } catch (error) {
    return failStep(id, step, error instanceof Error ? error.message : String(error));
  }
}
