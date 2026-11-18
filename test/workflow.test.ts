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

  it("영상 먼저 찾기(clips): 영상 찾기 → 대본 → 내레이션 → 영상 → 업로드, 장면 단계는 없다", () => {
    const clips = (status: EpisodeState["status"], step: EpisodeState["step"] = null, stepState: EpisodeState["stepState"] = null) => ({
      ...at(status, step, stepState),
      route: "clips" as const,
    });
    const facts = (extra: Partial<Parameters<typeof workflow>[1]> = {}) => ({ hasNarration: false, scenesLeft: 4, picked: false, ...extra });
    expect(states(clips("queued"), facts())).toBe("clips:current script:todo voice:todo video:todo upload:todo");
    expect(workflow(clips("queued"), facts({ search: "busy" })).activity).toBe("busy");
    expect(workflow(clips("queued"), facts({ search: "failed" })).activity).toBe("failed");
    // 고르고 대본을 만드는 중
    expect(states(clips("queued", "script", "running"), facts({ picked: true }))).toBe(
      "clips:done script:current voice:todo video:todo upload:todo",
    );
    // 반려되어 다시 대본 대기: 고른 클립은 그대로, 대본 단계
    expect(currentStage(clips("queued", "script", "done"), facts({ picked: true }))).toBe("script");
    // 승인 뒤: 내레이션 → (클립 채택이 끝나지 않았어도) 영상
    expect(currentStage(clips("approved"), facts({ picked: true }))).toBe("voice");
    expect(currentStage(clips("approved"), facts({ picked: true, hasNarration: true, scenesLeft: 2 }))).toBe("video");
    // 목록(모를 때): 대본을 요청한 적이 없으면 영상 찾기
    expect(currentStage(clips("queued"))).toBe("clips");
    expect(currentStage(clips("queued", "script", "pending"))).toBe("script");
    expect(states(clips("uploaded"))).toBe("clips:done script:done voice:done video:done upload:done");
  });

  it("탭 이름 확인", () => {
    expect(isStage("scenes")).toBe(true);
    expect(isStage("render")).toBe(false);
    expect(isStage(undefined)).toBe(false);
  });
});
