// 에피소드 상태와 허용되는 전이. DB 를 모르는 순수 규칙이라 대시보드와 Actions 가 같이 쓴다.
//
//   queued ─script─► script_review ─approve-script─► approved (─voice─► approved, 여러 번 가능) ─render─► rendering
//          ─compose─► video_review ─approve-video─► ready ─upload─► uploaded
//   어느 단계든 실패 ─► failed (step 에 실패한 단계) ─다시 시도─► 그 단계부터

export const STATUSES = [
  "queued",
  "script_review",
  "approved",
  "rendering",
  "video_review",
  "ready",
  "uploaded",
  "failed",
] as const;
export type Status = (typeof STATUSES)[number];

/** Actions 에서 도는 자동 단계. */
export const STEPS = ["script", "voice", "render", "compose", "upload"] as const;
export type Step = (typeof STEPS)[number];

export type StepState = "pending" | "running" | "done" | "failed";

/** 상태 판단에 필요한 에피소드 필드만. */
export interface EpisodeState {
  status: Status;
  step: Step | null;
  stepState: StepState | null;
}

interface StepRule {
  /** 이 단계를 시작할 수 있는 상태. 첫 번째가 실패 후 다시 시도할 때 되돌아갈 상태다. */
  from: readonly Status[];
  /** 단계가 도는 동안의 상태(없으면 그대로). */
  during?: Status;
  /** 성공했을 때의 상태. */
  done: Status;
}

export const STEP_RULES: Record<Step, StepRule> = {
  script: { from: ["queued"], done: "script_review" },
  // 내레이션은 승인된 대본으로 만든다. 목소리를 바꿔 여러 번 만들 수 있어 상태는 그대로 둔다.
  voice: { from: ["approved"], done: "approved" },
  render: { from: ["approved", "rendering"], during: "rendering", done: "rendering" },
  // video_review 에서도 허용: 크레딧 없이 자막·모션만 다시 합성.
  compose: { from: ["rendering", "video_review"], done: "video_review" },
  upload: { from: ["ready"], done: "uploaded" },
};

/** 사람이 누르는 승인·반려. */
export const DECISIONS = {
  "approve-script": { from: "script_review", to: "approved" },
  "reject-script": { from: "script_review", to: "queued" },
  "approve-video": { from: "video_review", to: "ready" },
} as const satisfies Record<string, { from: Status; to: Status }>;
export type Decision = keyof typeof DECISIONS;

export const STATUS_LABELS: Record<Status, string> = {
  queued: "대본 대기",
  script_review: "대본 검토",
  approved: "대본 승인됨",
  rendering: "장면 생성",
  video_review: "영상 검토",
  ready: "업로드 대기",
  uploaded: "업로드 완료",
  failed: "실패",
};

export const STEP_LABELS: Record<Step, string> = {
  script: "대본 생성",
  voice: "내레이션 생성",
  render: "장면·음성 생성",
  compose: "영상 합성",
  upload: "유튜브 업로드",
};

export const STEP_STATE_LABELS: Record<StepState, string> = {
  pending: "실행 대기",
  running: "실행 중",
  done: "완료",
  failed: "실패",
};

export class TransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransitionError";
  }
}

export function isStatus(value: unknown): value is Status {
  return typeof value === "string" && (STATUSES as readonly string[]).includes(value);
}

export function isStep(value: unknown): value is Step {
  return typeof value === "string" && (STEPS as readonly string[]).includes(value);
}

export function isDecision(value: unknown): value is Decision {
  return typeof value === "string" && Object.hasOwn(DECISIONS, value);
}

/** 대기·실행 중인 단계가 있는가. 있으면 새 단계도, 승인·반려도 받지 않는다. */
export function isBusy(episode: EpisodeState): boolean {
  return episode.stepState === "pending" || episode.stepState === "running";
}

/** 목록·상세의 상태 표시. 단계가 대기·실행 중이면 상태 대신 그 단계를 보여 준다("대본 생성 중"). */
export function statusLabel(episode: EpisodeState): string {
  if (isBusy(episode) && episode.step) {
    return `${STEP_LABELS[episode.step]} ${episode.stepState === "pending" ? "대기" : "중"}`;
  }
  return STATUS_LABELS[episode.status];
}

/** 단계별 보통 걸리는 시간(안내용). */
export const STEP_TYPICAL_DURATION: Record<Step, string> = {
  script: "2~4분",
  voice: "1분 안팎",
  render: "5~15분",
  compose: "1~3분",
  upload: "1분 안팎",
};

/**
 * 단계 실행을 요청할 때(대시보드 버튼, 다시 시도) 그 직후의 상태.
 * 실패한 단계를 다시 시도하면 그 단계의 시작 상태로 되돌린다. 안 되면 TransitionError.
 */
export function statusForRequest(episode: EpisodeState, step: Step): Status {
  if (isBusy(episode)) {
    throw new TransitionError(`이미 ${STEP_LABELS[episode.step ?? step]} 단계가 진행 중입니다.`);
  }
  const rule = STEP_RULES[step];
  if (episode.status === "failed") {
    if (episode.step !== step) {
      throw new TransitionError(
        `실패한 단계는 ${episode.step ? STEP_LABELS[episode.step] : "알 수 없음"}입니다. 그 단계부터 다시 시도하세요.`,
      );
    }
    return rule.from[0];
  }
  if (!rule.from.includes(episode.status)) {
    throw new TransitionError(
      `${STATUS_LABELS[episode.status]} 상태에서는 ${STEP_LABELS[step]}을(를) 시작할 수 없습니다.`,
    );
  }
  return episode.status;
}

/**
 * Actions 가 단계를 실제로 시작할 때의 상태.
 * 대시보드가 요청해 둔 것(pending)이거나, Actions 화면에서 직접 실행한 경우 둘 다 받는다.
 */
export function statusForStart(episode: EpisodeState, step: Step): Status {
  const rule = STEP_RULES[step];
  let base: Status;
  if (episode.stepState === "pending") {
    if (episode.step !== step) {
      throw new TransitionError(`요청된 단계(${episode.step})와 실행하려는 단계(${step})가 다릅니다.`);
    }
    if (!rule.from.includes(episode.status)) {
      throw new TransitionError(
        `${STATUS_LABELS[episode.status]} 상태에서는 ${STEP_LABELS[step]}을(를) 시작할 수 없습니다.`,
      );
    }
    base = episode.status;
  } else {
    base = statusForRequest(episode, step);
  }
  return rule.during ?? base;
}

/** 단계가 성공했을 때의 상태. 그 단계가 실행 중이어야 한다. */
export function statusForDone(episode: EpisodeState, step: Step): Status {
  if (episode.step !== step || episode.stepState !== "running") {
    throw new TransitionError(`${STEP_LABELS[step]} 단계가 실행 중이 아닙니다.`);
  }
  return STEP_RULES[step].done;
}

/** 사람의 승인·반려 직후의 상태. */
export function statusForDecision(episode: EpisodeState, decision: Decision): Status {
  if (isBusy(episode)) {
    throw new TransitionError("진행 중인 단계가 끝난 뒤에 다시 시도하세요.");
  }
  const rule = DECISIONS[decision];
  if (episode.status !== rule.from) {
    throw new TransitionError(`${STATUS_LABELS[episode.status]} 상태에서는 할 수 없는 작업입니다.`);
  }
  return rule.to;
}
