import type { ClipLicense, LicenseCode } from "@/pipeline/clips/types";

// 라이선스 판정. 영상은 편집(자막·자르기)해서 수익 채널에 올리므로
//   허용: 퍼블릭 도메인, CC0, CC BY, CC BY-SA, 소스 자체 라이선스(Pixabay·NASA, 어댑터가 직접 붙인다)
//   제외: 비영리(NC), 변경금지(ND), 판단할 수 없는 것
// 제외는 null 로 돌려준다. 확실하지 않으면 제외하는 쪽으로 판정한다.

type CcCode = Extract<LicenseCode, "pd" | "cc0" | "cc-by" | "cc-by-sa">;

const CC_NAMES: Record<CcCode, string> = {
  pd: "Public Domain",
  cc0: "CC0 1.0",
  "cc-by": "CC BY",
  "cc-by-sa": "CC BY-SA",
};

/**
 * creativecommons.org 주소나 "CC BY-SA 4.0" 같은 이름에서 라이선스를 판정한다.
 * Wikimedia(LicenseShortName·LicenseUrl), Internet Archive(licenseurl) 처럼 CC 표기를 쓰는 소스에 쓴다.
 */
export function classifyCreativeCommons(
  values: { name?: string | null; url?: string | null },
  raw: Record<string, unknown>,
): ClipLicense | null {
  const url = values.url?.trim() || null;
  const code = codeFromUrl(url) ?? codeFromName(values.name);
  if (!code) return null;
  return { code, name: displayName(code, values.name, url), url, raw };
}

function codeFromUrl(url: string | null): CcCode | null {
  if (!url) return null;
  const path = url.toLowerCase().replace(/^https?:\/\/(www\.)?/, "");
  if (!path.startsWith("creativecommons.org/")) return null;
  if (path.includes("/publicdomain/zero/")) return "cc0";
  // publicdomain/mark/ 와 옛 표기 licenses/publicdomain/(Internet Archive 에 많다)
  if (path.includes("/publicdomain/mark/") || path.includes("/licenses/publicdomain/")) return "pd";
  const kind = path.match(/\/licenses\/([a-z-]+)\//)?.[1];
  if (kind === "by") return "cc-by";
  if (kind === "by-sa") return "cc-by-sa";
  return null;
}

function codeFromName(name: string | null | undefined): CcCode | null {
  if (!name) return null;
  const text = name.toLowerCase().replace(/[_\s]+/g, " ").trim();
  if (/\bnc\b|non-?commercial|\bnd\b|no-?deriv/.test(text)) return null;
  if (/^cc0\b|^cc zero\b/.test(text)) return "cc0";
  if (/^(public domain|pd\b|pd-)/.test(text)) return "pd";
  if (/^cc by-sa\b|^cc-by-sa\b/.test(text)) return "cc-by-sa";
  if (/^cc by\b|^cc-by\b/.test(text)) return "cc-by";
  return null;
}

function displayName(code: CcCode, name: string | null | undefined, url: string | null): string {
  if (code === "pd" || code === "cc0") return CC_NAMES[code];
  const version = url?.match(/\/(\d\.\d)\b/)?.[1] ?? name?.match(/\b(\d\.\d)\b/)?.[1];
  return version ? `${CC_NAMES[code]} ${version}` : CC_NAMES[code];
}
