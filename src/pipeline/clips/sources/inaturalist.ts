import { fetchSourceJson } from "@/pipeline/clips/http";
import {
  SOURCE_LABELS,
  type ClipCandidate,
  type ClipLicense,
  type SearchOptions,
  type SourceAdapter,
} from "@/pipeline/clips/types";

// iNaturalist 관찰 사진 (https://api.inaturalist.org/v1/docs/). 키 없음, 권장 한도 초당 1회·하루 1만 회.
//   GET /v1/observations?q=…&photos=true&photo_license=cc0,cc-by,cc-by-sa&quality_grade=research&order_by=votes
//   사진마다 라이선스가 다르다. 대부분이 CC BY-NC(비영리)라서 수익 채널에 쓸 수 없다.
//   상업적 이용이 되는 것(CC0·CC BY·CC BY-SA)만 쓴다:
//     1) 요청에서 photo_license 로 거르고
//     2) 응답의 사진마다 license_code 를 다시 확인해 그 밖의 것(비영리·변경금지·저작권 보유 = null)은 버린다.
//   (license.ts 의 isCommercialUse 가 저장·채택·장면 넣기 전에 한 번 더, DB 체크 제약이 마지막으로 막는다)
//   받는 파일은 original(긴 변 최대 2048px). 연구 등급(종이 확인된) 관찰만.

const API = "https://api.inaturalist.org/v1/observations";
export const INATURALIST_LICENSES = ["cc0", "cc-by", "cc-by-sa"] as const;
type AllowedCode = (typeof INATURALIST_LICENSES)[number];

const LICENSES: Record<AllowedCode, Omit<ClipLicense, "raw">> = {
  cc0: { code: "cc0", name: "CC0 1.0", url: "https://creativecommons.org/publicdomain/zero/1.0/" },
  "cc-by": { code: "cc-by", name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" },
  "cc-by-sa": { code: "cc-by-sa", name: "CC BY-SA 4.0", url: "https://creativecommons.org/licenses/by-sa/4.0/" },
};

interface Photo {
  id: number;
  license_code: string | null;
  url: string;
  attribution: string;
  original_dimensions?: { width: number; height: number } | null;
}

interface Observation {
  id: number;
  uri: string;
  taxon?: { name: string; preferred_common_name?: string; iconic_taxon_name?: string } | null;
  user?: { login: string; name?: string | null } | null;
  photos?: Photo[];
}

export interface INaturalistResponse {
  total_results: number;
  results: Observation[];
}

export function createINaturalistAdapter(): SourceAdapter {
  return {
    id: "inaturalist",
    label: SOURCE_LABELS.inaturalist,
    availability: () => ({ ok: true }),
    search: (query, options) => searchINaturalist(query, options),
  };
}

async function searchINaturalist(query: string, options: SearchOptions): Promise<ClipCandidate[]> {
  const params = new URLSearchParams({
    q: query.slice(0, 100),
    photos: "true",
    photo_license: INATURALIST_LICENSES.join(","),
    quality_grade: "research",
    order_by: "votes",
    per_page: String(Math.min(Math.max(options.limit, 1), 50)),
    ...(options.page && options.page > 1 ? { page: String(options.page) } : {}),
    ...(options.iconicTaxa ? { iconic_taxa: options.iconicTaxa } : {}),
  });
  const body = await fetchSourceJson<INaturalistResponse>(`${API}?${params}`, {
    source: "inaturalist",
    fetchImpl: options.fetchImpl,
  });
  return body.results.flatMap((observation) => toCandidate(observation, query) ?? []);
}

const isAllowed = (code: string | null): code is AllowedCode =>
  code !== null && (INATURALIST_LICENSES as readonly string[]).includes(code.toLowerCase());

/** 관찰 하나에서 상업적 이용이 되는 첫 사진. 없으면 null. */
export function toCandidate(observation: Observation, keyword: string): ClipCandidate | null {
  const photo = observation.photos?.find((item) => isAllowed(item.license_code));
  if (!photo) return null;
  const code = photo.license_code!.toLowerCase() as AllowedCode;
  const taxon = observation.taxon;
  const title = taxon
    ? taxon.preferred_common_name
      ? `${taxon.preferred_common_name} (${taxon.name})`
      : taxon.name
    : `observation ${observation.id}`;
  // 사진 주소는 square(75px) 로 온다. 크기 이름만 바꿔 쓴다.
  const sized = (size: string) => photo.url.replace(/\/square\.(\w+)(\?.*)?$/, `/${size}.$1`);
  const dims = photo.original_dimensions;
  const scale = dims ? Math.min(1, 2048 / Math.max(dims.width, dims.height, 1)) : 1;
  return {
    source: "inaturalist",
    media: "image",
    sourceId: `${observation.id}-${photo.id}`,
    keyword,
    title,
    pageUrl: `https://www.inaturalist.org/photos/${photo.id}`,
    thumbnailUrl: sized("small"),
    previewUrl: sized("medium"),
    downloadUrl: sized("original"),
    width: dims ? Math.round(dims.width * scale) : null,
    height: dims ? Math.round(dims.height * scale) : null,
    durationSec: null,
    author: observation.user?.name || observation.user?.login || null,
    authorUrl: observation.user?.login ? `https://www.inaturalist.org/people/${observation.user.login}` : null,
    license: {
      ...LICENSES[code],
      raw: {
        license_code: code,
        attribution: photo.attribution,
        observation: observation.uri,
        iconic_taxon_name: taxon?.iconic_taxon_name ?? null,
      },
    },
  };
}
