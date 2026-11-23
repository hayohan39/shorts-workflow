import type { PoolClient } from "pg";
import { getPool, query, transaction } from "@/lib/db";
import { watchUrl } from "@/pipeline/youtube/links";
import { redact } from "@/lib/health";
import { isTargetSeconds, TARGET_SECONDS } from "@/pipeline/script/schema";
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

export type UploadPrivacy = "private" | "unlisted" | "public";

/** 만드는 길: ai(주제·목차 → AI 장면 생성) · clips(무료 영상을 먼저 찾아 고른 뒤 대본) · music(직접 만든 음원 + 가사 + 이미지). */
export type Route = "ai" | "clips" | "music";

export interface Episode {
  id: number;
  /** 채널 slug(channels.slug). */
  channel: string;
  route: Route;
  /** 목표 영상 길이(초). 장면 수·내레이션 글자 수가 여기서 나온다(lengthRules). */
  targetSeconds: number;
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
  /** 예약 공개 시각(자동 업로드에서 예약을 골랐을 때). */
  scheduledAt: Date | null;
  /** 자동 업로드에서 고른 공개 상태. 예약이면 private + scheduledAt. */
  uploadPrivacy: UploadPrivacy | null;
  youtubeVideoId: string | null;
  creditsUsed: number;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface EpisodeRow {
  id: number;
  channel: string;
  route: Route;
  target_seconds: number;
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
  upload_privacy: UploadPrivacy | null;
  youtube_video_id: string | null;
  credits_used: number;
  error: string | null;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS = `id, channel, route, target_seconds, topic, outline, status, step, step_state, step_started_at, step_progress, voice_id, voice_model, run_url, scheduled_at, upload_privacy,
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
    channel: row.channel,
    route: row.route,
    targetSeconds: row.target_seconds,
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
    uploadPrivacy: row.upload_privacy,
    youtubeVideoId: row.youtube_video_id,
    creditsUsed: row.credits_used,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createEpisode(input: {
  topic: string;
  outline: string;
  route?: Route;
  /** 채널 slug. 없으면 DB 기본값(raccoon). */
  channel?: string;
  /** 목표 길이(초, TARGET_SECONDS 중 하나). 없으면 DB 기본값. */
  targetSeconds?: number;
}): Promise<Episode> {
  const topic = input.topic.trim();
  const outline = input.outline.trim();
  if (!topic) throw new RangeError("주제를 입력하세요.");
  if (topic.length > TOPIC_MAX) throw new RangeError(`주제는 ${TOPIC_MAX}자 이내로 입력하세요.`);
  if (outline.length > OUTLINE_MAX) throw new RangeError(`목차는 ${OUTLINE_MAX}자 이내로 입력하세요.`);
  if (input.targetSeconds !== undefined && !isTargetSeconds(input.targetSeconds)) {
    throw new RangeError(`영상 길이는 ${TARGET_SECONDS.join("·")}초 중에서 고르세요.`);
  }
  // 채널·길이를 주지 않으면(테스트·예전 호출) 마이그레이션의 기본값과 같은 값을 쓴다.
  const [row] = await query<EpisodeRow>(
    `insert into episodes (topic, outline, route, channel, target_seconds)
      values ($1, $2, $3, coalesce($4, 'raccoon'), coalesce($5, 35)) returning ${COLUMNS}`,
    [topic, outline, input.route ?? "ai", input.channel ?? null, input.targetSeconds ?? null],
  );
  return toEpisode(row);
}

export async function getEpisode(id: number): Promise<Episode | null> {
  const [row] = await query<EpisodeRow>(`select ${COLUMNS} from episodes where id = $1`, [id]);
  return row ? toEpisode(row) : null;
}

/** 최근 에피소드. channel 을 주면 그 채널 것만, active 면 아직 올리지 않은 것만. */
export async function listEpisodes(options: { channel?: string; active?: boolean; limit?: number } = {}): Promise<Episode[]> {
  const rows = await query<EpisodeRow>(
    `select ${COLUMNS} from episodes
      where ($1::text is null or channel = $1) and (not $2 or status <> 'uploaded')
      order by created_at desc, id desc limit $3`,
    [options.channel ?? null, options.active ?? false, options.limit ?? 50],
  );
  return rows.map(toEpisode);
}

/** 채널별 올린 에피소드 수. */
export async function uploadedCounts(): Promise<Map<string, number>> {
  const rows = await query<{ channel: string; count: number }>(
    "select channel, count(*)::int as count from episodes where status = 'uploaded' group by channel",
  );
  return new Map(rows.map((row) => [row.channel, row.count]));
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

/** 목차를 바꾼다(clips 길: 클립을 고른 뒤 컨셉·목차를 적을 때). 대본을 만들기 전(대본 대기)에만. */
export async function setOutline(id: number, outlineInput: string): Promise<void> {
  const outline = outlineInput.trim();
  if (outline.length > OUTLINE_MAX) throw new RangeError(`컨셉·목차는 ${OUTLINE_MAX}자 이내로 입력하세요.`);
  const rows = await query<{ id: number }>(
    `update episodes set outline = $2, updated_at = now()
      where id = $1 and status = 'queued' and (step_state is null or step_state not in ('pending', 'running')) returning id`,
    [id, outline],
  );
  if (!rows.length) throw new RangeError("대본을 만들기 전에만 바꿀 수 있습니다.");
}

/** 다음 내레이션에 쓸 목소리를 정한다. 값 검증은 부르는 쪽(voices.ts 목록)이 한다. */
export async function setVoiceSelection(id: number, voiceId: string, voiceModel: string): Promise<void> {
  await query("update episodes set voice_id = $2, voice_model = $3, updated_at = now() where id = $1", [
    id,
    voiceId,
    voiceModel,
  ]);
}

/**
 * 유튜브 업로드 결과: 에피소드에 영상 ID 를, uploads 에 기록 한 줄을 남긴다.
 * publishAt 은 예약 공개 시각(없으면 지금 올린 것으로 본다).
 */
export async function saveUpload(id: number, videoId: string, privacy: UploadPrivacy, publishAt: Date | null = null): Promise<void> {
  await transaction(async (client) => {
    await client.query("update episodes set youtube_video_id = $2, updated_at = now() where id = $1", [id, videoId]);
    await client.query(
      "insert into uploads (episode_id, privacy, youtube_url, published_at) values ($1, $2, $3, coalesce($4, now()))",
      [id, privacy, watchUrl(videoId), publishAt],
    );
  });
}

export interface UploadRecord {
  privacy: UploadPrivacy;
  youtubeUrl: string | null;
  publishedAt: Date | null;
}

/** 가장 최근 업로드 기록(실제로 적용된 공개 상태). */
export async function latestUpload(id: number): Promise<UploadRecord | null> {
  const [row] = await query<{ privacy: UploadPrivacy; youtube_url: string | null; published_at: Date | null }>(
    "select privacy, youtube_url, published_at from uploads where episode_id = $1 order by id desc limit 1",
    [id],
  );
  return row ? { privacy: row.privacy, youtubeUrl: row.youtube_url, publishedAt: row.published_at } : null;
}

/** 업로드 큐의 한 줄: 에피소드, 최근 업로드 기록, 기획안 카테고리, 완성 영상 길이. */
export interface QueueEntry {
  episode: Episode;
  upload: UploadRecord | null;
  category: string | null;
  seconds: number | null;
}

/**
 * 채널 업로드 큐: 업로드 대기(영상 승인됨)·업로드 실패, 그리고 유튜브에 올린 영상.
 * 올린 영상은 예약 공개가 남았거나 최근 2주 안에 공개된 것만.
 */
export async function listUploadQueue(channel: string): Promise<QueueEntry[]> {
  const rows = await query<
    EpisodeRow & { u_privacy: UploadPrivacy | null; u_url: string | null; u_at: Date | null; category: string | null; seconds: number | null }
  >(
    `select q.*, u.privacy as u_privacy, u.youtube_url as u_url, u.published_at as u_at, k.name as category,
        (select (a.meta->>'seconds')::float from assets a where a.episode_id = q.id and a.kind = 'final' order by a.id desc limit 1) as seconds
      from (select ${COLUMNS} from episodes
              where channel = $1 and (status = 'ready' or youtube_video_id is not null or (status = 'failed' and step = 'upload'))) q
      left join lateral (select privacy, youtube_url, published_at from uploads where episode_id = q.id order by id desc limit 1) u on true
      left join ideas i on i.episode_id = q.id
      left join channel_categories k on k.id = i.category_id
      where q.youtube_video_id is null or u.published_at is null or u.published_at > now() - interval '14 days'
      order by coalesce(u.published_at, q.updated_at)`,
    [channel],
  );
  return rows.map((row) => ({
    episode: toEpisode(row),
    upload: row.u_privacy ? { privacy: row.u_privacy, youtubeUrl: row.u_url, publishedAt: row.u_at } : null,
    category: row.category,
    seconds: row.seconds,
  }));
}

/** 업로드 큐에서 날짜를 정해야 하는 영상 수(영상 승인됨, 아직 안 올림). */
export async function countReadyToUpload(channel: string): Promise<number> {
  const [row] = await query<{ count: number }>(
    "select count(*)::int as count from episodes where channel = $1 and status = 'ready'",
    [channel],
  );
  return row.count;
}

/** 예약은 이만큼 뒤부터 고를 수 있다(업로드·처리 시간을 둔다). */
export const SCHEDULE_MIN_LEAD_MS = 30 * 60 * 1000;

/** 자동 업로드의 공개 상태를 정한다. 예약이면 privacy=private, scheduledAt=공개 시각. 업로드 대기에서만. */
export async function setUploadPlan(id: number, privacy: UploadPrivacy, scheduledAt: Date | null, now = Date.now()): Promise<void> {
  if (scheduledAt && (privacy !== "private" || scheduledAt.getTime() < now + SCHEDULE_MIN_LEAD_MS)) {
    throw new RangeError("예약 공개는 지금부터 30분 뒤 이후로 고르세요.");
  }
  const rows = await query<{ id: number }>(
    `update episodes set upload_privacy = $2, scheduled_at = $3, updated_at = now()
      where id = $1 and status in ('ready', 'failed') and (step_state is null or step_state not in ('pending', 'running')) returning id`,
    [id, privacy, scheduledAt],
  );
  if (!rows.length) throw new RangeError("업로드 대기 중일 때만 고를 수 있습니다.");
}

/**
 * 예약 공개로 올린 영상의 새 공개 시각을 정한다(reschedule 단계가 YouTube 에 반영). 올린 영상이 있고 다른 단계가 돌지 않을 때만.
 * 아직 공개 전인지는 단계가 YouTube 에서 확인한다.
 */
export async function setReschedule(id: number, scheduledAt: Date, now = Date.now()): Promise<void> {
  if (scheduledAt.getTime() < now + SCHEDULE_MIN_LEAD_MS) throw new RangeError("공개 시각은 지금부터 30분 뒤 이후로 고르세요.");
  const rows = await query<{ id: number }>(
    `update episodes set scheduled_at = $2, updated_at = now()
      where id = $1 and youtube_video_id is not null and status in ('uploaded', 'failed')
        and (step_state is null or step_state not in ('pending', 'running')) returning id`,
    [id, scheduledAt],
  );
  if (!rows.length) throw new RangeError("유튜브에 올린 영상만, 다른 작업이 끝난 뒤에 바꿀 수 있습니다.");
}

/** 사람의 승인·반려. */
export function decide(id: number, decision: Decision): Promise<Episode> {
  return updateLocked(id, (episode) => ({
    status: statusForDecision(episode, decision),
    error: null,
  }));
}
