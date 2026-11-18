import type { PoolClient } from "pg";
import { query, transaction } from "@/lib/db";
import { redact } from "@/lib/health";
import { clipScore, totalSeconds, type Selection } from "@/pipeline/clips/select";
import type { ClipCandidate, ClipLicense, ClipSourceId, LicenseCode } from "@/pipeline/clips/types";

// 클립 수집·채택의 DB 기록. 수집과 채택은 Actions 에서 돌고, 대시보드는 요청과 [교체]만 한다.

export type JobStatus = "queued" | "running" | "done" | "failed";

export const TOPIC_MAX = 100;
/** 이 시간이 지나도록 대기·실행 중이면 Actions 가 죽은 것으로 보고 다시 요청을 허용한다. */
export const CLIP_STALE_MS: Record<"queued" | "running", number> = { queued: 10 * 60 * 1000, running: 50 * 60 * 1000 };

export interface SourceResult {
  found: number;
  kept: number;
  error?: string;
}

export interface ClipCollection {
  id: number;
  kind: "search" | "daily";
  topic: string;
  /** 에피소드(clips 길)에서 찾은 것이면 그 에피소드. 채택은 그 에피소드가 고른 클립만 한다. */
  episodeId: number | null;
  status: JobStatus;
  keywords: string[];
  sourceResults: Partial<Record<ClipSourceId, SourceResult>>;
  totalSeconds: number | null;
  shortfall: string | null;
  keywordCostUsd: number | null;
  runUrl: string | null;
  error: string | null;
  adoptStatus: JobStatus | null;
  adoptError: string | null;
  adoptRunUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
  finishedAt: Date | null;
}

export interface StoredClip extends ClipCandidate {
  id: number;
  collectionId: number;
  /** 선택된 클립의 순서(1부터). null 이면 교체 후보 */
  rank: number | null;
  score: number;
  fetchedAt: Date;
  blobUrl: string | null;
  adoptedAt: Date | null;
}

interface CollectionRow {
  id: number;
  kind: ClipCollection["kind"];
  topic: string;
  episode_id: number | null;
  status: JobStatus;
  keywords: string[];
  source_results: ClipCollection["sourceResults"];
  total_seconds: string | null;
  shortfall: string | null;
  keyword_cost_usd: string | null;
  run_url: string | null;
  error: string | null;
  adopt_status: JobStatus | null;
  adopt_error: string | null;
  adopt_run_url: string | null;
  created_at: Date;
  updated_at: Date;
  finished_at: Date | null;
}

interface ClipRow {
  id: number;
  collection_id: number;
  source: ClipSourceId;
  source_id: string;
  keyword: string;
  title: string;
  page_url: string;
  thumbnail_url: string | null;
  preview_url: string | null;
  download_url: string | null;
  width: number | null;
  height: number | null;
  duration_sec: string | null;
  author: string | null;
  author_url: string | null;
  license_code: LicenseCode;
  license_name: string;
  license_url: string | null;
  license_raw: ClipLicense["raw"];
  fetched_at: Date;
  score: string;
  rank: number | null;
  blob_url: string | null;
  adopted_at: Date | null;
}

const COLLECTION_COLUMNS = `id, kind, topic, episode_id, status, keywords, source_results, total_seconds, shortfall, keyword_cost_usd,
  run_url, error, adopt_status, adopt_error, adopt_run_url, created_at, updated_at, finished_at`;

const CLIP_COLUMNS = `id, collection_id, source, source_id, keyword, title, page_url, thumbnail_url, preview_url, download_url,
  width, height, duration_sec, author, author_url, license_code, license_name, license_url, license_raw, fetched_at,
  score, rank, blob_url, adopted_at`;

const numberOrNull = (value: string | null) => (value === null ? null : Number(value));

