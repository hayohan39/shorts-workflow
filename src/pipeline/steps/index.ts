import type { StepHandlers } from "@/pipeline/runner";
import { refreshManyMotionsAccount } from "@/pipeline/accounts";
import { readManyMotionsKey } from "@/pipeline/providers/manymotions";
import { runScriptStep } from "@/pipeline/steps/script";
import { runVoiceStep } from "@/pipeline/steps/voice";

// 단계별 작업. 각 단계는 해당 PR 에서 채운다:
//   script ④ · voice ⑤-1 · render ⑤-2 · compose ⑥ · upload ⑦  (docs/mvp-plan.md)
// 비어 있는 단계를 실행하면 "아직 구현되지 않았습니다" 로 실패 처리된다.
export const handlers: StepHandlers = {
  script: (episode, context) => runScriptStep(episode, { progress: context.progress }),
  voice: async (episode, context) => {
    await runVoiceStep(episode, { progress: context.progress });
    // 대시보드의 ManyMotions 잔액도 바로 맞춘다(실패해도 단계는 성공).
    await refreshManyMotionsAccount(readManyMotionsKey());
  },
};
