// 무료 라이선스 영상 클립 수집의 공통 타입.
// 소스(Pixabay·NASA·Wikimedia Commons·Internet Archive·공유마당)마다 어댑터가 search() 결과를 ClipCandidate 로 맞춘다.
// 라이선스는 수집한 시점의 값을 그대로 남긴다(license.raw). 나중에 원본 페이지의 표기가 바뀌어도 근거가 남도록.

export type ClipSourceId = "pixabay" | "nasa" | "wikimedia" | "archive" | "gongu";

/** 화면·출처 표기용 소스 이름 */
export const SOURCE_LABELS: Record<ClipSourceId, string> = {
  pixabay: "Pixabay",
  nasa: "NASA Image and Video Library",
  wikimedia: "Wikimedia Commons",
  archive: "Internet Archive",
  gongu: "공유마당",
};

export type Orientation = "vertical" | "square" | "horizontal";

/** 허용하는 라이선스만 코드가 있다. 비영리(NC)·변경금지(ND)·불명확한 것은 어댑터 단계에서 버린다. */
export type LicenseCode = "pixabay" | "nasa" | "pd" | "cc0" | "cc-by" | "cc-by-sa" | "kogl-1";

export interface ClipLicense {
  code: LicenseCode;
  /** 화면·출처 표기용 이름. 예: "CC BY 4.0" */
  name: string;
  url: string | null;
  /** 원본 응답의 라이선스 관련 필드(수집 시점 스냅샷) */
  raw: Record<string, unknown>;
}

export interface ClipCandidate {
  source: ClipSourceId;
  /** 소스 안에서의 ID. (source, sourceId) 로 중복을 가린다. */
  sourceId: string;
  /** 이 후보를 찾은 검색어 */
  keyword: string;
  title: string;
  /** 사람이 보는 원본 페이지(출처 표기 링크) */
  pageUrl: string;
  thumbnailUrl: string | null;
  /** 화면 미리보기용(가벼운 해상도) */
  previewUrl: string | null;
  /** 채택할 때 받을 파일. null 이면 링크만 제공하는 소스(공유마당) */
  downloadUrl: string | null;
  width: number | null;
  height: number | null;
  durationSec: number | null;
  author: string | null;
  authorUrl: string | null;
  license: ClipLicense;
}

export interface SearchOptions {
  /** 소스에 요청할 최대 결과 수 */
  limit: number;
  fetchImpl?: typeof fetch;
}

export interface SourceAdapter {
  id: ClipSourceId;
  /** 화면 표시 이름 */
  label: string;
  /** 키가 필요한 소스는 키가 없으면 꺼진다. 꺼진 이유를 설정 화면에 보여 준다. */
  availability(): { ok: true } | { ok: false; reason: string };
  search(query: string, options: SearchOptions): Promise<ClipCandidate[]>;
}

export function orientationOf(width: number | null, height: number | null): Orientation | null {
  if (!width || !height) return null;
  const ratio = width / height;
  if (ratio < 0.9) return "vertical";
  if (ratio <= 1.1) return "square";
  return "horizontal";
}
