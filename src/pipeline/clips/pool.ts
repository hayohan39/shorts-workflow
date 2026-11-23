import { query, transaction } from "@/lib/db";
import { CACHE_MAX_AGE_MS } from "@/pipeline/clips/collect";
import { isCommercialUse } from "@/pipeline/clips/license";
import { isSelectable, totalSeconds } from "@/pipeline/clips/select";
import { getCachedSearch, getClips, insertClip, saveCachedSearch, type StoredClip } from "@/pipeline/clips/store";
import type { ClipCandidate, ClipSourceId, SourceAdapter } from "@/pipeline/clips/types";

// 편집형 채널의 소재 풀(새새 열매). Claude 없이 무료 소스만 쓴다.
//   - 같은 소재(소스·ID)는 다시 넣지 않는다(채널 풀 전체 기준).
//   - 검색어는 가장 오래 안 쓴 것부터 몇 개만, 같은 검색어는 다음 페이지를 가져온다(결과가 없으면 1쪽으로 돌아간다).
//   - 아직 안 쓴 소재가 충분하면 그날은 모으지 않는다.
//   - 새 채널이라 새 소재만: iNaturalist 는 조류(Aves) 관찰만, 다른 소스는 제목·태그에 검색어나 "bird" 가 들어간 것만.
//   - 상업적 이용이 되는 라이선스만(isCommercialUse), 쓸 수 있는 크기·길이만(isSelectable).

/** 안 쓴 소재가 이만큼 있으면 수집하지 않는다. */
export const POOL_TARGET = 60;
/** 한 번에 쓰는 검색어 수 */
export const KEYWORDS_PER_RUN = 3;
/** 검색어 하나·소스 하나에 요청할 결과 수 */
const PER_KEYWORD = 20;
/** 풀에 쓰는 소스(조류 사진·영상이 많은 곳) */
export const POOL_SOURCES: readonly ClipSourceId[] = ["pixabay", "wikimedia", "inaturalist"];
export const POOL_KEYWORD_MAX = 100;

export interface PoolKeyword {
  keyword: string;
  page: number;
  lastUsedAt: Date | null;
}

export async function listPoolKeywords(channel: string): Promise<PoolKeyword[]> {
  const rows = await query<{ keyword: string; page: number; last_used_at: Date | null }>(
    "select keyword, page, last_used_at from pool_keywords where channel = $1 order by keyword",
    [channel],
  );
  return rows.map((row) => ({ keyword: row.keyword, page: row.page, lastUsedAt: row.last_used_at }));
}

