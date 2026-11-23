import type { Episode } from "@/pipeline/episodes";
import { isBusy } from "@/pipeline/status";

// 음악형 에피소드의 음원 규칙(DB 를 모르는 순수 규칙이라 브라우저·서버가 같이 쓴다). 저장은 music/track.ts.

export const AUDIO_MAX_BYTES = 25 * 1024 * 1024;
export const AUDIO_CONTENT_TYPES = ["audio/*"];
/** 이보다 짧은 음원은 받지 않는다. */
export const MUSIC_MIN_SECONDS = 10;
/** 이보다 긴 음원은 받지 않는다(DB 검사와 같음). */
export const MUSIC_MAX_SECONDS = 900;

export interface TrackTiming {
  durationSeconds: number;
  startSeconds: number;
}

/** 영상에 쓰는 구간. 시작 시각이 곡 끝을 넘으면 끝에 맞춰 당긴다. */
export function musicSegment(track: TrackTiming, targetSeconds: number): { start: number; end: number; seconds: number } {
  const seconds = Math.min(targetSeconds, track.durationSeconds);
  const start = Math.min(Math.max(track.startSeconds, 0), track.durationSeconds - seconds);
  const round = (value: number) => Math.round(value * 100) / 100;
  return { start: round(start), end: round(start + seconds), seconds: round(seconds) };
}

/** 음원을 바꾸거나 구간을 고를 수 있는가: 음악형이고, 아직 다음 단계로 넘기지 않았고, 도는 작업이 없을 때. */
export function canEditMusic(episode: Pick<Episode, "route" | "status" | "step" | "stepState">): boolean {
  return episode.route === "music" && episode.status === "queued" && !isBusy(episode);
}

/** 브라우저가 올릴 Blob 경로. 에피소드마다 폴더를 나누고 파일 이름은 영문·숫자만 남긴다(뒤에 임의 문자가 붙는다). */
export function musicUploadPath(episodeId: number, fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  const ext =
    dot > 0
      ? fileName
          .slice(dot + 1)
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "")
          .slice(0, 5)
      : "";
  const base = (dot > 0 ? fileName.slice(0, dot) : fileName)
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `music/${episodeId}/${base || "track"}${ext ? `.${ext}` : ""}`;
}

/** 업로드 토큰을 받을 수 있는 경로인가: music/<id>/<파일> 하나만. 에피소드 번호를 돌려준다. */
export function parseMusicUploadPath(pathname: string): number | null {
  const match = /^music\/([1-9][0-9]{0,9})\/[A-Za-z0-9_-][A-Za-z0-9_.-]{0,59}$/.exec(pathname);
  return match ? Number(match[1]) : null;
}

/** 이 에피소드 폴더에 올라간 우리 Blob 스토어(공개)의 주소인가. 다른 곳의 주소를 저장하지 않게 한다. */
export function isMusicBlobUrl(url: string, episodeId: number): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (
    parsed.protocol === "https:" &&
    parsed.hostname.endsWith(".public.blob.vercel-storage.com") &&
    parsed.pathname.startsWith(`/music/${episodeId}/`) &&
    !parsed.search &&
    !parsed.hash
  );
}
