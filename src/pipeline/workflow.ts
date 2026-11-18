import type { Route } from "@/pipeline/episodes";
import { isBusy, type EpisodeState, type Step } from "@/pipeline/status";

// 에피소드 화면의 단계 탭. 만드는 길(route)마다 단계가 다르다.
//   ai    : 대본 → 내레이션 → 장면 → 영상 → 업로드
//   clips : 영상 찾기 → 대본 → 내레이션 → 영상 → 업로드 (장면은 고른 클립으로 채운다)
// 상태(status)와 실제로 만들어진 것(고른 클립·내레이션·장면)을 보고 지금 어느 단계에 있는지 정한다. DB 를 모르는 순수 규칙.

export const STAGES = ["clips", "script", "voice", "scenes", "video", "upload"] as const;
export type Stage = (typeof STAGES)[number];

export const ROUTE_STAGES: Record<Route, readonly Stage[]> = {
  ai: ["script", "voice", "scenes", "video", "upload"],
  clips: ["clips", "script", "voice", "video", "upload"],
};

export const ROUTE_LABELS: Record<Route, string> = { ai: "주제로 만들기", clips: "영상 먼저 찾기" };

export const STAGE_LABELS: Record<Stage, string> = {
  clips: "영상 찾기",
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
  /** clips 길: 장면에 쓸 클립을 다 골랐는가. */
  picked?: boolean;
  /** clips 길: 영상 찾기가 도는 중이거나 실패했는가. */
  search?: "busy" | "failed" | null;
}

/** 단계 판단에 쓰는 에피소드 필드. route 가 없으면 ai 길. */
export type WorkflowEpisode = EpisodeState & { route?: Route };

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

export function currentStage(episode: WorkflowEpisode, facts?: StageFacts): Stage {
  const clips = episode.route === "clips";
  if ((isBusy(episode) || episode.status === "failed") && episode.step) return STEP_STAGE[episode.step];
  switch (episode.status) {
    case "queued":
      // clips 길은 클립을 고르기 전까지 영상 찾기 단계. 목록처럼 모를 때는 대본을 요청한 적이 있는지로 본다.
      if (clips && !(facts ? facts.picked : episode.step !== null)) return "clips";
      return "script";
    case "script_review":
    case "failed":
      return "script";
    case "approved":
    case "rendering":
      if (!facts) return episode.status === "approved" ? "voice" : clips ? "video" : "scenes";
      if (!facts.hasNarration) return "voice";
      return facts.scenesLeft > 0 && !clips ? "scenes" : "video";
    case "video_review":
      return "video";
    case "ready":
    case "uploaded":
      return "upload";
  }
}

export function workflow(episode: WorkflowEpisode, facts?: StageFacts): Workflow {
  const order = ROUTE_STAGES[episode.route ?? "ai"];
  const current = currentStage(episode, facts);
  const at = order.indexOf(current);
  const after = (stage: Stage) => at > order.indexOf(stage);
  const finished = episode.status === "uploaded";
  const complete: Record<Stage, boolean> = {
    clips: facts?.picked ?? (finished || after("clips")),
    script: finished || after("script"),
    voice: facts ? facts.hasNarration : finished || after("voice"),
    scenes: facts ? after("script") && facts.scenesLeft === 0 : finished || after("scenes"),
    video: finished || after("video"),
    upload: finished,
  };
  const stages = order.map((stage) => ({
    stage,
    label: STAGE_LABELS[stage],
    state: (stage === current && !finished ? "current" : complete[stage] ? "done" : "todo") as StageState,
  }));
  const searching = current === "clips" ? facts?.search : null;
  const activity: StageActivity | null = finished
    ? null
    : isBusy(episode) || searching === "busy"
      ? "busy"
      : episode.status === "failed" || searching === "failed"
        ? "failed"
        : "waiting";
  return {
    current,
    activity,
    stages,
    doneCount: stages.filter((item) => item.state === "done").length,
  };
}
