import { describe, expect, it } from "vitest";
import type { EpisodeState } from "@/pipeline/status";
import { currentStage, isStage, workflow } from "@/pipeline/workflow";

const at = (status: EpisodeState["status"], step: EpisodeState["step"] = null, stepState: EpisodeState["stepState"] = null) => ({
  status,
  step,
  stepState,
});
const states = (episode: EpisodeState, facts?: Parameters<typeof workflow>[1]) =>
  workflow(episode, facts)
    .stages.map((stage) => `${stage.stage}:${stage.state}`)
    .join(" ");

describe("에피소드 단계 탭", () => {
  it("상태로 지금 단계를 정한다", () => {
    expect(currentStage(at("queued"))).toBe("script");
    expect(currentStage(at("script_review", "script", "done"))).toBe("script");
    expect(currentStage(at("video_review", "compose", "done"))).toBe("video");
    expect(currentStage(at("ready"))).toBe("upload");
    expect(currentStage(at("uploaded"))).toBe("upload");
  });

  it("대본 승인 뒤에는 내레이션 → 장면 → 영상 순서로, 만들어진 것을 보고 정한다", () => {
    expect(currentStage(at("approved"), { hasNarration: false, scenesLeft: 6 })).toBe("voice");
    expect(currentStage(at("approved"), { hasNarration: true, scenesLeft: 6 })).toBe("scenes");
    expect(
      currentStage(at("rendering", "render", "done"), {
        hasNarration: true,
        scenesLeft: 0,
      }),
    ).toBe("video");
    // 장면을 먼저 다 만들었어도 내레이션이 없으면 내레이션 차례
    expect(
      currentStage(at("rendering", "render", "done"), {
        hasNarration: false,
        scenesLeft: 0,
      }),
    ).toBe("voice");
    // 목록처럼 모를 때는 상태만으로
    expect(currentStage(at("approved"))).toBe("voice");
    expect(currentStage(at("rendering"))).toBe("scenes");
  });

  it("진행 중이거나 실패한 단계가 있으면 그 단계의 탭", () => {
    expect(currentStage(at("approved", "voice", "running"))).toBe("voice");
    expect(currentStage(at("rendering", "render", "pending"))).toBe("scenes");
    expect(currentStage(at("failed", "compose", "failed"))).toBe("video");
    expect(currentStage(at("failed"))).toBe("script");
  });

  it("앞 단계는 끝남, 지금 단계는 진행, 뒤는 아직", () => {
    expect(states(at("approved"), { hasNarration: true, scenesLeft: 3 })).toBe(
      "script:done voice:done scenes:current video:todo upload:todo",
    );
    // 장면을 먼저 만든 경우: 장면은 끝남, 내레이션이 지금 단계
    expect(states(at("rendering"), { hasNarration: false, scenesLeft: 0 })).toBe(
      "script:done voice:current scenes:done video:todo upload:todo",
    );
    expect(states(at("uploaded"))).toBe("script:done voice:done scenes:done video:done upload:done");
    expect(workflow(at("uploaded")).activity).toBeNull();
  });

  it("지금 단계의 상황: 진행 중·실패·사람 차례", () => {
    expect(workflow(at("queued", "script", "pending")).activity).toBe("busy");
    expect(workflow(at("failed", "render", "failed")).activity).toBe("failed");
    expect(workflow(at("video_review", "compose", "done"))).toMatchObject({
      activity: "waiting",
      doneCount: 3,
    });
  });

  it("탭 이름 확인", () => {
    expect(isStage("scenes")).toBe(true);
    expect(isStage("render")).toBe(false);
    expect(isStage(undefined)).toBe(false);
  });
});
