import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { probeMedia, runFfmpeg } from "@/pipeline/compose/ffmpeg";
import { USER_AGENT } from "@/pipeline/clips/http";
import { clipSegment } from "@/pipeline/clips/select";
import { listClips, saveAdoptedClip, type StoredClip } from "@/pipeline/clips/store";
import type { BlobPut } from "@/pipeline/providers/blob";

// [채택]: 선택된 클립 중 아직 Blob 에 없는 것을 mp4(H.264, 소리 없음)로 바꿔 Blob 에 올린다.
// 소스 파일은 webm·ogv 등 형식이 제각각이고 핫링크가 금지된 곳(Pixabay)도 있어 우리 저장소로 옮긴다.
// ffmpeg 가 원본 주소에서 쓰는 구간(30초 초과는 15초, clipSegment)만 읽는다. 긴 원본을 통째로 받지 않는다.
// 원본 소리는 쓰지 않는다(합성 때 내레이션만 쓴다). 클립 하나가 실패하면 거기서 멈추고, 다시 채택하면 남은 것부터 한다.

export interface ConvertSource {
  url: string;
  start: number;
  length: number;
}

export interface AdoptDeps {
  put: BlobPut;
  /** 원본 구간 → mp4 변환. 테스트에서 바꿔 끼운다. */
  convert?: (source: ConvertSource, output: string) => Promise<void>;
  progress?: (text: string) => Promise<void>;
}

export function buildConvertArgs(source: ConvertSource, output: string): string[] {
  const remote = /^https?:\/\//.test(source.url);
  return [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    ...(remote ? ["-user_agent", USER_AGENT] : []),
    ...(source.start > 0 ? ["-ss", String(source.start)] : []),
    "-t",
    String(source.length),
    "-i",
    source.url,
    "-map",
    "0:v:0",
    "-an",
    // H.264 는 짝수 크기만 받는다.
    "-vf",
    "scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    output,
  ];
}

async function convertWithFfmpeg(source: ConvertSource, output: string): Promise<void> {
  await runFfmpeg(buildConvertArgs(source, output), path.dirname(output));
  if (!((await probeMedia(output)).duration > 0)) throw new Error("변환한 영상이 비어 있습니다.");
}

/** 채택할 클립: 선택됐고, 받을 파일과 길이가 있고, 아직 Blob 에 없는 것. */
export function clipsToAdopt(clips: StoredClip[]): StoredClip[] {
  return clips.filter((clip) => clip.rank !== null && clip.downloadUrl && clip.durationSec !== null && !clip.blobUrl);
}

/** 채택한 클립 수를 돌려준다. */
export async function adoptClips(collectionId: number, deps: AdoptDeps): Promise<number> {
  const convert = deps.convert ?? convertWithFfmpeg;
  const pending = clipsToAdopt(await listClips(collectionId));
  const dir = await mkdtemp(path.join(os.tmpdir(), `clips-${collectionId}-`));
  try {
    for (const [index, clip] of pending.entries()) {
      await deps.progress?.(`${index + 1}/${pending.length} ${clip.title}`);
      const output = path.join(dir, `${clip.id}.mp4`);
      try {
        const segment = clipSegment(clip.durationSec!);
        await convert({ url: clip.downloadUrl!, ...segment }, output);
        const { url } = await deps.put(`clips/${collectionId}/${clip.id}.mp4`, await readFile(output), "video/mp4");
        await saveAdoptedClip(clip.id, url);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`#${clip.rank} "${clip.title}" (${clip.pageUrl}) 채택 실패: ${reason}`);
      }
    }
    return pending.length;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
