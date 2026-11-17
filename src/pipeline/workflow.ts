import { isBusy, type EpisodeState, type Step } from "@/pipeline/status";

// 에피소드 화면의 단계 탭: 대본 → 내레이션 → 장면 → 영상 → 업로드.
// 상태(status)와 실제로 만들어진 것(내레이션·장면)을 보고 지금 어느 단계에 있는지 정한다. DB 를 모르는 순수 규칙.

export const STAGES = ["script", "voice", "scenes", "video", "upload"] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABELS: Record<Stage, string> = {
  script: "대본",
  voice: "내레이션",
  scenes: "장면",
  video: "영상",
  upload: "업로드",
};

/** 자동 단계가 어느 탭에 속하는가. */
export const STEP_STAGE: Record<Step, Stage> = {
  script: "script",
  voice: "voice",
  render: "scenes",
  compose: "video",
  upload: "upload",
};

/** 상세 화면에서만 아는 것. 목록처럼 모를 때는 상태만으로 판단한다. */
export interface StageFacts {
  hasNarration: boolean;
  /** 아직 만들지 않은 장면 수(대본이 없으면 0). */
  scenesLeft: number;
}

/** done: 끝남 · current: 지금 할 단계 · todo: 아직. */
export type StageState = "done" | "current" | "todo";
/** 지금 단계가 어떤 상황인가: 자동 작업이 도는 중, 실패, 사람 차례. */
export type StageActivity = "busy" | "failed" | "waiting";

export interface WorkflowStage {
  stage: Stage;
  label: string;
  state: StageState;
}

export interface Workflow {
  current: Stage;
  activity: StageActivity | null;
  stages: WorkflowStage[];
  /** 끝난 단계 수(진행 막대용). */
  doneCount: number;
}

export function isStage(value: unknown): value is Stage {
  return typeof value === "string" && (STAGES as readonly string[]).includes(value);
}

export function currentStage(episode: EpisodeState, facts?: StageFacts): Stage {
  if ((isBusy(episode) || episode.status === "failed") && episode.step) return STEP_STAGE[episode.step];
  switch (episode.status) {
    case "queued":
    case "script_review":
    case "failed":
      return "script";
    case "approved":
    case "rendering":
      if (!facts) return episode.status === "approved" ? "voice" : "scenes";
      if (!facts.hasNarration) return "voice";
      return facts.scenesLeft > 0 ? "scenes" : "video";
    case "video_review":
      return "video";
    case "ready":
    case "uploaded":
      return "upload";
  }
}

export function workflow(episode: EpisodeState, facts?: StageFacts): Workflow {
  const current = currentStage(episode, facts);
  const at = STAGES.indexOf(current);
  const finished = episode.status === "uploaded";
  const complete: Record<Stage, boolean> = {
    script: finished || at > 0,
    voice: facts ? facts.hasNarration : finished || at > 1,
    scenes: facts ? at > 0 && facts.scenesLeft === 0 : finished || at > 2,
    video: finished || at > 3,
    upload: finished,
  };
  const stages = STAGES.map((stage) => ({
    stage,
    label: STAGE_LABELS[stage],
    state: (stage === current && !finished ? "current" : complete[stage] ? "done" : "todo") as StageState,
  }));
  const activity: StageActivity | null = finished
    ? null
    : isBusy(episode)
      ? "busy"
      : episode.status === "failed"
        ? "failed"
        : "waiting";
  return {
    current,
    activity,
    stages,
    doneCount: stages.filter((item) => item.state === "done").length,
  };
}
