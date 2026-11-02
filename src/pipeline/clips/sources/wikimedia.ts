import { fetchSourceJson } from "@/pipeline/clips/http";
import { classifyCreativeCommons } from "@/pipeline/clips/license";
import { SOURCE_LABELS, type ClipCandidate, type SearchOptions, type SourceAdapter } from "@/pipeline/clips/types";

// Wikimedia Commons (MediaWiki Action API). 키 없음, 연락처가 들어간 User-Agent 필수(http.ts).
//   GET https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch="… filetype:video"&prop=videoinfo
//   한 번의 요청으로 길이·해상도·라이선스(extmetadata)·변환본(derivatives)까지 받는다. maxlag=5 로 서버가 바쁠 때는 물러난다.
//   라이선스: LicenseShortName·LicenseUrl 로 판정(CC0·PD·CC BY·CC BY-SA 만). 초상권·상표 등 제한(Restrictions)이 있으면 뺀다.
//   파일은 ogv·webm 이 많다. 원본이 너무 크면 서버 변환본 중 가장 큰 것을 받는다(채택 때 mp4 로 바꾼다).
// 필드는 2026-11-01 실제 응답(test/fixtures/clips/wikimedia-search.json)으로 확인했다.

const API = "https://commons.wikimedia.org/w/api.php";
/** 원본이 이보다 크면 변환본을 받는다 */
const MAX_ORIGINAL_BYTES = 100 * 1024 * 1024;

interface Derivative {
  src: string;
  type: string;
  width?: number;
  height?: number;
}

interface VideoInfo {
  size: number;
  width: number;
  height: number;
  duration?: number;
  thumburl?: string;
  url: string;
  descriptionurl: string;
  mediatype: string;
  extmetadata?: Record<string, { value: string } | undefined>;
  derivatives?: Derivative[];
}

export interface WikimediaResponse {
  query?: { pages: { title: string; pageid: number; index?: number; videoinfo?: VideoInfo[] }[] };
  error?: { code: string; info: string };
}

/** 위키 문법·HTML 이 섞인 표기에서 글자만. */
function plainText(html: string | undefined): string | null {
  const text = html?.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  return text || null;
}

/** 추적용 쿼리(utm_…)를 뗀 주소 */
const withoutQuery = (url: string) => url.split("?")[0];

export function createWikimediaAdapter(): SourceAdapter {
  return {
    id: "wikimedia",
    label: SOURCE_LABELS.wikimedia,
    availability: () => ({ ok: true }),
    search: (query, options) => searchWikimedia(query, options),
  };
}

async function searchWikimedia(query: string, options: SearchOptions): Promise<ClipCandidate[]> {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    maxlag: "5",
    generator: "search",
    gsrnamespace: "6",
    gsrsearch: `${query} filetype:video`,
    gsrlimit: String(Math.min(options.limit, 50)),
    prop: "videoinfo",
    viprop: "url|size|mime|mediatype|extmetadata|derivatives",
    viurlwidth: "320",
  });
  const body = await fetchSourceJson<WikimediaResponse>(`${API}?${params}`, {
    source: "wikimedia",
    fetchImpl: options.fetchImpl,
  });
  if (body.error) throw new Error(`Wikimedia 오류 (${body.error.code}): ${body.error.info}`);
  const pages = [...(body.query?.pages ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return pages.flatMap((page) => toCandidate(page.title, page.pageid, page.videoinfo?.[0], query) ?? []);
}

function toCandidate(title: string, pageId: number, info: VideoInfo | undefined, keyword: string): ClipCandidate | null {
  if (!info || info.mediatype !== "VIDEO") return null;
  const meta = (key: string) => info.extmetadata?.[key]?.value;
  if (meta("Restrictions")?.trim()) return null;
  const license = classifyCreativeCommons(
    { name: meta("LicenseShortName"), url: meta("LicenseUrl") },
    {
      LicenseShortName: meta("LicenseShortName") ?? null,
      LicenseUrl: meta("LicenseUrl") ?? null,
      UsageTerms: meta("UsageTerms") ?? null,
      AttributionRequired: meta("AttributionRequired") ?? null,
      Artist: meta("Artist") ?? null,
    },
  );
  if (!license) return null;

  const derivatives = [...(info.derivatives ?? [])].sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
  const useOriginal = info.size <= MAX_ORIGINAL_BYTES || derivatives.length === 0;
  const file = useOriginal
    ? { src: withoutQuery(info.url), width: info.width, height: info.height }
    : derivatives[0];
  return {
    source: "wikimedia",
    sourceId: String(pageId),
    keyword,
    title: plainText(meta("ObjectName")) ?? title.replace(/^File:/, ""),
    pageUrl: info.descriptionurl,
    thumbnailUrl: info.thumburl ? withoutQuery(info.thumburl) : null,
    previewUrl: derivatives.at(-1)?.src ?? null,
    downloadUrl: file.src,
    width: file.width || null,
    height: file.height || null,
    durationSec: info.duration ? Math.round(info.duration * 10) / 10 : null,
    author: plainText(meta("Artist")),
    authorUrl: null,
    license,
  };
}
