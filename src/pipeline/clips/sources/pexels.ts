import { fetchSourceJson } from "@/pipeline/clips/http";
import { SOURCE_LABELS, type ClipCandidate, type SearchOptions, type SourceAdapter } from "@/pipeline/clips/types";

// Pexels Videos API (https://www.pexels.com/api/documentation/#videos-search).
//   GET https://api.pexels.com/videos/search?query=…&orientation=portrait&per_page=1~80, 헤더 Authorization: <키>
//   한도: 시간당 200회·월 20,000회(기본). 응답을 24시간 캐시하는 수집 쪽 캐시로 충분하다.
//   쇼츠용이라 세로(portrait) 영상만 요청한다.
//   라이선스: Pexels License(상업적 이용·편집 가능, 표기 의무 없음). API 를 쓰면 Pexels 링크를 보여야 하므로
//   출처 표기에 "Pexels" 와 원본 링크가 들어간다(attribution.ts).
// 필드는 공식 JS 라이브러리(pexels@1.4.0)의 타입 정의 기준이다. 이 세션에서는 api.pexels.com 이 막혀 있어
// 실제 응답은 첫 Actions 수집에서 확인한다.

const ENDPOINT = "https://api.pexels.com/videos/search";
const LICENSE_URL = "https://www.pexels.com/license/";
/** 이보다 큰 파일(4K 등)은 받지 않는다. 쇼츠는 1080×1920 이면 충분하다. */
const MAX_SHORT_SIDE = 1080;

interface PexelsVideoFile {
  id: number;
  quality: string | null;
  file_type: string;
  width: number | null;
  height: number | null;
  link: string;
}

interface PexelsVideo {
  id: number;
  width: number;
  height: number;
  url: string;
  image: string;
  duration: number;
  user: { id: number; name: string; url: string };
  video_files: PexelsVideoFile[];
}

export interface PexelsResponse {
  total_results: number;
  videos: PexelsVideo[];
}

const MISSING_KEY = "PEXELS_API_KEY 가 없습니다. https://www.pexels.com/api/ 에서 키를 받아 GitHub Secrets 에 넣으세요.";

export function createPexelsAdapter(env: Record<string, string | undefined> = process.env): SourceAdapter {
  const key = env.PEXELS_API_KEY || null;
  return {
    id: "pexels",
    label: SOURCE_LABELS.pexels,
    availability: () => (key ? { ok: true } : { ok: false, reason: MISSING_KEY }),
    search: async (query, options) => {
      if (!key) throw new Error(MISSING_KEY);
      return searchPexels(query, options, key);
    },
  };
}

async function searchPexels(query: string, options: SearchOptions, key: string): Promise<ClipCandidate[]> {
  const params = new URLSearchParams({
    query: query.slice(0, 100),
    orientation: "portrait",
    per_page: String(Math.min(Math.max(options.limit, 1), 80)),
  });
  const body = await fetchSourceJson<PexelsResponse>(`${ENDPOINT}?${params}`, {
    source: "pexels",
    fetchImpl: options.fetchImpl,
    headers: { authorization: key },
  });
  return body.videos.flatMap((video) => toCandidate(video, query) ?? []);
}

const shortSide = (file: PexelsVideoFile) => Math.min(file.width ?? 0, file.height ?? 0);

/** 받을 파일은 1080p 이하 mp4 중 가장 큰 것, 미리보기는 가장 작은 것. HLS(재생 목록)는 쓰지 않는다. */
export function pickFiles(files: PexelsVideoFile[]): { download: PexelsVideoFile; preview: PexelsVideoFile } | null {
  const mp4 = files
    .filter((file) => file.quality !== "hls" && file.file_type === "video/mp4" && shortSide(file) > 0)
    .sort((a, b) => shortSide(b) - shortSide(a));
  const download = mp4.find((file) => shortSide(file) <= MAX_SHORT_SIDE) ?? mp4.at(-1);
  return download ? { download, preview: mp4.at(-1)! } : null;
}

function toCandidate(video: PexelsVideo, keyword: string): ClipCandidate | null {
  const files = pickFiles(video.video_files);
  if (!files) return null;
  return {
    source: "pexels",
    sourceId: String(video.id),
    keyword,
    // 제목 필드가 없다. 페이지 주소의 마지막 부분이 제목 역할을 한다(예: …/video/ocean-waves-crashing-1234/).
    title: titleFromUrl(video.url) ?? `Pexels video ${video.id}`,
    pageUrl: video.url,
    thumbnailUrl: video.image || null,
    previewUrl: files.preview.link,
    downloadUrl: files.download.link,
    width: files.download.width,
    height: files.download.height,
    durationSec: video.duration || null,
    author: video.user?.name || null,
    authorUrl: video.user?.url || null,
    license: {
      code: "pexels",
      name: "Pexels License",
      url: LICENSE_URL,
      raw: { license: "Pexels License", url: video.url, user: video.user?.name ?? null, user_id: video.user?.id ?? null },
    },
  };
}

/** "https://www.pexels.com/video/ocean-waves-crashing-1234/" → "ocean waves crashing" */
export function titleFromUrl(url: string): string | null {
  const slug = url.replace(/\/+$/, "").split("/").pop() ?? "";
  const words = slug.replace(/-?\d+$/, "").replace(/-/g, " ").trim();
  return words || null;
}
