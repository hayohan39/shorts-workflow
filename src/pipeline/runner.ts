import { completeStep, failStep, startStep, type Episode } from "@/pipeline/episodes";
import { STEP_LABELS, type Step } from "@/pipeline/status";

/** 단계 하나의 실제 작업. 실패하면 throw 한다(에러 메시지가 대시보드에 보인다). */
export type StepHandler = (episode: Episode) => Promise<void>;
export type StepHandlers = Partial<Record<Step, StepHandler>>;

export type RunResult = { ok: true; episode: Episode } | { ok: false; episode: Episode; error: string };

/**
 * Actions 에서 단계 하나를 실행한다: 시작 기록 → 작업 → 완료 또는 실패 기록.
 * 시작할 수 없는 상태(TransitionError)면 아무것도 기록하지 않고 그대로 throw 한다.
 * 이미 다른 실행이 진행 중인 에피소드를 실패로 덮어쓰지 않기 위해서다.
 */
export async function runStep(
  id: number,
  step: Step,
  options: { handlers: StepHandlers; runUrl: string | null },
): Promise<RunResult> {
  const episode = await startStep(id, step, options.runUrl);
  try {
    const handler = options.handlers[step];
    if (!handler) throw new Error(`${STEP_LABELS[step]} 단계는 아직 구현되지 않았습니다.`);
    await handler(episode);
    return { ok: true, episode: await completeStep(id, step) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, episode: await failStep(id, step, message), error: message };
  }
}
