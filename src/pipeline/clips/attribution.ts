import type { ClipCollection, StoredClip } from "@/pipeline/clips/store";
import { SOURCE_LABELS } from "@/pipeline/clips/types";

// 출처 표기 문구와 manifest(JSON). 라이선스는 수집 시점에 저장한 값으로 만든다.
// CC BY·BY-SA 는 저작자·제목·라이선스·링크 표기가 조건이고, Pixabay·NASA·퍼블릭 도메인은 의무는 아니지만 남긴다.

export function attributionLine(clip: StoredClip): string {
  const author = clip.author ? ` / ${clip.author}` : "";
  const license = clip.license.url ? `${clip.license.name} (${clip.license.url})` : clip.license.name;
  return `"${clip.title}"${author} / ${SOURCE_LABELS[clip.source]} / ${license} / ${clip.pageUrl}`;
}

/** 선택된 클립(순서대로)의 출처 표기. 업로드 설명란에 그대로 붙일 수 있는 형식. */
export function attributionText(clips: StoredClip[]): string {
  const selected = clips.filter((clip) => clip.rank !== null);
  if (selected.length === 0) return "";
  return ["영상 출처", ...selected.map((clip) => `- ${attributionLine(clip)}`)].join("\n");
}

/** 같은 조건으로 공개해야 한다는 해석이 있는 라이선스(CC BY-SA)가 섞였는가. */
export function hasShareAlike(clips: StoredClip[]): boolean {
  return clips.some((clip) => clip.rank !== null && clip.license.code === "cc-by-sa");
}

export function buildManifest(collection: ClipCollection, clips: StoredClip[]) {
  const selected = clips.filter((clip) => clip.rank !== null);
  return {
    collectionId: collection.id,
    topic: collection.topic,
    keywords: collection.keywords,
    collectedAt: collection.finishedAt?.toISOString() ?? null,
    totalSeconds: collection.totalSeconds,
    shareAlike: hasShareAlike(selected),
    attribution: attributionText(selected),
    clips: selected.map((clip) => ({
      rank: clip.rank,
      source: clip.source,
      sourceId: clip.sourceId,
      title: clip.title,
      pageUrl: clip.pageUrl,
      author: clip.author,
      authorUrl: clip.authorUrl,
      license: { code: clip.license.code, name: clip.license.name, url: clip.license.url, raw: clip.license.raw },
      fetchedAt: clip.fetchedAt.toISOString(),
      durationSec: clip.durationSec,
      width: clip.width,
      height: clip.height,
      file: clip.blobUrl,
      adoptedAt: clip.adoptedAt?.toISOString() ?? null,
    })),
  };
}
