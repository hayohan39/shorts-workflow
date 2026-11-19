import type { StepHandlers } from "@/pipeline/runner";
import { refreshManyMotionsAccount } from "@/pipeline/accounts";
import { readManyMotionsKey } from "@/pipeline/providers/manymotions";
import { runComposeStep } from "@/pipeline/steps/compose";
import { runRenderStep } from "@/pipeline/steps/render";
import { runScriptStep } from "@/pipeline/steps/script";
import { runUploadStep } from "@/pipeline/steps/upload";
import { runVoiceStep } from "@/pipeline/steps/voice";

// 단계별 작업. 각 단계는 해당 PR 에서 채운다:
//   script ④ · voice ⑤-1 · render ⑤-2 · compose ⑥ · upload ⑦  (docs/mvp-plan.md)
// 비어 있는 단계를 실행하면 "아직 구현되지 않았습니다" 로 실패 처리된다.

/** ManyMotions 크레딧을 쓰는 단계: 성공·실패와 관계없이 끝나면 대시보드 잔액을 맞춘다(조회 실패는 무시). */
async function withBalanceRefresh(run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } finally {
    await refreshManyMotionsAccount(readManyMotionsKey());
  }
}

export const handlers: StepHandlers = {
  script: (episode, context) => runScriptStep(episode, { progress: context.progress }),
  voice: (episode, context) => withBalanceRefresh(() => runVoiceStep(episode, { progress: context.progress })),
  render: (episode, context) => withBalanceRefresh(() => runRenderStep(episode, { progress: context.progress })),
  compose: async (episode, context) => {
    await runComposeStep(episode, { progress: context.progress });
  },
  upload: async (episode, context) => {
    await runUploadStep(episode, { progress: context.progress });
  },
};
