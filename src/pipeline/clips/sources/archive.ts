import { fetchSourceJson, skipOnError } from "@/pipeline/clips/http";
import { classifyCreativeCommons } from "@/pipeline/clips/license";
import { SOURCE_LABELS, type ClipCandidate, type SearchOptions, type SourceAdapter } from "@/pipeline/clips/types";

// Internet Archive. 키 없음.
//   검색: GET https://archive.org/advancedsearch.php?q=…&fl[]=…&output=json
//         제목·주제어에서만 찾고(전문 검색은 팟캐스트 등 엉뚱한 결과가 많다), licenseurl 이 있고 NC·ND 가 아닌 영상만 요청한다.
//   파일: GET https://archive.org/metadata/{identifier} → files[] 에서 길이·해상도가 있는 mp4 중 가장 큰 것.
//   항목마다 요청이 하나 더 들어서 키워드당 MAX_ITEMS 개만 본다.
//   라이선스는 업로더가 넣는 값이라 부정확할 수 있다. licenseurl 로만 판정하고(없으면 제외) 화면에 원본 링크를 둔다.
// 필드는 2026-11-01 실제 응답(test/fixtures/clips/archive-*.json)으로 확인했다.

const SEARCH = "https://archive.org/advancedsearch.php";
const MAX_ITEMS = 8;
/** 받을 수 있는 영상 형식(metadata files[].format) */
const VIDEO_FORMATS = new Set(["h.264", "h.264 IA", "h.264 HD", "MPEG4", "512Kb MPEG4"]);

interface ArchiveDoc {
  identifier: string;
  title?: string;
  creator?: string | string[];
  licenseurl?: string;
}

export interface ArchiveSearchResponse {
  response: { docs: ArchiveDoc[] };
}

interface ArchiveFile {
  name: string;
  format?: string;
  length?: string;
  width?: string;
  height?: string;
}

export interface ArchiveMetadata {
  metadata?: ArchiveDoc;
  files?: ArchiveFile[];
}

/** 길이·해상도를 아는 mp4 중 화면이 가장 큰 것. */
export function pickVideoFile(files: ArchiveFile[]): ArchiveFile | null {
  const videos = files.filter(
    (file) => file.format && VIDEO_FORMATS.has(file.format) && Number(file.length) > 0 && Number(file.height) > 0,
  );
  videos.sort((a, b) => Number(b.height) - Number(a.height));
  return videos[0] ?? null;
}

export function createArchiveAdapter(): SourceAdapter {
  return {
    id: "archive",
    label: SOURCE_LABELS.archive,
    availability: () => ({ ok: true }),
    search: (query, options) => searchArchive(query, options),
  };
}

async function searchArchive(query: string, options: SearchOptions): Promise<ClipCandidate[]> {
  const terms = query.replace(/[()":\\]/g, " ").trim();
  const params = new URLSearchParams({
    q: `(title:(${terms}) OR subject:(${terms})) AND mediatype:movies AND licenseurl:* AND NOT licenseurl:*nc* AND NOT licenseurl:*nd*`,
    rows: String(Math.min(options.limit, MAX_ITEMS)),
    output: "json",
  });
  for (const field of ["identifier", "title", "creator", "licenseurl"]) params.append("fl[]", field);
  const request = { source: "archive" as const, fetchImpl: options.fetchImpl };
  const body = await fetchSourceJson<ArchiveSearchResponse>(`${SEARCH}?${params}`, request);

  const candidates: ClipCandidate[] = [];
  for (const doc of body.response.docs) {
    const license = classifyCreativeCommons({ url: doc.licenseurl }, { licenseurl: doc.licenseurl ?? null });
    if (!license) continue;
    const item = await skipOnError(() =>
      fetchSourceJson<ArchiveMetadata>(`https://archive.org/metadata/${encodeURIComponent(doc.identifier)}`, request),
    );
    const file = pickVideoFile(item?.files ?? []);
    if (!file) continue;
    const creator = [doc.creator].flat()[0]?.trim() || null;
    candidates.push({
      source: "archive",
      media: "video",
      sourceId: doc.identifier,
      keyword: query,
      title: doc.title ?? doc.identifier,
      pageUrl: `https://archive.org/details/${encodeURIComponent(doc.identifier)}`,
      thumbnailUrl: `https://archive.org/services/img/${encodeURIComponent(doc.identifier)}`,
      previewUrl: null,
      downloadUrl: `https://archive.org/download/${encodeURIComponent(doc.identifier)}/${file.name.split("/").map(encodeURIComponent).join("/")}`,
      width: Number(file.width) || null,
      height: Number(file.height) || null,
      durationSec: Math.round(Number(file.length) * 10) / 10,
      author: creator,
      authorUrl: null,
      license,
    });
  }
  return candidates;
}
