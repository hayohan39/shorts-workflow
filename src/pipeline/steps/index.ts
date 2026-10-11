import type { StepHandlers } from "@/pipeline/runner";

// 단계별 작업. 각 단계는 해당 PR 에서 채운다:
//   script ④ · render ⑤ · compose ⑥ · upload ⑦  (docs/mvp-plan.md)
// 비어 있는 단계를 실행하면 "아직 구현되지 않았습니다" 로 실패 처리된다.
export const handlers: StepHandlers = {};
