import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { selectClips } from "@/pipeline/clips/select";
import { clip } from "./helpers/clips";
import { createMigratedSchema, testDatabaseUrl } from "./helpers/db";
import { validSubmission } from "./helpers/script";

describe.skipIf(!testDatabaseUrl)("에피소드 연동: 채택한 클립으로 장면 채우기 (실제 DB)", () => {
  let drop: () => Promise<void>;

  beforeAll(async () => {
    const schema = await createMigratedSchema("clipep");
    drop = schema.drop;
    process.env.DATABASE_URL = schema.url;
  });

  afterAll(async () => {
    const { getPool } = await import("@/lib/db");
    await getPool().end();
    await drop();
  });

  /** 승인된 대본이 있는 에피소드와, 채택한 클립 2개·채택 안 한 클립 1개. */
  async function setup() {
    const { query } = await import("@/lib/db");
    const { createEpisode, getEpisode } = await import("@/pipeline/episodes");
    const { saveScript } = await import("@/pipeline/scripts");
    const { toDraft } = await import("@/pipeline/script/schema");
    const store = await import("@/pipeline/clips/store");

    const episode = await createEpisode({ topic: "연동", outline: "" });
    await saveScript(episode.id, toDraft(validSubmission()), { source: "generated", warnings: [], model: null, usage: null });
    await query("update episodes set status = 'approved' where id = $1", [episode.id]);

    const collection = await store.createSearchCollection("바다");
    await store.startCollection(collection.id, null);
    const candidates = [
      clip({ sourceId: "a", title: "waves", author: "kim", durationSec: 12 }),
      clip({ sourceId: "b", title: "storm", durationSec: 200, license: { code: "cc-by-sa", name: "CC BY-SA 4.0", url: null, raw: {} } }),
      clip({ sourceId: "c", title: "not adopted", durationSec: 8 }),
    ];
    await store.finishCollection(collection.id, {
      keywords: ["sea"],
      keywordCostUsd: null,
      sourceResults: {},
      selection: selectClips(candidates),
      fetchedAt: new Map(),
    });
    const stored = await store.listClips(collection.id);
    const byTitle = (title: string) => stored.find((c) => c.title === title)!;
    await store.saveAdoptedClip(byTitle("waves").id, "https://blob.test/a.mp4");
    await store.saveAdoptedClip(byTitle("storm").id, "https://blob.test/b.mp4");
    return { episode: (await getEpisode(episode.id))!, waves: byTitle("waves"), storm: byTitle("storm"), notAdopted: byTitle("not adopted") };
  }

  it("이미지 장면을 클립(영상, 0크레딧)으로 채우면 장면 생성에서 빠지고, 빼면 다시 생성 대상이 된다", async () => {
    const { listAssets } = await import("@/pipeline/assets");
    const { scenesDone, estimateSceneCredits } = await import("@/pipeline/steps/render");
    const { latestScript } = await import("@/pipeline/scripts");
    const { fillSceneWithClip, removeSceneClip } = await import("@/pipeline/clips/episode");
    const { episode, waves, notAdopted } = await setup();
    const script = (await latestScript(episode.id))!;
    const remaining = async () => {
      const done = scenesDone(await listAssets(episode.id), script.version);
      return { done, credits: estimateSceneCredits(script.scenes.filter((scene) => !done.has(scene.no))) };
    };
    expect((await remaining()).credits).toBe(105 * 2 + 23 * 2);

    await expect(fillSceneWithClip(episode, 2, notAdopted.id)).rejects.toThrow("채택한 클립만");
    await expect(fillSceneWithClip(episode, 9, waves.id)).rejects.toThrow("없는 장면");
    const asset = await fillSceneWithClip(episode, 2, waves.id);
    expect(asset).toMatchObject({ kind: "video", sceneNo: 2, model: "clip", credits: 0, url: "https://blob.test/a.mp4" });
    expect(asset.meta).toMatchObject({ scriptVersion: script.version, clipId: waves.id });

    const filled = await remaining();
    expect(filled.done.get(2)?.id).toBe(asset.id);
    expect(filled.credits).toBe(105 * 2 + 23); // 2번(이미지 23크레딧)은 건너뛴다

    await removeSceneClip(episode, asset.id);
    expect((await remaining()).credits).toBe(105 * 2 + 23 * 2);
    await expect(removeSceneClip(episode, asset.id)).rejects.toThrow("이미 빠졌거나");
  });

  it("출처 표기는 지금 장면에 쓰인 클립(장면 순서)으로 만들고, 설명란 끝에 붙는다", async () => {
    const { listAssets, saveAsset } = await import("@/pipeline/assets");
    const { scenesDone } = await import("@/pipeline/steps/render");
    const { descriptionWithCredits, fillSceneWithClip, sceneClips } = await import("@/pipeline/clips/episode");
    const { episode, waves, storm } = await setup();
    // 3번에 AI 영상이 있어도 나중에 넣은 클립이 앞선다.
    await saveAsset({ episodeId: episode.id, kind: "video", sceneNo: 3, model: "m", credits: 105, url: "https://blob.test/ai.mp4", meta: { scriptVersion: 1 } });
    await fillSceneWithClip(episode, 3, waves.id);
    await fillSceneWithClip(episode, 1, storm.id);

    const clips = await sceneClips(scenesDone(await listAssets(episode.id), 1));
    expect(clips.map((c) => c.title)).toEqual(["storm", "waves"]);
    const description = descriptionWithCredits("설명입니다.\n", clips);
    expect(description).toMatch(/^설명입니다\.\n\n영상 출처\n- "storm" \/ Pixabay \/ CC BY-SA 4\.0 \/ /);
    expect(description).toContain('- "waves" / kim / Pixabay');
    expect(descriptionWithCredits("설명", [])).toBe("설명");
  });

  it("대본 승인 전이거나 진행 중인 단계가 있으면 바꿀 수 없다", async () => {
    const { canFillScenes, fillSceneWithClip } = await import("@/pipeline/clips/episode");
    const { episode, waves } = await setup();
    expect(canFillScenes(episode)).toBe(true);
    expect(canFillScenes({ ...episode, status: "script_review" })).toBe(false);
    expect(canFillScenes({ ...episode, stepState: "running" })).toBe(false);
    expect(canFillScenes({ ...episode, status: "failed", step: "render", stepState: "failed" })).toBe(true);
    expect(canFillScenes({ ...episode, status: "failed", step: "script", stepState: "failed" })).toBe(false);
    await expect(fillSceneWithClip({ ...episode, status: "script_review" }, 1, waves.id)).rejects.toThrow("대본 승인 뒤");
  });
});
