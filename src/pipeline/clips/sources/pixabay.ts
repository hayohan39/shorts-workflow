import { fetchSourceJson } from "@/pipeline/clips/http";
import { SOURCE_LABELS, type ClipCandidate, type SearchOptions, type SourceAdapter } from "@/pipeline/clips/types";

// Pixabay 영상 검색 API (https://pixabay.com/api/docs/#api_search_videos).
//   GET https://pixabay.com/api/videos/?key=…&q=…&per_page=3~200
//   한도 100회/60초(키 기준), 응답은 24시간 캐시해야 하고 파일을 계속 핫링크하면 안 된다 → 채택할 때 내려받는다.
//   방향·길이 필터가 없어 받은 뒤 선별에서 거른다. 제목이 없어 태그를 제목으로 쓴다.
//   라이선스: Pixabay Content License(상업적 이용·수정 가능, 원본 그대로 재배포 금지). 출처 표기는 필수는 아니지만 남긴다.
// 필드명은 공식 문서 기준이고, 2026-10-22 첫 실제 수집(Actions)에서 그대로 동작하는 것을 확인했다.

const ENDPOINT = "https://pixabay.com/api/videos/";
const LICENSE_URL = "https://pixabay.com/service/license-summary/";

interface PixabayRendition {
  url: string;
  width: number;
  height: number;
  size: number;
  thumbnail?: string;
}

interface PixabayHit {
  id: number;
  pageURL: string;
  tags: string;
  duration: number;
  videos: Partial<Record<"large" | "medium" | "small" | "tiny", PixabayRendition>>;
  user_id: number;
  user: string;
}

export interface PixabayResponse {
  total: number;
  totalHits: number;
  hits: PixabayHit[];
}

const MISSING_KEY = "PIXABAY_API_KEY 가 없습니다. https://pixabay.com/api/docs/ 에서 키를 받아 GitHub Secrets 에 넣으세요.";

export function createPixabayAdapter(env: Record<string, string | undefined> = process.env): SourceAdapter {
  const key = env.PIXABAY_API_KEY || null;
  return {
    id: "pixabay",
    label: SOURCE_LABELS.pixabay,
    availability: () => (key ? { ok: true } : { ok: false, reason: MISSING_KEY }),
    search: async (query, options) => {
      if (!key) throw new Error(MISSING_KEY);
      return searchPixabay(query, options, key);
    },
  };
}

async function searchPixabay(query: string, options: SearchOptions, key: string): Promise<ClipCandidate[]> {
  const params = new URLSearchParams({
    key,
    q: query.slice(0, 100),
    safesearch: "true",
    per_page: String(Math.min(Math.max(options.limit, 3), 200)),
  });
  const body = await fetchSourceJson<PixabayResponse>(`${ENDPOINT}?${params}`, {
    source: "pixabay",
    fetchImpl: options.fetchImpl,
  });
  return body.hits.flatMap((hit) => toCandidate(hit, query) ?? []);
}

/** 받을 파일은 가장 큰 것(large 는 비어 있을 수 있다), 미리보기는 가장 작은 것. */
function toCandidate(hit: PixabayHit, keyword: string): ClipCandidate | null {
  const renditions = (["large", "medium", "small", "tiny"] as const)
    .map((size) => hit.videos[size])
    .filter((video): video is PixabayRendition => Boolean(video?.url));
  const best = renditions[0];
  if (!best) return null;
  const smallest = renditions[renditions.length - 1];
  return {
    source: "pixabay",
    sourceId: String(hit.id),
    keyword,
    title: hit.tags,
    pageUrl: hit.pageURL,
    thumbnailUrl: renditions.find((video) => video.thumbnail)?.thumbnail ?? null,
    previewUrl: smallest.url,
    downloadUrl: best.url,
    width: best.width || null,
    height: best.height || null,
    durationSec: hit.duration || null,
    author: hit.user || null,
    authorUrl: hit.user ? `https://pixabay.com/users/${hit.user}-${hit.user_id}/` : null,
    license: {
      code: "pixabay",
      name: "Pixabay Content License",
      url: LICENSE_URL,
      raw: { license: "Pixabay Content License", pageURL: hit.pageURL, user: hit.user, user_id: hit.user_id },
    },
  };
}