function toCollection(row: CollectionRow): ClipCollection {
  return {
    id: row.id,
    kind: row.kind,
    topic: row.topic,
    episodeId: row.episode_id,
    status: row.status,
    keywords: row.keywords,
    sourceResults: row.source_results,
    totalSeconds: numberOrNull(row.total_seconds),
    shortfall: row.shortfall,
    keywordCostUsd: numberOrNull(row.keyword_cost_usd),
    runUrl: row.run_url,
    error: row.error,
    adoptStatus: row.adopt_status,
    adoptError: row.adopt_error,
    adoptRunUrl: row.adopt_run_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at,
  };
}

function toClip(row: ClipRow): StoredClip {
  return {
    id: row.id,
    collectionId: row.collection_id,
    source: row.source,
    sourceId: row.source_id,
    keyword: row.keyword,
    title: row.title,
    pageUrl: row.page_url,
    thumbnailUrl: row.thumbnail_url,
    previewUrl: row.preview_url,
    downloadUrl: row.download_url,
    width: row.width,
    height: row.height,
    durationSec: numberOrNull(row.duration_sec),
    author: row.author,
    authorUrl: row.author_url,
    license: { code: row.license_code, name: row.license_name, url: row.license_url, raw: row.license_raw },
    rank: row.rank,
    score: Number(row.score),
    fetchedAt: row.fetched_at,
    blobUrl: row.blob_url,
    adoptedAt: row.adopted_at,
  };
}

/** 대기·실행 중이고 아직 멈춘 것으로 볼 만큼 오래되지 않았는가. */
export function isJobBusy(status: JobStatus | null, updatedAt: Date, now = Date.now()): boolean {
  if (status !== "queued" && status !== "running") return false;
  return now - updatedAt.getTime() <= CLIP_STALE_MS[status];
}

const cleanError = (message: string) => redact(message).slice(0, 2000);

// ── 수집 ────────────────────────────────────────────────────────────

/**
 * 주제 검색을 대기열에 넣는다. 주제가 비었거나 너무 길면 RangeError.
 * 연관 단어는 주제 뒤에 붙여 키워드를 만들 때 함께 본다. 에피소드에서 찾으면 그 에피소드에 묶는다.
 */
export async function createSearchCollection(
  topicInput: string,
  options: { related?: string; episodeId?: number } = {},
): Promise<ClipCollection> {
  const topic = topicInput.replace(/\s+/g, " ").trim();
  const related = (options.related ?? "").replace(/\s+/g, " ").trim();
  if (!topic) throw new RangeError("주제를 입력하세요.");
  if (topic.length > TOPIC_MAX) throw new RangeError(`주제는 ${TOPIC_MAX}자 이내로 입력하세요.`);
  if (related.length > TOPIC_MAX) throw new RangeError(`연관 단어는 ${TOPIC_MAX}자 이내로 입력하세요.`);
  const [row] = await query<CollectionRow>(
    `insert into clip_collections (kind, topic, episode_id) values ('search', $1, $2) returning ${COLLECTION_COLUMNS}`,
    [related ? `${topic} (연관 단어: ${related})` : topic, options.episodeId ?? null],
  );
  return toCollection(row);
}

/** 에피소드에서 찾은 가장 최근 수집. */
export async function episodeCollection(episodeId: number): Promise<ClipCollection | null> {
  const [row] = await query<CollectionRow>(
    `select ${COLLECTION_COLUMNS} from clip_collections where episode_id = $1 order by id desc limit 1`,
    [episodeId],
  );
  return row ? toCollection(row) : null;
}

export async function getCollection(id: number): Promise<ClipCollection | null> {
  const [row] = await query<CollectionRow>(`select ${COLLECTION_COLUMNS} from clip_collections where id = $1`, [id]);
  return row ? toCollection(row) : null;
}

export async function listCollections(limit = 20): Promise<ClipCollection[]> {
  const rows = await query<CollectionRow>(
    `select ${COLLECTION_COLUMNS} from clip_collections order by created_at desc, id desc limit $1`,
    [limit],
  );
  return rows.map(toCollection);
}

