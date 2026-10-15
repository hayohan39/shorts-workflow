import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildAss } from "@/pipeline/compose/ass";
import { buildFfmpegArgs, checkOutput, probeMedia, runFfmpeg, SUBTITLE_FILE } from "@/pipeline/compose/ffmpeg";
import { planTimeline } from "@/pipeline/compose/timeline";
import type { Episode } from "@/pipeline/episodes";
import { listAssets, saveAsset } from "@/pipeline/assets";
import { createBlobPut, readBlobToken, type BlobPut } from "@/pipeline/providers/blob";
import { scenesDone } from "@/pipeline/steps/render";
import { latestScript } from "@/pipeline/scripts";

// 영상 합성(⑥): 장면 4개 + 가장 최근 내레이션 + 대본 자막 → 1080×1920 MP4 → 검사 → Blob → assets(kind=final).
// 크레딧을 쓰지 않는다. 내레이션을 다시 만들었거나 자막 규칙을 바꿨으면 "다시 합성" 으로 몇 번이고 돌린다.

export interface ComposeDeps {
  put: BlobPut;
  fetchImpl?: typeof fetch;
}

export function defaultComposeDeps(): ComposeDeps {
  return { put: createBlobPut(readBlobToken()) };
}

async function download(url: string, file: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`파일을 내려받지 못했습니다(${response.status}): ${url}`);
  await writeFile(file, Buffer.from(await response.arrayBuffer()));
}

export async function runComposeStep(
  episode: Episode,
  options: { progress?: (text: string) => Promise<void>; deps?: ComposeDeps } = {},
): Promise<{ assetId: number; seconds: number }> {
  const progress = options.progress ?? (async () => {});
  const script = await latestScript(episode.id);
  if (!script) throw new Error("대본이 없습니다.");
  const assets = await listAssets(episode.id);
  const scenes = scenesDone(assets, script.version);
  const missing = script.scenes.filter((scene) => !scenes.get(scene.no)?.url).map((scene) => scene.no);
  if (missing.length) throw new Error(`장면 ${missing.join("·")}번이 없습니다. 장면 생성을 먼저 끝내세요.`);
  const narration = assets.find((asset) => asset.kind === "voice" && asset.url);
  if (!narration?.url) throw new Error("내레이션이 없습니다. 내레이션을 먼저 만드세요.");

  const deps = options.deps ?? defaultComposeDeps();
  const dir = await mkdtemp(path.join(os.tmpdir(), `compose-${episode.id}-`));
  try {
    await progress("장면·내레이션 내려받는 중");
    const files = new Map<number, string>();
    await Promise.all([
      ...script.scenes.map(async (scene) => {
        const name = `scene-${scene.no}.${scene.kind === "video" ? "mp4" : "jpg"}`;
        await download(scenes.get(scene.no)!.url!, path.join(dir, name), deps.fetchImpl);
        files.set(scene.no, name);
      }),
      download(narration.url, path.join(dir, "narration.mp3"), deps.fetchImpl),
    ]);

    const voice = await probeMedia(path.join(dir, "narration.mp3"));
    const timeline = planTimeline(script.scenes, voice.duration);
    await writeFile(path.join(dir, SUBTITLE_FILE), buildAss(timeline));

    await progress(`영상 합성 중 (${timeline.total.toFixed(1)}초 영상, 보통 1분 안팎)`);
    await runFfmpeg(buildFfmpegArgs(timeline, { scenes: files, narration: "narration.mp3", output: "final.mp4" }), dir);
    const info = await probeMedia(path.join(dir, "final.mp4"));
    const problems = checkOutput(info, timeline.total);
    if (problems.length) throw new Error(`합성 결과 검사 실패: ${problems.join(", ")}`);

    await progress("영상 저장 중");
    const { url } = await deps.put(`episodes/${episode.id}/final.mp4`, await readFile(path.join(dir, "final.mp4")), "video/mp4");
    const asset = await saveAsset({
      episodeId: episode.id,
      kind: "final",
      model: null,
      credits: 0,
      url,
      meta: {
        scriptVersion: script.version,
        seconds: Math.round(info.duration * 100) / 100,
        narrationAssetId: narration.id,
        voiceName: narration.meta.voiceName ?? null,
        sceneAssetIds: script.scenes.map((scene) => scenes.get(scene.no)!.id),
      },
    });
    return { assetId: asset.id, seconds: info.duration };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
