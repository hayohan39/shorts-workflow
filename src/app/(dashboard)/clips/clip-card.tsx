import { clipSegment } from "@/pipeline/clips/select";
import type { StoredClip } from "@/pipeline/clips/store";
import { orientationOf, SOURCE_LABELS, type Orientation } from "@/pipeline/clips/types";

// 클립 하나의 정보·미리보기. 클립 보관함과 에피소드(영상 찾기)가 같이 쓴다. 서버·클라이언트 어디서든 렌더할 수 있다.

const ORIENTATION_LABELS: Record<Orientation, string> = { vertical: "세로", square: "정사각", horizontal: "가로" };

/** "12초", 긴 클립은 "199초 중 49.8초부터 15초" */
function durationLabel(seconds: number | null): string {
  if (seconds === null) return "길이 모름";
  const segment = clipSegment(seconds);
  return segment.length === seconds ? `${seconds}초` : `${seconds}초 중 ${segment.start}초부터 ${segment.length}초`;
}

export function ClipMeta({ clip }: { clip: StoredClip }) {
  const orientation = orientationOf(clip.width, clip.height);
  return (
    <div className="stack">
      <a href={clip.pageUrl} target="_blank" rel="noreferrer">
        {clip.title}
      </a>
      <div className="muted small">
        {durationLabel(clip.durationSec)}
        {orientation ? ` · ${ORIENTATION_LABELS[orientation]} ${clip.width}×${clip.height}` : ""} ·{" "}
        {SOURCE_LABELS[clip.source]}
        {clip.author ? ` · ${clip.author}` : ""} · 검색어 “{clip.keyword}”
      </div>
      <div className="row">
        <span className="badge">{clip.license.name}</span>
        {clip.license.code === "cc-by-sa" ? <span className="badge badge-failed">동일조건(SA)</span> : null}
        {clip.blobUrl ? <span className="badge badge-ready">채택됨</span> : null}
      </div>
    </div>
  );
}

export function ClipMedia({ clip }: { clip: StoredClip }) {
  const src = clip.blobUrl ?? clip.previewUrl;
  if (!src) return null;
  return (
    <video
      className="scene-media"
      src={src}
      poster={clip.thumbnailUrl ?? undefined}
      controls
      muted
      playsInline
      preload="none"
    />
  );
}