/** 실패했거나 멈춘 수집을 다시 대기열에 넣는다. 진행 중이면 null. */
export async function requeueCollection(id: number, now = Date.now()): Promise<ClipCollection | null> {
  const current = await getCollection(id);
  if (!current || current.status === "done" || isJobBusy(current.status, current.updatedAt, now)) return null;
  const [row] = await query<CollectionRow>(
    `update clip_collections set status = 'queued', error = null, updated_at = now()
      where id = $1 and status = $2 returning ${COLLECTION_COLUMNS}`,
    [id, current.status],
  );
  return row ? toCollection(row) : null;
}

/** Actions 가 수집을 시작할 때. 이미 끝난 수집이면 null(다시 돌리지 않는다). */
export async function startCollection(id: number, runUrl: string | null): Promise<ClipCollection | null> {
  const [row] = await query<CollectionRow>(
    `update clip_collections set status = 'running', run_url = $2, error = null, updated_at = now()
      where id = $1 and status <> 'done' returning ${COLLECTION_COLUMNS}`,
    [id, runUrl],
  );
  return row ? toCollection(row) : null;
}

export interface CollectResult {
  keywords: string[];
  keywordCostUsd: number | null;
  sourceResults: ClipCollection["sourceResults"];
  selection: Selection;
  /** 후보마다 소스에서 받은 시각(캐시에서 꺼냈으면 캐시 시각) */
  fetchedAt: Map<ClipCandidate, Date>;
}

/** 선택된 클립(rank 순)과 교체 후보를 저장하고 수집을 끝낸다. */
export async function finishCollection(id: number, result: CollectResult): Promise<ClipCollection> {
  return transaction(async (client) => {
    await client.query("delete from clip_candidates where collection_id = $1", [id]);
    const ranked = [
      ...result.selection.selected.map((clip, index) => ({ clip, rank: index + 1 })),
      ...result.selection.alternates.map((clip) => ({ clip, rank: null })),
    ];
    for (const { clip, rank } of ranked) {
      await insertClip(client, id, clip, rank, result.fetchedAt.get(clip) ?? new Date());
    }
    const { rows } = await client.query<CollectionRow>(
      `update clip_collections
          set status = 'done', keywords = $2, source_results = $3, total_seconds = $4, shortfall = $5,
              keyword_cost_usd = $6, error = null, finished_at = now(), updated_at = now()
        where id = $1 returning ${COLLECTION_COLUMNS}`,
      [
        id,
        result.keywords,
        JSON.stringify(result.sourceResults),
        result.selection.totalSec,
        result.selection.shortfall,
        result.keywordCostUsd,
      ],
    );
    return toCollection(rows[0]);
  });
}

