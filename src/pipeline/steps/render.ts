import type { Episode } from "@/pipeline/episodes";
import { listAssets, saveAsset, type Asset } from "@/pipeline/assets";
import { monthlyCredits } from "@/pipeline/credits";
import { copyToBlob, createBlobPut, readBlobToken, type BlobPut } from "@/pipeline/providers/blob";
import {
  createManyMotionsClient,
  downloadHeaders,
  readManyMotionsKey,
  resolveManyMotionsUrl,
} from "@/pipeline/providers/manymotions";
import { JobLostError, submitMedia, waitForMedia } from "@/pipeline/providers/media-forge";
import type { McpClient } from "@/pipeline/providers/mcp";
import type { PollOptions } from "@/pipeline/providers/poll";
import { latestSuccessfulProbe } from "@/pipeline/probe";
import { effectiveModels } from "@/pipeline/recommended";
import type { Scene } from "@/pipeline/script/schema";
import { latestScript } from "@/pipeline/scripts";
import { getSettings } from "@/pipeline/settings";

// 장면 생성(⑤-2): 대본의 장면마다 영상(텍스트→영상)·이미지(텍스트→이미지)를 만들어 Vercel Blob 에 저장한다.
// 장면들을 한꺼번에 요청하고 각각 끝나기를 기다린다. 일부가 실패해도 끝난 장면은 저장하고,
// 다시 시도하면 같은 대본 버전에서 아직 없는 장면만 만든다(크레딧을 두 번 쓰지 않게).

/** 장면 하나의 예상 크레딧(추천 모델 기준: Kling 3.0 Standard 5초 105, Seedream 4.5 23). 한도 사전 검사용. */
export const SCENE_CREDITS: Record<Scene["kind"], number> = { video: 105, image: 23 };

export interface RenderStepDeps {
  media: Pick<McpClient, "callTool">;
  put: BlobPut;
  fetchImpl?: typeof fetch;
  headersFor?: (url: string) => Record<string, string> | undefined;
  poll?: PollOptions;
}

export function defaultRenderDeps(): RenderStepDeps {
  const key = readManyMotionsKey();
  return {
    media: createManyMotionsClient(key),
    put: createBlobPut(readBlobToken()),
    headersFor: (url) => downloadHeaders(url, key),
  };
}

export function estimateSceneCredits(scenes: Pick<Scene, "kind">[]): number {
  return scenes.reduce((sum, scene) => sum + SCENE_CREDITS[scene.kind], 0);
}

/** 이 대본 버전으로 이미 만든 장면(장면 번호 → 생성물). */
export function scenesDone(assets: Asset[], scriptVersion: number): Map<number, Asset> {
  const done = new Map<number, Asset>();
  for (const asset of assets) {
    if ((asset.kind !== "video" && asset.kind !== "image") || asset.sceneNo === null) continue;
    if (asset.meta.scriptVersion !== scriptVersion || done.has(asset.sceneNo)) continue;
    done.set(asset.sceneNo, asset);
  }
  return done;
}

export async function runRenderStep(
  episode: Episode,
  options: { progress?: (text: string) => Promise<void>; deps?: RenderStepDeps } = {},
): Promise<{ created: number; credits: number }> {
  const progress = options.progress ?? (async () => {});
  const script = await latestScript(episode.id);
  if (!script) throw new Error("대본이 없습니다. 대본을 먼저 만들고 승인하세요.");

  const done = scenesDone(await listAssets(episode.id), script.version);
  const todo = script.scenes.filter((scene) => !done.has(scene.no));
  if (!todo.length) {
    await progress("모든 장면이 이미 있습니다");
    return { created: 0, credits: 0 };
  }

  const [settings, probe] = await Promise.all([getSettings(), latestSuccessfulProbe()]);
  const models = effectiveModels(settings, probe?.catalog ?? { video: [], image: [], audio: [], other: {} });
  const modelFor = (kind: Scene["kind"]) => {
    const id = kind === "video" ? models.video : models.image;
    if (!id) throw new Error(`${kind === "video" ? "영상" : "이미지"} 모델이 없습니다. 설정에서 모델 목록을 새로 가져오세요.`);
    return id;
  };
  todo.forEach((scene) => modelFor(scene.kind));

  const estimate = estimateSceneCredits(todo);
  const credits = await monthlyCredits();
  if (credits.used + estimate > credits.limit) {
    throw new Error(
      `이번 달 크레딧 한도를 넘습니다(사용 ${credits.used.toLocaleString("ko-KR")} + 예상 ${estimate} > 한도 ${credits.limit.toLocaleString("ko-KR")}). 설정에서 한도를 올리거나 다음 달에 하세요.`,
    );
  }

  const deps = options.deps ?? defaultRenderDeps();
  const total = script.scenes.length;
  let finished = done.size;
  let spent = 0;
  await progress(`장면 ${todo.map((scene) => scene.no).join("·")}번 생성 요청 중`);

  const renderScene = async (scene: Scene) => {
    const modelId = modelFor(scene.kind);
    const params =
      scene.kind === "video"
        ? { prompt: scene.prompt, duration: scene.seconds, aspect_ratio: "9:16" }
        : { prompt: scene.prompt, aspect_ratio: "9:16", count: 1 };
    // 작업이 ManyMotions 재배포로 사라지면(job_not_found) 한 번만 다시 요청한다.
    for (let attempt = 1; ; attempt++) {
      const job = await submitMedia(deps.media, { type: scene.kind, modelId, params });
      let url: string;
      try {
        url = await waitForMedia(deps.media, scene.kind, job.jobId, deps.poll);
      } catch (error) {
        if (error instanceof JobLostError && attempt < 2) continue;
        throw error;
      }
      const sourceUrl = resolveManyMotionsUrl(url);
      const stored = await copyToBlob(
        sourceUrl,
        `episodes/${episode.id}/scene-${scene.no}.${scene.kind === "video" ? "mp4" : "jpg"}`,
        { put: deps.put, fetchImpl: deps.fetchImpl, headers: deps.headersFor?.(sourceUrl) },
      );
      await saveAsset({
        episodeId: episode.id,
        kind: scene.kind,
        sceneNo: scene.no,
        model: modelId,
        mmJobId: job.jobId,
        credits: job.credits,
        url: stored.url,
        meta: { scriptVersion: script.version, prompt: scene.prompt, sourceUrl, attempts: attempt },
      });
      finished++;
      spent += job.credits;
      await progress(`장면 ${finished}/${total} 완료 · ${spent}크레딧`);
      return;
    }
  };

  const results = await Promise.allSettled(todo.map(renderScene));
  const failed = results.flatMap((result, index) =>
    result.status === "rejected"
      ? [`${todo[index].no}번: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`]
      : [],
  );
  if (failed.length) {
    throw new Error(
      `장면 ${failed.length}개 생성 실패 (${spent}크레딧 사용, 끝난 장면은 저장됨. 다시 시도하면 나머지만 만듭니다)\n${failed.join("\n")}`,
    );
  }
  return { created: todo.length, credits: spent };
}