/** 검색어 목록을 바꾼다(한 줄에 하나). 남은 검색어의 페이지·사용 기록은 그대로 둔다. 잘못된 값은 RangeError. */
export async function setPoolKeywords(channel: string, text: string): Promise<string[]> {
  const keywords = [
    ...new Set(
      text
        .split("\n")
        .map((line) => line.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  if (!keywords.length) throw new RangeError("검색어를 하나 이상 넣으세요.");
  if (keywords.length > POOL_KEYWORD_MAX) throw new RangeError(`검색어는 ${POOL_KEYWORD_MAX}개까지입니다.`);
  const long = keywords.find((keyword) => keyword.length > 60);
  if (long) throw new RangeError(`검색어는 60자 이내로 입력하세요: ${long.slice(0, 20)}…`);
  await transaction(async (client) => {
    await client.query("delete from pool_keywords where channel = $1 and keyword <> all($2)", [channel, keywords]);
    await client.query("insert into pool_keywords (channel, keyword) select $1, unnest($2::text[]) on conflict do nothing", [
      channel,
      keywords,
    ]);
  });
  return keywords;
}

/** 채널 풀에서 아직 에피소드에 쓰지 않은 소재 수. */
export async function poolStock(channel: string): Promise<number> {
  const [row] = await query<{ count: number }>(
    `select count(*)::int as count from clip_candidates c join clip_collections k on k.id = c.collection_id
      where k.kind = 'pool' and k.channel = $1 and c.pool_used_at is null`,
    [channel],
  );
  return row.count;
}

/**
 * 스토리에 쓸 수 있는 풀 소재(최근에 모은 것부터): 에피소드에 쓰지 않았고, 아직 보지 않았거나 저장한 스토리에 들어 있지 않은 것.
 */
export async function availablePoolItems(channel: string, limit = 40): Promise<StoredClip[]> {
  const rows = await query<{ id: number }>(
    `select c.id from clip_candidates c join clip_collections k on k.id = c.collection_id
      where k.kind = 'pool' and k.channel = $1 and c.pool_used_at is null
        and not exists (
          select 1 from ideas i where i.channel = $1 and i.status in ('new', 'saved') and c.id = any(i.clip_ids))
      order by c.id desc limit $2`,
    [channel, limit],
  );
  return getClips(rows.map((row) => row.id));
}

/** 에피소드로 만든 스토리의 소재를 "사용됨" 으로 표시한다. */
export async function markPoolUsed(ids: number[]): Promise<void> {
  await query("update clip_candidates set pool_used_at = now() where id = any($1::int[]) and pool_used_at is null", [ids]);
}

/** 새 채널용: iNaturalist 는 조류 관찰만, 다른 소스는 제목·태그에 검색어의 낱말이나 "bird" 가 있어야 한다. */
export function isBirdItem(clip: Pick<ClipCandidate, "source" | "title" | "license">, keyword: string): boolean {
  if (clip.source === "inaturalist") return clip.license.raw.iconic_taxon_name === "Aves";
  const title = clip.title.toLowerCase();
  const words = keyword
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 2);
  return /\bbirds?\b/.test(title) || words.some((word) => title.includes(word));
}

export interface PoolResult {
  /** 안 쓴 소재가 충분해 건너뛰었는가 */
  skipped: boolean;
  added: number;
  stock: number;
  keywords: string[];
  errors: string[];
}

/** 소재 풀 채우기 한 번. 소스 하나가 실패해도 나머지로 계속하고, 이유는 errors 에 남긴다. */
export async function collectPool(
  channel: string,
  deps: { adapters: SourceAdapter[]; fetchImpl?: typeof fetch; now?: () => number },
): Promise<PoolResult> {
  const stock = await poolStock(channel);
  if (stock >= POOL_TARGET) return { skipped: true, added: 0, stock, keywords: [], errors: [] };

  const due = await query<{ keyword: string; page: number }>(
    `select keyword, page from pool_keywords where channel = $1 order by last_used_at nulls first, keyword limit $2`,
    [channel, KEYWORDS_PER_RUN],
  );
  const known = new Set(
    (
      await query<{ key: string }>(
        `select c.source || ':' || c.source_id as key from clip_candidates c join clip_collections k on k.id = c.collection_id
          where k.kind = 'pool' and k.channel = $1`,
        [channel],
      )
    ).map((row) => row.key),
  );
  const adapters = deps.adapters.filter((adapter) => POOL_SOURCES.includes(adapter.id) && adapter.availability().ok);
  const added: ClipCandidate[] = [];
  const errors: string[] = [];

  for (const { keyword, page } of due) {
    let found = 0;
    for (const adapter of adapters) {
      try {
        // 페이지마다 따로 캐시한다(Pixabay 이용 조건: 같은 요청은 24시간 캐시).
        const cacheKey = `${keyword}#p${page}`;
        let clips = (await getCachedSearch(adapter.id, cacheKey, CACHE_MAX_AGE_MS))?.clips;
        if (!clips) {
          clips = await adapter.search(keyword, { limit: PER_KEYWORD, page, iconicTaxa: "Aves", fetchImpl: deps.fetchImpl });
          await saveCachedSearch(adapter.id, cacheKey, clips);
        }
        found += clips.length;
        for (const clip of clips) {
          const key = `${clip.source}:${clip.sourceId}`;
          if (known.has(key) || !isCommercialUse(clip) || !isSelectable(clip) || !isBirdItem(clip, keyword)) continue;
          known.add(key);
          added.push(clip);
        }
      } catch (error) {
        errors.push(`${adapter.label} "${keyword}": ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    // 결과가 있었으면 다음엔 다음 페이지, 끝까지 봤으면 처음부터.
    await query("update pool_keywords set page = $3, last_used_at = $4 where channel = $1 and keyword = $2", [
      channel,
      keyword,
      found ? page + 1 : 1,
      new Date((deps.now ?? Date.now)()),
    ]);
  }

  if (added.length) {
    const keywords = due.map((row) => row.keyword);
    await transaction(async (client) => {
      const {
        rows: [collection],
      } = await client.query<{ id: number }>(
        `insert into clip_collections (kind, channel, topic, status, keywords, source_results, total_seconds, finished_at)
          values ('pool', $1, $2, 'done', $3, '{}', $4, now()) returning id`,
        [channel, `소재 풀 · ${keywords.join(", ")}`, keywords, totalSeconds(added)],
      );
      const fetchedAt = new Date();
      for (const [index, clip] of added.entries()) await insertClip(client, collection.id, clip, index + 1, fetchedAt);
    });
  }
  return { skipped: false, added: added.length, stock: stock + added.length, keywords: due.map((row) => row.keyword), errors };
}

/**
 * 스토리로 만든 편집형 에피소드의 소재 찾기 결과: 고른 풀 소재를 장면 순서대로 그 에피소드의 수집으로 옮겨 적는다.
 * 그러면 고르기·채택·장면 채우기는 직접 찾은 편집형 에피소드와 똑같이 돈다. 새 소재 ID(장면 순서)를 돌려준다.
 */
export async function createStoryCollection(episodeId: number, topic: string, clips: StoredClip[]): Promise<number[]> {
  return transaction(async (client) => {
    const keywords = [...new Set(clips.map((clip) => clip.keyword))];
    const {
      rows: [collection],
    } = await client.query<{ id: number }>(
      `insert into clip_collections (kind, topic, episode_id, status, keywords, source_results, total_seconds, finished_at)
        values ('search', $1, $2, 'done', $3, '{}', $4, now()) returning id`,
      [topic.slice(0, 200), episodeId, keywords, totalSeconds(clips)],
    );
    const fetchedAt = new Date();
    for (const [index, clip] of clips.entries()) await insertClip(client, collection.id, clip, index + 1, fetchedAt);
    const { rows } = await client.query<{ id: number }>("select id from clip_candidates where collection_id = $1 order by rank", [
      collection.id,
    ]);
    return rows.map((row) => row.id);
  });
}
