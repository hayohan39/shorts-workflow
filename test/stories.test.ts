import type Anthropic from "@anthropic-ai/sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isBirdItem } from "@/pipeline/clips/pool";
import type { StoredClip } from "@/pipeline/clips/store";
import type { ClipCandidate, SearchOptions, SourceAdapter } from "@/pipeline/clips/types";
import { buildStoriesPrompt, checkStories, generateStories, STORIES_SYSTEM_PROMPT } from "@/pipeline/ideas/stories";
import type { SendMessage } from "@/pipeline/script/generate";
import { clip } from "./helpers/clips";
import { createMigratedSchema, testDatabaseUrl } from "./helpers/db";

type Message = Anthropic.Beta.Messages.BetaMessage;
const usage = { input_tokens: 2_000, output_tokens: 600, server_tool_use: { web_search_requests: 1 } };
const message = (stop_reason: string, content: unknown[]) =>
  ({ id: "m", type: "message", role: "assistant", model: "claude-haiku-5-5", stop_reason, content, usage }) as unknown as Message;

const story = (ids: number[], title = `이야기 ${ids[0]}`) => ({
  title,
  hook: "참새는 왜 모래로 목욕할까요?",
  outline: ["모래 목욕", "깃털 관리"],
  target_seconds: 30,
  item_ids: ids,
  reason: "귀여움",
});
const submit = (stories: ReturnType<typeof story>[], id = "tu_1") =>
  message("tool_use", [{ type: "tool_use", id, name: "submit_stories", input: { stories } }]);

function fake(responses: Message[]) {
  const calls: Parameters<SendMessage>[0][] = [];
  const send: SendMessage = async (params) => {
    calls.push(structuredClone(params));
    const next = responses.shift();
    if (!next) throw new Error("예상하지 못한 호출");
    return next;
  };
  return { send, calls };
}

/** 새 사진(iNaturalist, CC BY) 하나. */
const bird = (sourceId: string, overrides: Partial<ClipCandidate> = {}) =>
  clip({
    source: "inaturalist",
    media: "image",
    sourceId,
    title: `Eurasian Tree Sparrow ${sourceId}`,
    durationSec: null,
    width: 2048,
    height: 1536,
    license: { code: "cc-by", name: "CC BY 4.0", url: null, raw: { license_code: "cc-by", iconic_taxon_name: "Aves" } },
    ...overrides,
  });

const stored = (id: number): StoredClip =>
  ({
    ...bird(`s${id}`),
    id,
    collectionId: 1,
    rank: id,
    score: 0,
    fetchedAt: new Date(),
    blobUrl: null,
    adoptedAt: null,
  }) as StoredClip;

describe("새새 열매 스토리 후보 (가짜 API)", () => {
  const items = Array.from({ length: 14 }, (_, i) => stored(i + 1));

  it("새가 아닌 소재는 풀에 넣지 않는다", () => {
    expect(isBirdItem(bird("a"), "sparrow")).toBe(true);
    expect(
      isBirdItem(
        bird("b", { license: { code: "cc-by", name: "CC BY", url: null, raw: { iconic_taxon_name: "Mammalia" } } }),
        "sparrow",
      ),
    ).toBe(false);
    expect(isBirdItem(clip({ title: "sparrow, bird, nature" }), "sparrow")).toBe(true);
    expect(isBirdItem(clip({ title: "Crowe at the cinema" }), "owl")).toBe(false);
    expect(isBirdItem(clip({ title: "Puffins on the cliff" }), "puffin")).toBe(true);
  });

  it("소재 목록·길이별 장면 수를 넘기고, 소재 ID 는 enum 으로 묶는다", async () => {
    const prompt = buildStoriesPrompt({ channelPrompt: "새새 열매", defaultSeconds: 30, recentTopics: [], items });
    expect(prompt).toContain("- #1 · 사진 · Eurasian Tree Sparrow s1 · iNaturalist · ocean");
    expect(prompt).toContain("30초 4개");
    expect(prompt).toContain("40초 5개");

    const { send, calls } = fake([submit([story([1, 2, 3, 4]), story([5, 6, 7, 8]), story([9, 10, 11, 12])])]);
    const result = await generateStories(
      { channelPrompt: "새새 열매", defaultSeconds: 30, recentTopics: ["까치"], items },
      { model: "claude-haiku-5-5", send },
    );
    expect(result.ideas.map((idea) => idea.clipIds)).toEqual([
      [1, 2, 3, 4],
      [5, 6, 7, 8],
      [9, 10, 11, 12],
    ]);
    expect(result.ideas[0]).toMatchObject({ category: "", targetSeconds: 30, outline: "모래 목욕\n깃털 관리" });
    expect(calls[0].system).toBe(STORIES_SYSTEM_PROMPT);
    const tool = calls[0].tools!.find((t) => "name" in t && t.name === "submit_stories") as Anthropic.Beta.Messages.BetaTool;
    expect(JSON.stringify(tool.input_schema)).toContain(JSON.stringify(items.map((item) => item.id)));
  });

  it("장면 수가 안 맞거나 소재가 겹치면 한 번 고치게 하고, 소재가 모자라면 시작하지 않는다", async () => {
    const ids = items.map((item) => item.id);
    expect(checkStories({ stories: [story([1, 2, 3]), story([3, 4, 5, 6]), story([7, 8, 9, 99])] }, ids, 3)).toEqual([
      "1번 후보: 30초는 장면 4개인데 소재가 3개다.",
      "2번 후보: #3 는 다른 장면·후보에서 이미 썼다.",
      "3번 후보: #99 는 목록에 없는 소재다.",
    ]);
    const bad = [story([1, 2, 3]), story([5, 6, 7, 8]), story([9, 10, 11, 12])];
    const good = [story([1, 2, 3, 4]), story([5, 6, 7, 8]), story([9, 10, 11, 12])];
    const fixed = fake([submit(bad), submit(good, "tu_2")]);
    expect(
      (
        await generateStories(
          { channelPrompt: "", defaultSeconds: 30, recentTopics: [], items },
          { model: "m", send: fixed.send },
        )
      ).ideas,
    ).toHaveLength(3);

    await expect(
      generateStories(
        { channelPrompt: "", defaultSeconds: 30, recentTopics: [], items: items.slice(0, 5) },
        { model: "m", send: fake([]).send },
      ),
    ).rejects.toThrow("소재 풀을 먼저 채우세요");
  });
});

