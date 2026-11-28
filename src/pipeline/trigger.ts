import type { Dispatcher } from "@/lib/github";
import { failStep, getEpisode, requestStep, type Episode } from "@/pipeline/episodes";
import { listPicks, pickCount } from "@/pipeline/clips/picks";
import { isBusy, STEP_LABELS, TransitionError, type Status, type Step } from "@/pipeline/status";

// 대시보드에서 단계를 시작시키는 쪽. DB 에 "대기" 를 적고 Actions 실행을 요청한다.

/** 이 시간이 지나도록 대기·실행 중이면 Actions 가 죽은 것으로 보고 다시 시도를 허용한다(쇼츠 삭제 deleteEpisode 도 같은 기준). */
export const STALE_AFTER_MS = { pending: 10 * 60 * 1000, running: 60 * 60 * 1000 } as const;

export function isStale(episode: Episode, now = Date.now()): boolean {
  if (episode.stepState !== "pending" && episode.stepState !== "running") return false;
  return now - episode.updatedAt.getTime() > STALE_AFTER_MS[episode.stepState];
}

/** 지금 구현된 단계. 아직 없는 단계는 버튼을 보여 주지 않는다(docs/mvp-plan.md 의 PR 순서). */
export const IMPLEMENTED_STEPS: readonly Step[] = ["script", "voice", "render", "compose", "upload", "reschedule"];

/** 사람의 결정 없이 바로 이어서 돌릴 수 있는 다음 단계. */
const NEXT_STEP: Partial<Record<Status, Step>> = {
  queued: "script",
  approved: "render",
  rendering: "compose",
  // 영상 검토 중에도 크레딧 없이 다시 합성할 수 있다(내레이션을 바꿨을 때 등).
  video_review: "compose",
  // 자동 업로드(공개 상태는 업로드 탭에서 고른다). 직접 올리고 "올렸어요" 를 눌러도 된다.
  ready: "upload",
};

/** 지금 화면에 "실행/다시 시도" 버튼을 보여 줄 단계. 없으면 null. */
export function runnableStep(episode: Episode, now = Date.now()): Step | null {
  let step: Step | null;
  if (isBusy(episode)) step = isStale(episode, now) ? episode.step : null;
  else if (episode.status === "failed") step = episode.step;
  else step = NEXT_STEP[episode.status] ?? null;
  // clips 길은 장면을 AI 로 만들지 않는다(고른 클립으로 채운 뒤 바로 합성).
  if (step === "render" && episode.route === "clips") step = "compose";
  // music 길은 대본·내레이션이 없다(음원과 가사를 화면에서 준비한다).
  if (episode.route === "music" && (step === "script" || step === "voice")) step = null;
  return step && IMPLEMENTED_STEPS.includes(step) ? step : null;
}

/**
 * 단계를 요청하고 Actions 실행을 요청한다. 실행 요청을 보낼 수 있는 환경인지는
 * 부르는 쪽이 먼저 확인한다(dispatchAvailability).
 * 요청이 실패하면 그 단계를 실패로 기록한다(화면에 사유가 보이고 다시 시도할 수 있게).
 */
export async function triggerStep(id: number, step: Step, dispatch: Dispatcher, now = Date.now()): Promise<Episode> {
  const current = await getEpisode(id);
  if (!current) throw new Error(`쇼츠 #${id} 를 찾을 수 없습니다.`);
  if (current.route === "music" && (step === "script" || step === "voice")) {
    throw new TransitionError("음악형 쇼츠는 대본·내레이션 없이 올린 음원으로 만듭니다.");
  }
  if (current.route === "clips") {
    if (step === "render") throw new TransitionError("이 쇼츠는 고른 클립으로 장면을 채웁니다(장면 생성 없음).");
    if (step === "script" && (await listPicks(id)).length !== pickCount(current)) {
      throw new TransitionError(`장면에 쓸 클립 ${pickCount(current)}개를 먼저 고르세요.`);
    }
  }
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
