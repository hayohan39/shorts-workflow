import type { Asset } from "@/pipeline/assets";
import { CLIP_MODEL, descriptionWithCredits } from "@/pipeline/clips/episode";
import type { StoredClip } from "@/pipeline/clips/store";
import type { Script } from "@/pipeline/scripts";

// 유튜브에 올릴 제목·설명·태그. 직접 올릴 때(대시보드에서 복사)와 API 로 올릴 때 같은 값을 쓴다.
//   설명 = 대본 설명(요약·근거 출처·고지) + 무료 클립 출처 표기 + 해시태그
//   AI 로 만든 장면(무료 클립이 아닌 장면)이 하나라도 있거나 실사 인물이 나오면 "변경되었거나 합성된 콘텐츠" 로 표시한다.

/** YouTube 제한: 제목 100자, 설명 5,000바이트, 태그 합계 500자. < > 는 쓸 수 없다. */
const LIMITS = { title: 100, descriptionBytes: 5000, tagsChars: 500 };
export interface UploadText {
  title: string;
  description: string;
  /** API 용 태그(# 없이) */
  tags: string[];
  /** "변경되었거나 합성된 콘텐츠" 표시 여부 */
  synthetic: boolean;
}

const clean = (text: string) => text.replace(/[<>]/g, "");

function truncateBytes(text: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(text).length <= maxBytes) return text;
  let result = "";
  for (const char of text) {
    if (encoder.encode(result + char + "…").length > maxBytes) break;
    result += char;
  }
  return result + "…";
}

/** "#shorts" → "shorts". 공백이 있는 태그는 따옴표 2자를 더 센다(YouTube 규칙). 합계 500자 안에서 앞에서부터. */
export function apiTags(hashtags: string[]): string[] {
  const tags: string[] = [];
  let total = 0;
  for (const tag of hashtags.map((value) => clean(value.trim().replace(/^#/, "").trim())).filter(Boolean)) {
    if (tags.includes(tag)) continue;
    const cost = tag.length + (tag.includes(" ") ? 2 : 0) + (tags.length ? 1 : 0);
    if (total + cost > LIMITS.tagsChars) break;
    tags.push(tag);
    total += cost;
  }
  return tags;
}

/** 장면 중 AI 로 만든 것(무료 클립이 아닌 것)이 있는가. */
export function hasAiScenes(scenes: Map<number, Asset>): boolean {
  return [...scenes.values()].some((asset) => asset.model !== CLIP_MODEL);
}

export function buildUploadText(
  script: Pick<Script, "title" | "description" | "tags" | "needsAiDisclosure">,
  clips: StoredClip[],
  aiScenes: boolean,
): UploadText {
  const hashtags = script.tags.map((tag) => (tag.startsWith("#") ? tag : `#${tag}`)).join(" ");
  const description = [descriptionWithCredits(clean(script.description), clips), hashtags].filter(Boolean).join("\n\n");
  return {
    title: [...clean(script.title).trim()].slice(0, LIMITS.title).join(""),
    description: truncateBytes(description, LIMITS.descriptionBytes),
    tags: apiTags(script.tags),
    synthetic: script.needsAiDisclosure || aiScenes,
  };
}
