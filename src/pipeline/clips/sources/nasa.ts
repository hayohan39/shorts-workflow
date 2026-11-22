import { fetchSourceJson, skipOnError } from "@/pipeline/clips/http";
import { SOURCE_LABELS, type ClipCandidate, type SearchOptions, type SourceAdapter } from "@/pipeline/clips/types";

// NASA Image and Video Library (https://images.nasa.gov/docs/images.nasa.gov_api_docs.pdf). 키 없음.
//   GET https://images-api.nasa.gov/search?q=…&media_type=video&page_size=N
//   검색 결과에는 길이·파일 주소가 없어서 항목마다 collection.json(파일 목록)과 metadata.json(길이·해상도)을 더 받는다.
//   그래서 키워드당 MAX_ITEMS 개만 자세히 본다. 한도는 공개돼 있지 않아 순서대로 하나씩 부른다.
//   라이선스: NASA 제작물은 미국 저작권이 없다. 단 외부 촬영자(예: "Rocket Lab")가 표기된 것은 그 사람의 저작물일 수 있어 뺀다.
//   NASA 로고·휘장을 쓰거나 NASA 가 보증한다는 인상을 주면 안 된다(이용 지침).
// 필드는 2026-11-01 실제 응답(test/fixtures/clips/nasa-*.json)으로 확인했다.

const SEARCH = "https://images-api.nasa.gov/search";
const LICENSE_URL = "https://www.nasa.gov/nasa-brand-center/images-and-media/";
/** 키워드당 자세히 보는 항목 수(항목마다 요청 2번) */
const MAX_ITEMS = 6;
/** 받을 파일 우선순위(파일 이름의 ~접미사) */
const RENDITIONS = ["large", "medium", "orig", "small", "mobile"];

interface NasaItem {
  href: string;
  data: { nasa_id: string; title: string; center?: string; photographer?: string; secondary_creator?: string }[];
  links?: { href: string; rel: string; render?: string }[];
}

export interface NasaSearchResponse {
  collection: { items: NasaItem[] };
}

export type NasaMetadata = Record<string, unknown>;

/** collection.json 의 주소는 http 이고 공백이 그대로 들어 있다(예: ".../Earth Views from .../..."). https 로, 공백 등은 인코딩. */
export const https = (url: string) => new URL(url.replace(/^http:\/\//, "https://")).href;

/** "0:00:53" 또는 "12.5 s" → 초. */
export function parseNasaDuration(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const clock = value.match(/^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/);
  if (clock) return Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3]);
  const seconds = value.match(/^([\d.]+)\s*s$/);
  return seconds ? Number(seconds[1]) : null;
}

/** NASA 바깥 촬영자가 표기된 항목인가(예: "Rocket Lab"). "NASA/Michelle Stone" 처럼 NASA 표기는 괜찮다. */
export function hasExternalCredit(photographer: string | undefined): boolean {
  const name = photographer?.trim();
  return Boolean(name) && !/nasa/i.test(name!);
}

export function createNasaAdapter(): SourceAdapter {
  return {
    id: "nasa",
    label: SOURCE_LABELS.nasa,
    availability: () => ({ ok: true }),
    search: (query, options) => searchNasa(query, options),
  };
}

async function searchNasa(query: string, options: SearchOptions): Promise<ClipCandidate[]> {
  const params = new URLSearchParams({ q: query, media_type: "video", page_size: String(Math.min(options.limit, 100)) });
  const request = { source: "nasa" as const, fetchImpl: options.fetchImpl };
  const body = await fetchSourceJson<NasaSearchResponse>(`${SEARCH}?${params}`, request);
  const candidates: ClipCandidate[] = [];
  for (const item of body.collection.items) {
    if (candidates.length >= MAX_ITEMS) break;
    const data = item.data[0];
    if (!data || hasExternalCredit(data.photographer)) continue;
    const base = https(item.href).replace(/\/collection\.json$/, "");
    const details = await skipOnError(async () => ({
      files: (await fetchSourceJson<string[]>(https(item.href), request)).map(https),
      metadata: await fetchSourceJson<NasaMetadata>(`${base}/metadata.json`, request),
    }));
    const candidate = details && toCandidate(item, data, details.files, details.metadata, query);
    if (candidate) candidates.push(candidate);
  }
  return candidates;
}

function toCandidate(
  item: NasaItem,
  data: NasaItem["data"][number],
  files: string[],
  metadata: NasaMetadata,
  keyword: string,
): ClipCandidate | null {
  if (hasExternalCredit(metadata["AVAIL:Photographer"] as string | undefined)) return null;
  const mp4 = (suffix: string) => files.find((file) => file.endsWith(`~${suffix}.mp4`));
  const download = RENDITIONS.map(mp4).find(Boolean);
  if (!download) return null;
  const creator = data.secondary_creator?.trim();
  return {
    source: "nasa",
    media: "video",
    sourceId: data.nasa_id,
    keyword,
    title: data.title,
    pageUrl: `https://images.nasa.gov/details/${encodeURIComponent(data.nasa_id)}`,
    thumbnailUrl: item.links?.find((link) => link.render === "image")?.href ?? null,
    previewUrl: mp4("preview") ?? mp4("small") ?? mp4("mobile") ?? null,
    downloadUrl: download,
    width: Number(metadata["QuickTime:ImageWidth"]) || null,
    height: Number(metadata["QuickTime:ImageHeight"]) || null,
    durationSec: parseNasaDuration(metadata["QuickTime:Duration"]),
    author: creator ? `NASA (${creator})` : `NASA${data.center ? ` ${data.center}` : ""}`,
    authorUrl: null,
    license: {
      code: "nasa",
      name: "NASA 미디어 (저작권 없음)",
      url: LICENSE_URL,
      raw: {
        nasa_id: data.nasa_id,
        center: data.center ?? null,
        photographer: data.photographer ?? null,
        secondary_creator: data.secondary_creator ?? null,
      },
    },
  };
}
