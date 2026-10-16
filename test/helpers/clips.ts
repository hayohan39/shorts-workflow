import type { ClipCandidate } from "@/pipeline/clips/types";

let next = 1;

/** 선별 조건을 만족하는 세로 클립(10초). 필요한 필드만 덮어쓴다. */
export function clip(overrides: Partial<ClipCandidate> = {}): ClipCandidate {
  const id = String(next++);
  return {
    source: "pixabay",
    sourceId: id,
    keyword: "ocean",
    title: `clip ${id}`,
    pageUrl: `https://example.com/${id}`,
    thumbnailUrl: null,
    previewUrl: null,
    downloadUrl: `https://example.com/${id}.mp4`,
    width: 1080,
    height: 1920,
    durationSec: 10,
    author: null,
    authorUrl: null,
    license: { code: "pixabay", name: "Pixabay Content License", url: null, raw: {} },
    ...overrides,
  };
}
