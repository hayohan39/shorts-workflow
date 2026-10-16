import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { probeMedia, runFfmpeg } from "@/pipeline/compose/ffmpeg";
import { USER_AGENT } from "@/pipeline/clips/http";
import { listClips, saveAdoptedClip, type StoredClip } from "@/pipeline/clips/store";
import type { BlobPut } from "@/pipeline/providers/blob";

// [채택]: 선택된 클립 중 아직 Blob 에 없는 것을 내려받아 mp4(H.264, 소리 없음)로 바꾸고 Blob 에 올린다.
// 소스 파일은 webm 등 형식이 제각각이고 핫링크가 금지된 곳(Pixabay)도 있어 우리 저장소로 옮긴다.
// 원본 소리는 쓰지 않는다(합성 때 내레이션만 쓴다). 클립 하나가 실패하면 거기서 멈추고, 다시 채택하면 남은 것부터 한다.

/** 이보다 큰 원본은 받지 않는다 */
const MAX_DOWNLOAD_BYTES = 300 * 1024 * 1024;

export interface AdoptDeps {
  put: BlobPut;
  fetchImpl?: typeof fetch;
  /** 입력 파일 → mp4 변환. 결과 길이(초)를 돌려준다. 테스트에서 바꿔 끼운다. */
  convert?: (input: string, output: string) => Promise<number | null>;
  progress?: (text: string) => Promise<void>;
}

export function buildConvertArgs(input: string, output: string): string[] {
  return [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    input,
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

async function convertWithFfmpeg(input: string, output: string): Promise<number | null> {
  await runFfmpeg(buildConvertArgs(input, output), path.dirname(output));
  const info = await probeMedia(output);
  return info.duration > 0 ? Math.round(info.duration * 10) / 10 : null;
}

async function download(clip: StoredClip, file: string, fetchImpl: typeof fetch): Promise<void> {
  const response = await fetchImpl(clip.downloadUrl!, { headers: { "user-agent": USER_AGENT } });
  if (!response.ok) throw new Error(`원본을 내려받지 못했습니다(HTTP ${response.status}).`);
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > MAX_DOWNLOAD_BYTES) throw new Error(`원본이 너무 큽니다(${Math.round(length / 1024 / 1024)}MB).`);
  await writeFile(file, Buffer.from(await response.arrayBuffer()));
}

/** 채택할 클립: 선택됐고, 받을 파일이 있고, 아직 Blob 에 없는 것. */
export function clipsToAdopt(clips: StoredClip[]): StoredClip[] {
  return clips.filter((clip) => clip.rank !== null && clip.downloadUrl && !clip.blobUrl);
}

/** 채택한 클립 수를 돌려준다. */
export async function adoptClips(collectionId: number, deps: AdoptDeps): Promise<number> {
  const convert = deps.convert ?? convertWithFfmpeg;
  const pending = clipsToAdopt(await listClips(collectionId));
  const dir = await mkdtemp(path.join(os.tmpdir(), `clips-${collectionId}-`));
  try {
    for (const [index, clip] of pending.entries()) {
      await deps.progress?.(`${index + 1}/${pending.length} ${clip.title}`);
      const input = path.join(dir, `${clip.id}.src`);
      const output = path.join(dir, `${clip.id}.mp4`);
      try {
        await download(clip, input, deps.fetchImpl ?? fetch);
        const duration = await convert(input, output);
        const { url } = await deps.put(`clips/${collectionId}/${clip.id}.mp4`, await readFile(output), "video/mp4");
        await saveAdoptedClip(clip.id, url, duration);
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
