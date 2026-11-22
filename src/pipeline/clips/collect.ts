import { RateLimitError } from "@/pipeline/clips/http";
import { expandKeywords, type CreateMessage } from "@/pipeline/clips/keywords";
import { isCommercialUse } from "@/pipeline/clips/license";
import { selectClips } from "@/pipeline/clips/select";
import {
  finishCollection,
  getCachedSearch,
  listSourceStates,
  recordSourceRequest,
  saveCachedSearch,
  setSourceRetryAt,
  type ClipCollection,
  type SourceResult,
} from "@/pipeline/clips/store";
import { SOURCE_LABELS, type ClipCandidate, type ClipSourceId, type SourceAdapter } from "@/pipeline/clips/types";

// 수집 한 번: 주제 → 영어 키워드 → 소스마다 키워드별 검색(24시간 캐시) → 라이선스 재확인 → 선별 → DB.
// 소스 하나가 실패하거나 한도에 걸려도 나머지 소스로 계속한다. 이유는 소스별 결과(source_results)에 남긴다.

/** 키워드 하나에 소스별로 요청할 결과 수 */
const PER_KEYWORD = 20;
/** 응답 캐시 유효 시간(Pixabay 이용 조건: 24시간 캐시) */
export const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface CollectDeps {
  adapters: SourceAdapter[];
  send: CreateMessage;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/** 요청마다 상태 코드를 기록하는 fetch. 기록이 실패해도 검색은 계속한다. */
function recordingFetch(source: ClipSourceId, fetchImpl: typeof fetch): typeof fetch {
  return async (input, init) => {
    const response = await fetchImpl(input, init);
    await recordSourceRequest(source, response.status).catch((error: unknown) => {
      console.warn(`${source} 호출 기록 실패: ${error instanceof Error ? error.message : String(error)}`);
    });
    return response;
  };
}

export async function collectClips(collection: ClipCollection, deps: CollectDeps): Promise<ClipCollection> {
  const now = deps.now ?? Date.now;
  const { keywords, costUsd } = await expandKeywords(collection.topic, deps.send);
  const retryAt = new Map((await listSourceStates()).map((state) => [state.source, state.retryAt]));

  const candidates: ClipCandidate[] = [];
  const fetchedAt = new Map<ClipCandidate, Date>();
  const sourceResults: Partial<Record<ClipSourceId, SourceResult>> = {};

  for (const adapter of deps.adapters) {
    const result: SourceResult = { found: 0, kept: 0 };
    sourceResults[adapter.id] = result;
    const availability = adapter.availability();
    if (!availability.ok) {
      result.error = availability.reason;
      continue;
    }
    const waitUntil = retryAt.get(adapter.id);
    if (waitUntil && waitUntil.getTime() > now()) {
      result.error = `요청 한도 대기 중(${waitUntil.toISOString()} 이후 다시 시도)`;
      continue;
    }

    const errors: string[] = [];
    const fetchImpl = recordingFetch(adapter.id, deps.fetchImpl ?? fetch);
    for (const keyword of keywords) {
      try {
        let found = await getCachedSearch(adapter.id, keyword, CACHE_MAX_AGE_MS);
        if (!found) {
          const clips = await adapter.search(keyword, { limit: PER_KEYWORD, fetchImpl });
          found = { clips, fetchedAt: await saveCachedSearch(adapter.id, keyword, clips) };
        }
        // 상업적 이용이 되는 라이선스만 남긴다(어댑터가 이미 거르지만 캐시·소스 변경에 대비해 한 번 더).
        const allowed = found.clips.filter(isCommercialUse);
        for (const clip of allowed) fetchedAt.set(clip, found.fetchedAt);
        candidates.push(...allowed);
        result.found += allowed.length;
      } catch (error) {
        if (error instanceof RateLimitError) {
          await setSourceRetryAt(adapter.id, error.retryAt);
          errors.push(error.message);
          break;
        }
        errors.push(`"${keyword}": ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (errors.length) result.error = errors.join(" / ");
  }

  // 모든 소스가 실패했으면 "결과 없음" 이 아니라 실패로 남긴다(키·네트워크 문제를 화면에서 바로 알 수 있게).
  const failures = Object.entries(sourceResults).filter(([, result]) => result.error && result.found === 0);
  if (candidates.length === 0 && failures.length === deps.adapters.length) {
    throw new Error(failures.map(([id, result]) => `${SOURCE_LABELS[id as ClipSourceId]}: ${result.error}`).join("\n"));
  }

  const selection = selectClips(candidates);
  for (const clip of selection.selected) sourceResults[clip.source]!.kept += 1;
  return finishCollection(collection.id, { keywords, keywordCostUsd: costUsd, sourceResults, selection, fetchedAt });
}