describe.skipIf(!testDatabaseUrl)("소재 풀·스토리 (실제 DB)", () => {
  let drop: () => Promise<void>;

  beforeAll(async () => {
    const schema = await createMigratedSchema("stories");
    drop = schema.drop;
    process.env.DATABASE_URL = schema.url;
  });

  afterAll(async () => {
    const { getPool } = await import("@/lib/db");
    await getPool().end();
    await drop();
  });

  /** 검색어·페이지마다 정해 둔 결과를 돌려주는 가짜 iNaturalist. */
  function adapter(results: (keyword: string, page: number) => ClipCandidate[]): SourceAdapter & { calls: SearchOptions[] } {
    const calls: SearchOptions[] = [];
    return {
      id: "inaturalist",
      label: "iNaturalist",
      availability: () => ({ ok: true }),
      search: async (keyword, options) => {
        calls.push(options);
        return results(keyword, options.page ?? 1);
      },
      calls,
    };
  }

  it("풀 수집: 검색어를 돌려 쓰고 다음 페이지를 가져오며, 이미 있는 소재·비영리·새 아닌 것은 넣지 않는다", async () => {
    const pool = await import("@/pipeline/clips/pool");
    const { query } = await import("@/lib/db");
    expect((await pool.listPoolKeywords("saesae")).length).toBeGreaterThan(30);
    await pool.setPoolKeywords("saesae", "Sparrow\nowl\n\nsparrow\npuffin\nheron");
    expect((await pool.listPoolKeywords("saesae")).map((k) => k.keyword)).toEqual(["heron", "owl", "puffin", "sparrow"]);
    await expect(pool.setPoolKeywords("saesae", " \n ")).rejects.toThrow("하나 이상");

    const source = adapter((keyword, page) => [
      bird(`${keyword}-${page}-a`),
      bird(`${keyword}-${page}-b`),
      bird("same-everywhere"), // 여러 검색어에 같이 나오는 소재
      bird(`${keyword}-nc`, {
        license: { code: "cc-by", name: "CC BY 4.0", url: null, raw: { license_code: "cc-by-nc", iconic_taxon_name: "Aves" } },
      }),
      bird(`${keyword}-cat`, {
        license: { code: "cc-by", name: "CC BY", url: null, raw: { license_code: "cc-by", iconic_taxon_name: "Mammalia" } },
      }),
    ]);
    const first = await pool.collectPool("saesae", { adapters: [source] });
    expect(first).toMatchObject({ skipped: false, added: 7, keywords: ["heron", "owl", "puffin"] });
    expect(source.calls.every((call) => call.iconicTaxa === "Aves" && call.page === 1)).toBe(true);

    const second = await pool.collectPool("saesae", { adapters: [source] });
    expect(second.keywords).toEqual(["sparrow", "heron", "owl"]);
    expect(second.added).toBe(6); // sparrow p1 2개 + heron·owl p2 각 2개, same-everywhere 는 이미 있다
    expect(source.calls.slice(3).map((call) => call.page)).toEqual([1, 2, 2]);
    expect(await pool.poolStock("saesae")).toBe(13);
    const [{ count }] = await query<{ count: number }>(
      "select count(*)::int as count from clip_candidates c join clip_collections k on k.id = c.collection_id where k.kind = 'pool' and c.source_id = 'same-everywhere'",
    );
    expect(count).toBe(1);

    // 결과가 없는 검색어는 다음에 1쪽부터
    const empty = adapter(() => []);
    await pool.collectPool("saesae", { adapters: [empty] });
    expect((await pool.listPoolKeywords("saesae")).find((k) => k.keyword === "puffin")!.page).toBe(1);

    // 안 쓴 소재가 충분하면 모으지 않는다
    await query("update pool_keywords set last_used_at = null");
    await query("delete from clip_search_cache"); // 앞의 가짜 결과가 페이지별 캐시에 남아 있다
    const many = adapter((keyword, page) => Array.from({ length: 30 }, (_, i) => bird(`${keyword}-${page}-many-${i}`)));
    await pool.collectPool("saesae", { adapters: [many] });
    expect(await pool.collectPool("saesae", { adapters: [many] })).toMatchObject({ skipped: true, added: 0 });
  });

  it("스토리 추천 → 고르면 그 소재로 편집형 에피소드를 만들고, 쓴 소재는 다음 스토리에서 뺀다", async () => {
    const pool = await import("@/pipeline/clips/pool");
    const store = await import("@/pipeline/ideas/store");
    const { runIdeaRun } = await import("@/pipeline/ideas/run");
    const { createStoryEpisode } = await import("@/pipeline/ideas/stories");
    const { listPicks } = await import("@/pipeline/clips/picks");
    const { getEpisode } = await import("@/pipeline/episodes");
    const { getClips } = await import("@/pipeline/clips/store");

    const items = await pool.availablePoolItems("saesae");
    const ids = items.map((item) => item.id);
    const run = await store.requestIdeaRun("saesae", "manual");
    const { send, calls } = fake([submit([story(ids.slice(0, 4)), story(ids.slice(4, 8)), story(ids.slice(8, 12))])]);
    const unused = adapter(() => []);
    const result = await runIdeaRun(run.id, { send, adapters: [unused] });
    expect(unused.calls).toEqual([]); // 소재가 충분해 수집하지 않았다
    expect(result.ideas.map((idea) => idea.clipIds)).toEqual([ids.slice(0, 4), ids.slice(4, 8), ids.slice(8, 12)]);
    expect(String(calls[0].messages[0].content)).toContain("새새 열매");

    // 보지 않은 스토리에 들어간 소재는 다음 스토리 후보 목록에서 빠진다
    const next = (await pool.availablePoolItems("saesae")).map((item) => item.id);
    expect(next.some((id) => ids.slice(0, 12).includes(id))).toBe(false);

    const [first] = result.ideas;
    const created = await store.claimIdea(
      first.id,
      async (idea) => (await createStoryEpisode(idea, { title: idea.title, outline: idea.outline })).episodeId,
    );
    const episode = (await getEpisode(created))!;
    expect(episode).toMatchObject({
      route: "clips",
      channel: "saesae",
      targetSeconds: 30,
      outline: expect.stringContaining("컨셉: 참새는 왜"),
    });
    const picks = await listPicks(episode.id);
    expect(picks.map((pick) => pick.sourceId)).toEqual((await getClips(first.clipIds!)).map((item) => item.sourceId));
    expect(picks.every((pick) => pick.collectionId !== items[0].collectionId)).toBe(true); // 에피소드 자신의 수집으로 옮겨 적었다
    // 쓴 풀 소재는 "사용됨" 으로 표시된다
    const { query: q } = await import("@/lib/db");
    const marked = await q<{ id: number }>("select id from clip_candidates where pool_used_at is not null order by id");
    expect(marked.map((row) => row.id)).toEqual([...first.clipIds!].sort((a, b) => a - b));

    // 자동 추천: 편집형 채널도 대상(카테고리 없음)
    const { updateIdeaSettings } = await import("@/pipeline/channels");
    const { query } = await import("@/lib/db");
    await updateIdeaSettings("saesae", { auto: true, everyDays: 1 });
    await query("update idea_runs set created_at = now() - interval '2 days'");
    await query("update ideas set status = 'discarded' where status = 'new'");
    expect(await store.dueIdeaChannels()).toEqual(["saesae"]);
  });
});
