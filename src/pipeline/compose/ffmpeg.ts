import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Timeline } from "@/pipeline/compose/timeline";

// ffmpeg 로 장면·내레이션·자막을 합쳐 1080×1920·30fps MP4 를 만든다.
//   영상 장면: 화면을 꽉 채우게 자르고, 원본보다 길면 마지막 프레임을 늘린다(원본 소리는 쓰지 않는다).
//   이미지 장면: 2배로 키운 뒤 천천히 확대하면서 좌우로 조금씩 이동(장면마다 방향을 바꾼다).
//   소리: 내레이션만, 음량 정규화(-14 LUFS) 후 영상 길이에 맞춘다.
//   자막: 같은 폴더의 subs.ass 를 입힌다(경로 이스케이프를 피하려고 ffmpeg 를 그 폴더에서 실행한다).

const run = promisify(execFile);

export const WIDTH = 1080;
export const HEIGHT = 1920;
export const FPS = 30;
export const SUBTITLE_FILE = "subs.ass";

export interface ComposeInputs {
  /** 장면 번호 → 파일 경로(작업 폴더 기준 상대 경로도 된다). */
  scenes: Map<number, string>;
  narration: string;
  output: string;
}

const fill = `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},setsar=1`;

export function buildFfmpegArgs(timeline: Timeline, inputs: ComposeInputs): string[] {
  const args = ["-y", "-hide_banner", "-loglevel", "error"];
  const filters: string[] = [];
  timeline.scenes.forEach((scene, index) => {
    const file = inputs.scenes.get(scene.no);
    if (!file) throw new Error(`${scene.no}번 장면 파일이 없습니다.`);
    const d = scene.duration.toFixed(3);
    if (scene.kind === "video") {
      args.push("-i", file);
      filters.push(
        `[${index}:v]${fill},fps=${FPS},tpad=stop_mode=clone:stop_duration=${d},trim=duration=${d},setpts=PTS-STARTPTS,format=yuv420p[v${index}]`,
      );
    } else {
      const frames = Math.max(1, Math.round(scene.duration * FPS));
      // 짝수 번째 이미지는 왼쪽→오른쪽, 홀수 번째는 오른쪽→왼쪽으로 이동.
      const x = index % 2 === 0 ? `(iw-iw/zoom)*on/${frames}` : `(iw-iw/zoom)*(1-on/${frames})`;
      args.push("-loop", "1", "-framerate", String(FPS), "-t", d, "-i", file);
      filters.push(
        `[${index}:v]scale=${WIDTH * 2}:${HEIGHT * 2}:force_original_aspect_ratio=increase,crop=${WIDTH * 2}:${HEIGHT * 2},` +
          `zoompan=z='1+0.12*on/${frames}':x='${x}':y='ih/2-(ih/zoom/2)':d=1:s=${WIDTH}x${HEIGHT}:fps=${FPS},` +
          `trim=duration=${d},setpts=PTS-STARTPTS,setsar=1,format=yuv420p[v${index}]`,
      );
    }
  });
  const audioIndex = timeline.scenes.length;
  args.push("-i", inputs.narration);
  const labels = timeline.scenes.map((_, index) => `[v${index}]`).join("");
  filters.push(`${labels}concat=n=${timeline.scenes.length}:v=1:a=0[vcat]`);
  filters.push(`[vcat]ass=${SUBTITLE_FILE}[vout]`);
  filters.push(`[${audioIndex}:a]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000,apad[aout]`);
  args.push(
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[vout]",
    "-map",
    "[aout]",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(FPS),
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    "-t",
    timeline.total.toFixed(3),
    inputs.output,
  );
  return args;
}

export async function runFfmpeg(args: string[], cwd: string): Promise<void> {
  try {
    await run("ffmpeg", args, { cwd, maxBuffer: 16 * 1024 * 1024 });
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? "";
    throw new Error(`ffmpeg 실패: ${stderr.trim().split("\n").slice(-5).join(" / ") || String(error)}`);
  }
}

export interface MediaInfo {
  duration: number;
  width: number | null;
  height: number | null;
  hasAudio: boolean;
}

export async function probeMedia(file: string): Promise<MediaInfo> {
  const { stdout } = await run("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "stream=codec_type,width,height:format=duration",
    "-of",
    "json",
    file,
  ]);
  const json = JSON.parse(stdout) as {
    streams?: { codec_type?: string; width?: number; height?: number }[];
    format?: { duration?: string };
  };
  const video = json.streams?.find((stream) => stream.codec_type === "video");
  return {
    duration: Number(json.format?.duration ?? 0),
    width: video?.width ?? null,
    height: video?.height ?? null,
    hasAudio: !!json.streams?.some((stream) => stream.codec_type === "audio"),
  };
}

/** 결과 검사: 해상도·길이·소리. 문제가 있으면 이유 목록. */
export function checkOutput(info: MediaInfo, expectedSeconds: number): string[] {
  const problems: string[] = [];
  if (info.width !== WIDTH || info.height !== HEIGHT) problems.push(`해상도 ${info.width}×${info.height} (기대 ${WIDTH}×${HEIGHT})`);
  if (Math.abs(info.duration - expectedSeconds) > 0.6) {
    problems.push(`길이 ${info.duration.toFixed(2)}초 (기대 ${expectedSeconds.toFixed(2)}초)`);
  }
  if (!info.hasAudio) problems.push("소리가 없습니다");
  return problems;
}
