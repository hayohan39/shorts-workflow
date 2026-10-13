import { describe, expect, it } from "vitest";
import {
  STATUSES,
  STEP_RULES,
  STEPS,
  statusForDecision,
  statusForDone,
  statusForRequest,
  statusForStart,
  TransitionError,
  type EpisodeState,
} from "@/pipeline/status";

const idle = (status: EpisodeState["status"], step: EpisodeState["step"] = null): EpisodeState => ({
  status,
  step,
  stepState: step ? "done" : null,
});

describe("단계 규칙", () => {
  it("모든 단계의 시작·완료 상태가 유효한 상태다", () => {
    for (const step of STEPS) {
      const rule = STEP_RULES[step];
      for (const status of [...rule.from, rule.done, ...(rule.during ? [rule.during] : [])]) {
        expect(STATUSES).toContain(status);
      }
    }
  });

  it("정상 흐름: queued → … → uploaded", () => {
    let state: EpisodeState = idle("queued");
    const go = (step: (typeof STEPS)[number]) => {
      state = { status: statusForRequest(state, step), step, stepState: "pending" };
      state = { status: statusForStart(state, step), step, stepState: "running" };
      state = { status: statusForDone(state, step), step, stepState: "done" };
    };

    go("script");
    expect(state.status).toBe("script_review");
    state = { ...state, status: statusForDecision(state, "approve-script") };
    expect(state.status).toBe("approved");
    go("render");
    expect(state.status).toBe("rendering");
    go("compose");
    expect(state.status).toBe("video_review");
    state = { ...state, status: statusForDecision(state, "approve-video") };
    expect(state.status).toBe("ready");
    go("upload");
    expect(state.status).toBe("uploaded");
  });

  it("내레이션은 승인된 대본에서 여러 번 만들 수 있고 상태는 그대로다", () => {
    expect(statusForRequest(idle("approved", "script"), "voice")).toBe("approved");
    expect(statusForDone({ status: "approved", step: "voice", stepState: "running" }, "voice")).toBe("approved");
    expect(statusForRequest(idle("approved", "voice"), "voice")).toBe("approved");
    expect(() => statusForRequest(idle("script_review", "script"), "voice")).toThrow(TransitionError);
    expect(statusForRequest({ status: "failed", step: "voice", stepState: "failed" }, "voice")).toBe("approved");
  });

  it("렌더 중에는 상태가 rendering 이다", () => {
    expect(statusForStart({ status: "approved", step: "render", stepState: "pending" }, "render")).toBe("rendering");
  });

  it("영상 검토 중에 다시 합성할 수 있다", () => {
    expect(statusForRequest(idle("video_review", "compose"), "compose")).toBe("video_review");
  });

  it("순서를 건너뛸 수 없다", () => {
    expect(() => statusForRequest(idle("queued"), "render")).toThrow(TransitionError);
    expect(() => statusForRequest(idle("script_review", "script"), "upload")).toThrow(TransitionError);
    expect(() => statusForRequest(idle("uploaded", "upload"), "upload")).toThrow(TransitionError);
  });

  it("진행 중이면 새 단계도, 승인도 받지 않는다", () => {
    const busy: EpisodeState = { status: "queued", step: "script", stepState: "running" };
    expect(() => statusForRequest(busy, "script")).toThrow(/진행 중/);
    const pending: EpisodeState = { status: "video_review", step: "compose", stepState: "pending" };
    expect(() => statusForDecision(pending, "approve-video")).toThrow(TransitionError);
  });

  it("실패한 단계만 다시 시도할 수 있고, 그 단계의 시작 상태로 돌아간다", () => {
    const failed: EpisodeState = { status: "failed", step: "render", stepState: "failed" };
    expect(statusForRequest(failed, "render")).toBe("approved");
    expect(() => statusForRequest(failed, "compose")).toThrow(/장면·음성 생성/);
    expect(statusForStart(failed, "render")).toBe("rendering");
    expect(statusForRequest({ status: "failed", step: "script", stepState: "failed" }, "script")).toBe("queued");
  });

  it("요청된 단계와 다른 단계는 시작하지 않는다", () => {
    expect(() => statusForStart({ status: "approved", step: "render", stepState: "pending" }, "compose")).toThrow(
      TransitionError,
    );
  });

  it("실행 중이 아닌 단계는 완료 처리하지 않는다", () => {
    expect(() => statusForDone({ status: "queued", step: "script", stepState: "pending" }, "script")).toThrow(
      TransitionError,
    );
  });

  it("반려하면 대본 대기로 돌아간다", () => {
    expect(statusForDecision(idle("script_review", "script"), "reject-script")).toBe("queued");
    expect(() => statusForDecision(idle("queued"), "approve-script")).toThrow(TransitionError);
  });
});