async function insertClip(client: PoolClient, collectionId: number, clip: ClipCandidate, rank: number | null, fetchedAt: Date) {
  await client.query(
    `insert into clip_candidates (collection_id, source, source_id, keyword, title, page_url, thumbnail_url, preview_url,
        download_url, width, height, duration_sec, author, author_url, license_code, license_name, license_url,
        license_raw, fetched_at, score, rank)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
    [
      collectionId,
      clip.source,
      clip.sourceId,
      clip.keyword,
      clip.title,
      clip.pageUrl,
      clip.thumbnailUrl,
      clip.previewUrl,
      clip.downloadUrl,
      clip.width,
      clip.height,
      clip.durationSec,
      clip.author,
      clip.authorUrl,
      clip.license.code,
      clip.license.name,
      clip.license.url,
      JSON.stringify(clip.license.raw),
      fetchedAt,
      clipScore(clip),
      rank,
    ],
  );
}

/** 실패 기록. 이미 끝난 수집은 건드리지 않는다. */
export async function failCollection(id: number, message: string): Promise<ClipCollection | null> {
  const [row] = await query<CollectionRow>(
    `update clip_collections set status = 'failed', error = $2, finished_at = now(), updated_at = now()
      where id = $1 and status in ('queued', 'running') returning ${COLLECTION_COLUMNS}`,
    [id, cleanError(message)],
  );
  return row ? toCollection(row) : null;
}

/** 매일 자동 수집 하나를 만든다(Actions 가 바로 실행한다). */
export async function createDailyCollection(tag: ClipTag): Promise<ClipCollection> {
  const [row] = await query<CollectionRow>(
    `insert into clip_collections (kind, topic, tag_id, status) values ('daily', $1, $2, 'queued')
     returning ${COLLECTION_COLUMNS}`,
    [tag.name, tag.id],
  );
  return toCollection(row);
}

// ── 후보·교체 ────────────────────────────────────────────────────────

/** 선택된 클립(순서대로) 다음에 교체 후보(점수 순). */
export async function listClips(collectionId: number): Promise<StoredClip[]> {
  const rows = await query<ClipRow>(
    `select ${CLIP_COLUMNS} from clip_candidates where collection_id = $1
      order by rank nulls last, score desc, id`,
    [collectionId],
  );
  return rows.map(toClip);
}

/** 채택해서 Blob 에 있는 클립(최근 채택 순). 에피소드 장면에 넣을 후보. */
export async function listAdoptedClips(limit = 24): Promise<StoredClip[]> {
  const rows = await query<ClipRow>(
    `select ${CLIP_COLUMNS} from clip_candidates where blob_url is not null order by adopted_at desc, id desc limit $1`,
    [limit],
  );
  return rows.map(toClip);
}

/** ID 로 클립들을 가져온다(순서는 주어진 ID 순). */
export async function getClips(ids: number[]): Promise<StoredClip[]> {
  if (ids.length === 0) return [];
  const rows = await query<ClipRow>(`select ${CLIP_COLUMNS} from clip_candidates where id = any($1::int[])`, [ids]);
  const byId = new Map(rows.map((row) => [row.id, toClip(row)]));
  return ids.flatMap((id) => byId.get(id) ?? []);
}

/**
 * 선택된 클립 하나를 교체 후보와 바꾼다(순서는 그대로). 합계 길이를 다시 센다.
 * 채택이 진행 중이거나, 두 클립이 이 수집의 선택/후보가 아니면 RangeError.
 */
export async function swapClip(collectionId: number, selectedId: number, alternateId: number, now = Date.now()) {
  return transaction(async (client) => {
    const { rows: collections } = await client.query<CollectionRow>(
      `select ${COLLECTION_COLUMNS} from clip_collections where id = $1 for update`,
      [collectionId],
    );
    const collection = collections[0] ? toCollection(collections[0]) : null;
    if (!collection || collection.status !== "done") throw new RangeError("수집이 끝난 뒤에 교체할 수 있습니다.");
    if (isJobBusy(collection.adoptStatus, collection.updatedAt, now)) {
      throw new RangeError("채택이 진행 중입니다. 끝난 뒤에 교체하세요.");
    }
    const { rows } = await client.query<{ id: number; rank: number | null; download_url: string | null }>(
      "select id, rank, download_url from clip_candidates where collection_id = $1 and id = any($2::int[])",
      [collectionId, [selectedId, alternateId]],
    );
    const selected = rows.find((row) => row.id === selectedId);
    const alternate = rows.find((row) => row.id === alternateId);
    if (!selected?.rank || !alternate || alternate.rank !== null || !alternate.download_url) {
      throw new RangeError("교체할 수 없는 클립입니다. 화면을 새로 고쳐 다시 시도하세요.");
    }
    await client.query("update clip_candidates set rank = null where id = $1", [selectedId]);
    await client.query("update clip_candidates set rank = $2 where id = $1", [alternateId, selected.rank]);
    const { rows: ranked } = await client.query<{ duration_sec: string | null }>(
      "select duration_sec from clip_candidates where collection_id = $1 and rank is not null",
      [collectionId],
    );
    const total = totalSeconds(ranked.map((row) => ({ durationSec: numberOrNull(row.duration_sec) })));
    await client.query("update clip_collections set updated_at = now(), total_seconds = $2 where id = $1", [
      collectionId,
      total,
    ]);
  });
}

// ── 채택 ─────────────────────────────────────────────────────────────

/** 채택을 대기열에 넣는다. 수집이 안 끝났거나 이미 채택 중이면 null. */
export async function requestAdopt(id: number, now = Date.now()): Promise<ClipCollection | null> {
  const current = await getCollection(id);
  if (!current || current.status !== "done" || isJobBusy(current.adoptStatus, current.updatedAt, now)) return null;
  const [row] = await query<CollectionRow>(
    `update clip_collections set adopt_status = 'queued', adopt_error = null, updated_at = now()
      where id = $1 and adopt_status is not distinct from $2 returning ${COLLECTION_COLUMNS}`,
    [id, current.adoptStatus],
  );
  return row ? toCollection(row) : null;
}

export async function startAdopt(id: number, runUrl: string | null): Promise<ClipCollection | null> {
  const [row] = await query<CollectionRow>(
    `update clip_collections set adopt_status = 'running', adopt_run_url = $2, adopt_error = null, updated_at = now()
      where id = $1 and status = 'done' returning ${COLLECTION_COLUMNS}`,
    [id, runUrl],
  );
  return row ? toCollection(row) : null;
}

export async function finishAdopt(id: number): Promise<void> {
  await query("update clip_collections set adopt_status = 'done', adopt_error = null, updated_at = now() where id = $1", [id]);
}

export async function failAdopt(id: number, message: string): Promise<ClipCollection | null> {
  const [row] = await query<CollectionRow>(
    `update clip_collections set adopt_status = 'failed', adopt_error = $2, updated_at = now()
      where id = $1 and adopt_status in ('queued', 'running') returning ${COLLECTION_COLUMNS}`,
    [id, cleanError(message)],
  );
  return row ? toCollection(row) : null;
}

/** 변환·업로드가 끝난 클립. */
export async function saveAdoptedClip(clipId: number, blobUrl: string): Promise<void> {
  await query("update clip_candidates set blob_url = $2, adopted_at = now() where id = $1", [clipId, blobUrl]);
}

// ── 매일 자동 수집·태그 ─────────────────────────────────────────────

export const TAG_MAX = 50;
/** 이 기간 안에 쓴 태그는 매일 수집에서 건너뛴다 */
const TAG_COOLDOWN_DAYS = 7;

export interface ClipTag {
  id: number;
  name: string;
  active: boolean;
  lastUsedAt: Date | null;
}

interface TagRow {
  id: number;
  name: string;
  active: boolean;
  last_used_at: Date | null;
}

const toTag = (row: TagRow): ClipTag => ({ id: row.id, name: row.name, active: row.active, lastUsedAt: row.last_used_at });

export async function isDailyEnabled(): Promise<boolean> {
  const [row] = await query<{ clips_daily: boolean }>("select clips_daily from settings");
  return row?.clips_daily ?? false;
}

export async function setDailyEnabled(enabled: boolean): Promise<void> {
  await query("update settings set clips_daily = $1, updated_at = now()", [enabled]);
}

export async function listTags(): Promise<ClipTag[]> {
  const rows = await query<TagRow>("select id, name, active, last_used_at from clip_tags order by name");
  return rows.map(toTag);
}

/** 태그 추가. 이미 있으면 다시 켠다. 비었거나 너무 길면 RangeError. */
export async function addTag(nameInput: string): Promise<ClipTag> {
  const name = nameInput.replace(/\s+/g, " ").trim();
  if (!name) throw new RangeError("태그를 입력하세요.");
  if (name.length > TAG_MAX) throw new RangeError(`태그는 ${TAG_MAX}자 이내로 입력하세요.`);
  const [row] = await query<TagRow>(
    `insert into clip_tags (name) values ($1) on conflict (name) do update set active = true
     returning id, name, active, last_used_at`,
    [name],
  );
  return toTag(row);
}

export async function setTagActive(id: number, active: boolean): Promise<void> {
  await query("update clip_tags set active = $2 where id = $1", [id, active]);
}

/** 태그 삭제. 그 태그로 만든 수집은 남는다(tag_id 만 비워진다). */
export async function deleteTag(id: number): Promise<void> {
  await query("delete from clip_tags where id = $1", [id]);
}

/** 매일 수집에 쓸 태그: 켜져 있고 최근 7일 안에 쓰지 않은 것 중 무작위 하나. 고른 태그는 사용 시각을 남긴다. */
export async function pickDailyTag(): Promise<ClipTag | null> {
  const [row] = await query<TagRow>(
    `update clip_tags set last_used_at = now()
      where id = (
        select id from clip_tags
         where active and (last_used_at is null or last_used_at < now() - make_interval(days => $1))
         order by random() limit 1)
      returning id, name, active, last_used_at`,
    [TAG_COOLDOWN_DAYS],
  );
  return row ? toTag(row) : null;
}

// ── 소스 응답 캐시·호출 기록 ─────────────────────────────────────────

/** 캐시된 검색 결과(후보 목록). maxAgeMs 보다 오래됐으면 null. */
export async function getCachedSearch(
  source: ClipSourceId,
  keyword: string,
  maxAgeMs: number,
): Promise<{ clips: ClipCandidate[]; fetchedAt: Date } | null> {
  const [row] = await query<{ response: ClipCandidate[]; fetched_at: Date }>(
    `select response, fetched_at from clip_search_cache
      where source = $1 and query = $2 and fetched_at > now() - make_interval(secs => $3)`,
    [source, keyword, maxAgeMs / 1000],
  );
  return row ? { clips: row.response, fetchedAt: row.fetched_at } : null;
}

export async function saveCachedSearch(source: ClipSourceId, keyword: string, clips: ClipCandidate[]): Promise<Date> {
  const [row] = await query<{ fetched_at: Date }>(
    `insert into clip_search_cache (source, query, response, fetched_at) values ($1, $2, $3, now())
     on conflict (source, query) do update set response = excluded.response, fetched_at = now()
     returning fetched_at`,
    [source, keyword, JSON.stringify(clips)],
  );
  return row.fetched_at;
}

export interface SourceState {
  source: ClipSourceId;
  /** 오늘(KST) 요청 수 */
  requestsToday: number;
  lastStatus: number | null;
  last429At: Date | null;
  /** 요청 한도에 걸려 아직 기다려야 하면 그 시각, 아니면 null */
  retryAt: Date | null;
  updatedAt: Date;
}

/** 요청 하나를 센다. 429 면 마지막 429 시각도 남긴다. */
export async function recordSourceRequest(source: ClipSourceId, status: number): Promise<void> {
  await query(
    `insert into clip_source_state (source, day, requests, last_status, last_429_at, updated_at)
     values ($1, (now() at time zone 'Asia/Seoul')::date, 1, $2, case when $2 = 429 then now() end, now())
     on conflict (source) do update set
       requests = case when clip_source_state.day = excluded.day then clip_source_state.requests + 1 else 1 end,
       day = excluded.day,
       last_status = excluded.last_status,
       last_429_at = coalesce(excluded.last_429_at, clip_source_state.last_429_at),
       updated_at = now()`,
    [source, status],
  );
}

/** 요청 한도에 걸려 기다려야 하는 시각을 남긴다(요청 수는 늘리지 않는다). */
export async function setSourceRetryAt(source: ClipSourceId, retryAt: Date): Promise<void> {
  await query(
    `insert into clip_source_state (source, day, requests, retry_at, updated_at)
     values ($1, (now() at time zone 'Asia/Seoul')::date, 0, $2, now())
     on conflict (source) do update set retry_at = excluded.retry_at, updated_at = now()`,
    [source, retryAt],
  );
}

export async function listSourceStates(): Promise<SourceState[]> {
  const rows = await query<{
    source: ClipSourceId;
    requests_today: number;
    last_status: number | null;
    last_429_at: Date | null;
    retry_at: Date | null;
    updated_at: Date;
  }>(
    `select source,
            case when day = (now() at time zone 'Asia/Seoul')::date then requests else 0 end as requests_today,
            last_status, last_429_at, case when retry_at > now() then retry_at end as retry_at, updated_at
       from clip_source_state order by source`,
  );
  return rows.map((row) => ({
    source: row.source,
    requestsToday: row.requests_today,
    lastStatus: row.last_status,
    last429At: row.last_429_at,
    retryAt: row.retry_at,
    updatedAt: row.updated_at,
  }));
}
