import { writeFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { selectClips } from "@/pipeline/clips/select";
import { buildUserPrompt } from "@/pipeline/script/prompt";
import { lengthRules } from "@/pipeline/script/schema";
import { statusForRequest } from "@/pipeline/status";
import { clip } from "./helpers/clips";
import { createMigratedSchema, testDatabaseUrl } from "./helpers/db";
import { validSubmission } from "./helpers/script";

describe("영상 먼저 찾기(clips 길) 규칙", () => {
  it("대본 프롬프트에 장면 순서대로 고른 클립을 넣는다", () => {
    const prompt = buildUserPrompt({
      topic: "겨울 보습",
      rules: lengthRules(30),
      outline: "컨셉: 차분하게",
      reviewerNote: null,
      previousNarration: null,
      recentEpisodes: [],
      clips: [
        { title: "ocean waves", keyword: "winter sea", seconds: 12 },
        { title: "ice", keyword: "ice", seconds: null },
      ],
    });
    expect(prompt).toContain("미리 고른 무료 영상 클립");
    expect(prompt).toContain("분량: 30초 영상 — 장면 4개(AI 영상 2개 + AI 이미지 2개), 내레이션 전체 공백 제외 111~130자");
    expect(prompt).toContain('- 장면 1: ocean waves (검색어 "winter sea", 원본 12초)');
    expect(prompt).toContain('- 장면 2: ice (검색어 "ice")');
    expect(buildUserPrompt({ topic: "a", rules: lengthRules(30), outline: "", reviewerNote: null, previousNarration: null, recentEpisodes: [] })).not.toContain(
      "클립",
    );
  });

  it("대본 승인 뒤 바로 합성할 수 있다(장면 생성 없이)", () => {
    expect(statusForRequest({ status: "approved", step: "script", stepState: "done" }, "compose")).toBe("approved");
  });
});

describe.skipIf(!testDatabaseUrl)("영상 먼저 찾기: 클립 고르기·채택·장면 채우기 (실제 DB)", () => {
  let drop: () => Promise<void>;

  beforeAll(async () => {
    const schema = await createMigratedSchema("cliproute");
    drop = schema.drop;
    process.env.DATABASE_URL = schema.url;
  });

  afterAll(async () => {
    const { getPool } = await import("@/lib/db");
    await getPool().end();
    await drop();
  });

  /** clips 길 에피소드와, 그 에피소드에서 찾은 클립 6개. */
  async function setup() {
    const { createEpisode } = await import("@/pipeline/episodes");
    const store = await import("@/pipeline/clips/store");
    const episode = await createEpisode({ topic: "겨울 바다", outline: "", route: "clips" });
    const collection = await store.createSearchCollection("겨울 바다", { related: "파도, 얼음", episodeId: episode.id });
    expect(collection).toMatchObject({ topic: "겨울 바다 (연관 단어: 파도, 얼음)", episodeId: episode.id });
    await store.startCollection(collection.id, null);
    const candidates = Array.from({ length: 6 }, (_, i) => clip({ sourceId: `w${i}`, title: `wave ${i}` }));
    await store.finishCollection(collection.id, {
      keywords: ["winter sea"],
      keywordCostUsd: null,
      sourceResults: {},
      selection: selectClips(candidates),
      fetchedAt: new Map(),
    });
    const clips = await store.listClips(collection.id);
    return { episode, collection: (await store.episodeCollection(episode.id))!, clips };
  }

  it("장면 순서대로 4개를 고른다. 개수·중복·다른 수집의 클립은 거절한다", async () => {
    const { savePicks, listPicks, canPick } = await import("@/pipeline/clips/picks");
    const store = await import("@/pipeline/clips/store");
    const { episode, clips } = await setup();
    expect(canPick(episode)).toBe(true);
    const ids = clips.map((c) => c.id);

    await expect(savePicks(episode, ids.slice(0, 3))).rejects.toThrow("장면 1~4");
    await expect(savePicks(episode, [ids[0], ids[0], ids[1], ids[2]])).rejects.toThrow("같은 클립");
    const other = await store.createSearchCollection("다른 수집");
    await store.startCollection(other.id, null);
    await store.finishCollection(other.id, {
      keywords: ["x"],
      keywordCostUsd: null,
      sourceResults: {},
      selection: selectClips([clip({ sourceId: "o1" })]),
      fetchedAt: new Map(),
    });
    const [foreign] = await store.listClips(other.id);
    await expect(savePicks(episode, [ids[0], ids[1], ids[2], foreign.id])).rejects.toThrow("이 쇼츠에서 찾은");

    await savePicks(episode, [ids[3], ids[0], ids[5], ids[1]]);
    expect((await listPicks(episode.id)).map((c) => c.id)).toEqual([ids[3], ids[0], ids[5], ids[1]]);
    // 다시 고르면 바뀐다
    await savePicks(episode, [ids[2], ids[0], ids[5], ids[1]]);
    expect((await listPicks(episode.id)).map((c) => c.id)).toEqual([ids[2], ids[0], ids[5], ids[1]]);
  });

  it("클립을 고르기 전에는 대본을 시작할 수 없고, 장면 생성은 항상 막는다", async () => {
    const { triggerStep, runnableStep } = await import("@/pipeline/trigger");
    const { savePicks } = await import("@/pipeline/clips/picks");
    const { getEpisode } = await import("@/pipeline/episodes");
    const { query } = await import("@/lib/db");
    const { episode, clips } = await setup();
    const dispatch = vi.fn(async () => {});

    await expect(triggerStep(episode.id, "script", dispatch)).rejects.toThrow("클립 4개를 먼저 고르세요");
    await savePicks(episode, clips.slice(0, 4).map((c) => c.id));
    await triggerStep(episode.id, "script", dispatch);
    expect(dispatch).toHaveBeenCalledWith("script", episode.id);

    await query("update episodes set status = 'approved', step_state = 'done' where id = $1", [episode.id]);
    const approved = (await getEpisode(episode.id))!;
    expect(runnableStep(approved)).toBe("compose");
    await expect(triggerStep(episode.id, "render", dispatch)).rejects.toThrow("장면 생성 없음");
  });

  it("채택은 고른 클립만 받고, 대본이 승인돼 있으면 장면을 그 순서대로 채운다", async () => {
    const { savePicks, fillScenesFromPicks } = await import("@/pipeline/clips/picks");
    const { adoptClips } = await import("@/pipeline/clips/adopt");
    const { getEpisode, decide } = await import("@/pipeline/episodes");
    const { saveScript, latestScript } = await import("@/pipeline/scripts");
    const { toDraft } = await import("@/pipeline/script/schema");
    const { listAssets } = await import("@/pipeline/assets");
    const { scenesDone } = await import("@/pipeline/steps/render");
    const { query } = await import("@/lib/db");
    const { episode, collection, clips } = await setup();
    const chosen = [clips[4], clips[1], clips[3], clips[0]];
    await savePicks(episode, chosen.map((c) => c.id));

    // 대본 검토 중에는 채우지 않는다
    await saveScript(episode.id, toDraft(validSubmission()), { source: "generated", warnings: [], model: null, usage: null });
    await query("update episodes set status = 'script_review' where id = $1", [episode.id]);
    const convert = vi.fn(async (_source: unknown, output: string) => writeFile(output, "mp4"));
    const put = vi.fn(async (pathname: string) => ({ url: `https://blob.test/${pathname}` }));
    expect(await adoptClips(collection.id, { put, convert })).toBe(4);
    expect(put.mock.calls.map(([pathname]) => pathname)).toEqual(chosen.map((c) => `clips/${collection.id}/${c.id}.mp4`));
    expect(await fillScenesFromPicks((await getEpisode(episode.id))!)).toBe(0);

    const approved = await decide(episode.id, "approve-script");
    expect(await fillScenesFromPicks(approved)).toBe(4);
    const script = (await latestScript(episode.id))!;
    const done = scenesDone(await listAssets(episode.id), script.version);
    expect([1, 2, 3, 4].map((no) => done.get(no)?.meta.clipId)).toEqual(chosen.map((c) => c.id));
    expect([...done.values()].every((asset) => asset.model === "clip" && asset.credits === 0)).toBe(true);
    // 다시 불러도 같은 클립은 다시 넣지 않는다
    expect(await fillScenesFromPicks(approved)).toBe(0);
    // 이미 받은 클립은 다시 받지 않는다
    expect(await adoptClips(collection.id, { put, convert })).toBe(0);
  });
});
