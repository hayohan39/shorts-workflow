import type { PoolClient } from "pg";
import { getPool, query } from "@/lib/db";
import { redact } from "@/lib/health";
import {
  statusForDecision,
  statusForDone,
  statusForRequest,
  statusForStart,
  type Decision,
  type Status,
  type Step,
  type StepState,
} from "@/pipeline/status";

export interface Episode {
  id: number;
  topic: string;
  outline: string;
  status: Status;
  step: Step | null;
  stepState: StepState | null;
  /** 단계를 요청(대기)하거나 시작한 시각. */
  stepStartedAt: Date | null;
  /** Actions 가 적는 진행 메모. */
  stepProgress: string | null;
  /** 다음 내레이션에 쓸 목소리(대시보드에서 고른 값). */
  voiceId: string | null;
  voiceModel: string | null;
  runUrl: string | null;
  scheduledAt: Date | null;
  youtubeVideoId: string | null;
  creditsUsed: number;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface EpisodeRow {
  id: number;
  topic: string;
  outline: string;
  status: Status;
  step: Step | null;
  step_state: StepState | null;
  step_started_at: Date | null;
  step_progress: string | null;
  voice_id: string | null;
  voice_model: string | null;
  run_url: string | null;
  scheduled_at: Date | null;
  youtube_video_id: string | null;
  credits_used: number;
  error: string | null;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS = `id, topic, outline, status, step, step_state, step_started_at, step_progress, voice_id, voice_model, run_url, scheduled_at,
  youtube_video_id, credits_used, error, created_at, updated_at`;

export const TOPIC_MAX = 200;
export const OUTLINE_MAX = 2000;
const ERROR_MAX = 2000;
const PROGRESS_MAX = 200;

export class EpisodeNotFoundError extends Error {
  constructor(id: number) {
    super(`에피소드 #${id} 를 찾을 수 없습니다.`);
    this.name = "EpisodeNotFoundError";
  }
}

function toEpisode(row: EpisodeRow): Episode {
  return {
    id: row.id,
    topic: row.topic,
    outline: row.outline,
    status: row.status,
    step: row.step,
    stepState: row.step_state,
    stepStartedAt: row.step_started_at,
    stepProgress: row.step_progress,
    voiceId: row.voice_id,
    voiceModel: row.voice_model,
    runUrl: row.run_url,
    scheduledAt: row.scheduled_at,
    youtubeVideoId: row.youtube_video_id,
    creditsUsed: row.credits_used,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createEpisode(input: { topic: string; outline: string }): Promise<Episode> {
  const topic = input.topic.trim();
  const outline = input.outline.trim();
  if (!topic) throw new RangeError("주제를 입력하세요.");
  if (topic.length > TOPIC_MAX) throw new RangeError(`주제는 ${TOPIC_MAX}자 이내로 입력하세요.`);
  if (outline.length > OUTLINE_MAX) throw new RangeError(`목차는 ${OUTLINE_MAX}자 이내로 입력하세요.`);
  const [row] = await query<EpisodeRow>(
    `insert into episodes (topic, outline) values ($1, $2) returning ${COLUMNS}`,
    [topic, outline],
  );
  return toEpisode(row);
}

export async function getEpisode(id: number): Promise<Episode | null> {
  const [row] = await query<EpisodeRow>(`select ${COLUMNS} from episodes where id = $1`, [id]);
  return row ? toEpisode(row) : null;
}

export async function listEpisodes(limit = 50): Promise<Episode[]> {
  const rows = await query<EpisodeRow>(
    `select ${COLUMNS} from episodes order by created_at desc, id desc limit $1`,
    [limit],
  );
  return rows.map(toEpisode);
}

/**
 * 에피소드 행을 잠그고(select ... for update) 상태를 바꾼다.
 * 대시보드 버튼과 Actions 가 동시에 같은 에피소드를 건드려도 한쪽씩 차례로 판단한다.
 */
async function updateLocked(
  id: number,
  decide: (episode: Episode) => Record<string, unknown> | null,
): Promise<Episode> {
  const client: PoolClient = await getPool().connect();
  try {
    await client.query("begin");
    const { rows } = await client.query<EpisodeRow>(
      `select ${COLUMNS} from episodes where id = $1 for update`,
      [id],
    );
    if (!rows[0]) throw new EpisodeNotFoundError(id);
    const changes = decide(toEpisode(rows[0]));
    if (!changes) {
      await client.query("rollback");
      return toEpisode(rows[0]);
    }
    // 컬럼 이름은 이 파일 안의 고정 문자열뿐이다. 값은 전부 바인딩한다.
    const entries = Object.entries(changes);
    const sets = entries.map(([column], i) => `${column} = $${i + 2}`);
    const { rows: updated } = await client.query<EpisodeRow>(
      `update episodes set ${sets.join(", ")}, updated_at = now() where id = $1 returning ${COLUMNS}`,
      [id, ...entries.map(([, value]) => value)],
    );
    await client.query("commit");
    return toEpisode(updated[0]);
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** 단계 실행을 요청한다(대시보드 버튼, 다시 시도). 이후 Actions 를 실행시키는 건 호출한 쪽의 몫. */
export function requestStep(id: number, step: Step): Promise<Episode> {
  return updateLocked(id, (episode) => ({
    status: statusForRequest(episode, step),
    step,
    step_state: "pending",
    step_started_at: new Date(),
    step_progress: null,
    run_url: null,
    error: null,
  }));
}

/** Actions 가 단계를 시작할 때. */
export function startStep(id: number, step: Step, runUrl: string | null): Promise<Episode> {
  return updateLocked(id, (episode) => ({
    status: statusForStart(episode, step),
    step,
    step_state: "running",
    step_started_at: new Date(),
    step_progress: null,
    run_url: runUrl,
    error: null,
  }));
}

export function completeStep(id: number, step: Step): Promise<Episode> {
  return updateLocked(id, (episode) => ({
    status: statusForDone(episode, step),
    step_state: "done",
    step_progress: null,
  }));
}

/**
 * 단계 실패를 기록한다. 그 단계가 대기·실행 중일 때만 기록하고, 아니면 아무것도 바꾸지 않는다
 * (다른 실행이 이미 상태를 바꿨는데 덮어쓰지 않도록).
 */
export function failStep(id: number, step: Step, message: string): Promise<Episode> {
  return updateLocked(id, (episode) => {
    const active = episode.stepState === "pending" || episode.stepState === "running";
    if (episode.step !== step || !active) return null;
    return {
      status: "failed",
      step_state: "failed",
      error: redact(message).slice(0, ERROR_MAX),
    };
  });
}

/**
 * 실행 중인 단계의 진행 메모를 남긴다. 그 단계가 실행 중일 때만 적고, 아니면 무시한다.
 * updated_at 도 갱신되므로 "응답 없음" 판정(isStale)의 생존 신호 역할도 한다.
 */
export async function reportProgress(id: number, step: Step, text: string): Promise<boolean> {
  const rows = await query<{ id: number }>(
    `update episodes set step_progress = $3, updated_at = now()
      where id = $1 and step = $2 and step_state = 'running' returning id`,
    [id, step, redact(text).slice(0, PROGRESS_MAX)],
  );
  return rows.length > 0;
}

/** 다음 내레이션에 쓸 목소리를 정한다. 값 검증은 부르는 쪽(voices.ts 목록)이 한다. */
export async function setVoiceSelection(id: number, voiceId: string, voiceModel: string): Promise<void> {
  await query("update episodes set voice_id = $2, voice_model = $3, updated_at = now() where id = $1", [
    id,
    voiceId,
    voiceModel,
  ]);
}

/** 사람의 승인·반려. */
export function decide(id: number, decision: Decision): Promise<Episode> {
  return updateLocked(id, (episode) => ({
    status: statusForDecision(episode, decision),
    error: null,
  }));
}
