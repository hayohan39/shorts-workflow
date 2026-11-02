import { writeFile } from "node:fs/promises";
import type Anthropic from "@anthropic-ai/sdk";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ConvertSource } from "@/pipeline/clips/adopt";
import { RateLimitError } from "@/pipeline/clips/http";
import { KEYWORD_MODEL } from "@/pipeline/clips/keywords";
import type { ClipCandidate, SourceAdapter } from "@/pipeline/clips/types";
import { clip } from "./helpers/clips";
import { createMigratedSchema, testDatabaseUrl } from "./helpers/db";

function keywordMessage(keywords: string[]): Anthropic.Message {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: KEYWORD_MODEL,
    content: [{ type: "text", text: JSON.stringify({ keywords }), citations: null }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 200, output_tokens: 40 },
  } as Anthropic.Message;
}

/** 키워드마다 정해진 후보를 돌려주는 가짜 소스. 요청 기록을 확인하려고 fetchImpl 도 한 번 부른다. */
function fakeAdapter(results: Record<string, ClipCandidate[] | Error>, ok = true): SourceAdapter & { calls: string[] } {
  const calls: string[] = [];
  return {
    id: "pixabay",
    label: "Pixabay",
    calls,
    availability: () => (ok ? { ok: true } : { ok: false, reason: "PIXABAY_API_KEY 가 없습니다." }),
    search: async (keyword, options) => {
      calls.push(keyword);
      await options.fetchImpl!("https://example.test/search");
      const result = results[keyword] ?? [];
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

const fetchOk = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));

describe.skipIf(!testDatabaseUrl)("영상 클립 수집·교체·채택 (실제 DB, 가짜 소스·Blob)", () => {
  let drop: () => Promise<void>;

  beforeAll(async () => {
    const schema = await createMigratedSchema("clips");
    drop = schema.drop;
    process.env.DATABASE_URL = schema.url;
  });

  afterAll(async () => {
    const { getPool } = await import("@/lib/db");
    await getPool().end();
    await drop();
  });

  it("주제를 검증하고 대기열에 넣는다", async () => {
    const { createSearchCollection, TOPIC_MAX } = await import("@/pipeline/clips/store");
    await expect(createSearchCollection("  ")).rejects.toThrow(RangeError);
    await expect(createSearchCollection("가".repeat(TOPIC_MAX + 1))).rejects.toThrow(RangeError);
    expect(await createSearchCollection("  겨울   바다 ")).toMatchObject({ topic: "겨울 바다", status: "queued", kind: "search" });
  });

  it("수집: 키워드별 검색 → 선별 → 저장, 같은 키워드는 24시간 캐시를 쓴다", async () => {
    const { createSearchCollection, listClips, listSourceStates, startCollection } = await import("@/pipeline/clips/store");
    const { collectClips } = await import("@/pipeline/clips/collect");
    const ocean = Array.from({ length: 8 }, (_, i) => clip({ sourceId: `o${i}`, keyword: "ocean", durationSec: 15 }));
    const waves = [clip({ sourceId: "w1", keyword: "waves", width: 1920, height: 1080 }), clip({ sourceId: "o0", keyword: "waves" })];
    const adapter = fakeAdapter({ ocean, waves });
    const send = vi.fn(async () => keywordMessage(["ocean", "waves"]));

    const created = await createSearchCollection("겨울 바다");
    const started = await startCollection(created.id, "https://example.test/run/1");
    const done = await collectClips(started!, { adapters: [adapter], send, fetchImpl: fetchOk });

    expect(done).toMatchObject({ status: "done", keywords: ["ocean", "waves"], totalSeconds: 90, shortfall: null });
    expect(done.keywordCostUsd).toBeGreaterThan(0);
    expect(done.sourceResults).toEqual({ pixabay: { found: 10, kept: 6 } });
    const clips = await listClips(created.id);
    expect(clips.filter((c) => c.rank !== null).map((c) => c.rank)).toEqual([1, 2, 3, 4, 5, 6]);
    // 중복(o0) 은 하나만, 나머지는 교체 후보(가로 클립이 점수가 낮아 뒤로).
    expect(clips).toHaveLength(9);
    expect(clips.at(-1)).toMatchObject({ sourceId: "w1", rank: null });
    expect(clips[0].license).toMatchObject({ code: "pixabay", name: "Pixabay Content License" });
    expect((await listSourceStates())[0]).toMatchObject({ source: "pixabay", requestsToday: 2, lastStatus: 200 });

    // 두 번째 수집: 같은 키워드는 소스를 다시 부르지 않는다.
    const again = await startCollection((await createSearchCollection("겨울 바다")).id, null);
    await collectClips(again!, { adapters: [adapter], send, fetchImpl: fetchOk });
    expect(adapter.calls).toEqual(["ocean", "waves"]);
    // 끝난 수집은 다시 시작하지 않는다.
    expect(await startCollection(created.id, null)).toBeNull();
  });

  it("한도(429)에 걸린 소스는 대기 시각을 남기고, 그 시각까지는 건너뛴다", async () => {
    const { createSearchCollection, listSourceStates, setSourceRetryAt, startCollection } = await import("@/pipeline/clips/store");
    const { collectClips } = await import("@/pipeline/clips/collect");
    const retryAt = new Date(Date.now() + 60_000);
    const limited = fakeAdapter({ storm: new RateLimitError("pixabay", retryAt), rain: [clip({ keyword: "rain" })] });
    const send = vi.fn(async () => keywordMessage(["storm", "rain"]));

    // 한도에 걸리면 그 소스의 나머지 키워드는 부르지 않는다. 결과가 하나도 없으니 수집은 실패.
    const first = await startCollection((await createSearchCollection("폭풍")).id, null);
    await expect(collectClips(first!, { adapters: [limited], send, fetchImpl: fetchOk })).rejects.toThrow("요청 한도");
    expect(limited.calls).toEqual(["storm"]);
    expect((await listSourceStates())[0].retryAt?.getTime()).toBe(retryAt.getTime());

    const second = await startCollection((await createSearchCollection("폭풍")).id, null);
    await expect(collectClips(second!, { adapters: [limited], send, fetchImpl: fetchOk })).rejects.toThrow("요청 한도 대기 중");
    expect(limited.calls).toEqual(["storm"]);

    // 다음 테스트를 위해 대기를 푼다(지난 시각은 화면에 보이지 않는다).
    await setSourceRetryAt("pixabay", new Date(Date.now() - 1000));
    expect((await listSourceStates())[0].retryAt).toBeNull();
  });

  it("모든 소스가 실패하면 수집 자체를 실패로 본다(키 없음 포함)", async () => {
    const { createSearchCollection, failCollection, getCollection, startCollection } = await import("@/pipeline/clips/store");
    const { collectClips } = await import("@/pipeline/clips/collect");
    const send = vi.fn(async () => keywordMessage(["sky"]));
    const created = await createSearchCollection("하늘");
    const started = await startCollection(created.id, null);
    const error = await collectClips(started!, { adapters: [fakeAdapter({}, false)], send }).catch((e: Error) => e);
    expect(String(error)).toContain("Pixabay: PIXABAY_API_KEY 가 없습니다.");
    await failCollection(created.id, String(error));
    expect(await getCollection(created.id)).toMatchObject({ status: "failed" });
  });

  it("다시 수집은 실패·멈춘 것만, 교체는 선택↔후보를 바꾸고 합계를 다시 센다", async () => {
    const store = await import("@/pipeline/clips/store");
    const { collectClips } = await import("@/pipeline/clips/collect");
    const created = await store.createSearchCollection("숲");
    expect(await store.requeueCollection(created.id)).toBeNull(); // 대기 중
    await store.failCollection(created.id, "중단");
    expect(await store.requeueCollection(created.id)).toMatchObject({ status: "queued", error: null });

    const forest = [
      clip({ sourceId: "f1", keyword: "forest", durationSec: 30 }),
      clip({ sourceId: "f2", keyword: "forest", durationSec: 30 }),
      clip({ sourceId: "f3", keyword: "forest", durationSec: 30 }),
      clip({ sourceId: "f4", keyword: "forest", durationSec: 5, width: 1920, height: 1080 }),
    ];
    const started = await store.startCollection(created.id, null);
    await collectClips(started!, { adapters: [fakeAdapter({ forest })], send: async () => keywordMessage(["forest"]), fetchImpl: fetchOk });
    const clips = await store.listClips(created.id);
    const [first] = clips;
    const alternate = clips.find((c) => c.rank === null)!;

    await store.swapClip(created.id, first.id, alternate.id);
    const swapped = await store.listClips(created.id);
    expect(swapped.find((c) => c.id === alternate.id)?.rank).toBe(first.rank);
    expect(swapped.find((c) => c.id === first.id)?.rank).toBeNull();
    expect((await store.getCollection(created.id))?.totalSeconds).toBe(65);
    await expect(store.swapClip(created.id, alternate.id, alternate.id)).rejects.toThrow(RangeError);
  });

  it("채택: 남은 클립만 쓰는 구간을 변환·저장하고, 실패하면 거기서 멈춘다", async () => {
    const store = await import("@/pipeline/clips/store");
    const { collectClips } = await import("@/pipeline/clips/collect");
    const { adoptClips } = await import("@/pipeline/clips/adopt");
    const created = await store.createSearchCollection("사막");
    expect(await store.requestAdopt(created.id)).toBeNull(); // 수집 전
    const desert = Array.from({ length: 3 }, (_, i) =>
      clip({ sourceId: `d${i}`, keyword: "desert", durationSec: [30, 120, null][i], downloadUrl: `https://cdn.test/d${i}.mp4` }),
    );
    const started = await store.startCollection(created.id, null);
    await collectClips(started!, { adapters: [fakeAdapter({ desert })], send: async () => keywordMessage(["desert"]), fetchImpl: fetchOk });

    expect(await store.requestAdopt(created.id)).toMatchObject({ adoptStatus: "queued" });
    expect(await store.requestAdopt(created.id)).toBeNull(); // 이미 대기 중
    expect(await store.startAdopt(created.id, "https://example.test/run/2")).toMatchObject({ adoptStatus: "running" });

    const put = vi.fn(async (pathname: string) => ({ url: `https://blob.test/${pathname}` }));
    let broken = true;
    const convert = vi.fn(async (source: ConvertSource, output: string) => {
      if (broken && source.url.endsWith("d1.mp4")) throw new Error("ffmpeg 실패: 404 Not Found");
      await writeFile(output, "mp4");
    });
    const error = await adoptClips(created.id, { put, convert }).catch((e: Error) => e);
    expect(String(error)).toContain("채택 실패: ffmpeg 실패: 404 Not Found");
    // 30초 이하는 전부, 긴 클립은 1/4 지점부터 15초.
    expect(convert.mock.calls.map(([source]) => source)).toEqual([
      { url: "https://cdn.test/d0.mp4", start: 0, length: 30 },
      { url: "https://cdn.test/d1.mp4", start: 30, length: 15 },
    ]);
    await store.failAdopt(created.id, String(error));

    let clips = await store.listClips(created.id);
    expect(clips.filter((c) => c.blobUrl).map((c) => c.sourceId)).toEqual(["d0"]);
    expect(put).toHaveBeenCalledWith(`clips/${created.id}/${clips[0].id}.mp4`, expect.any(Buffer), "video/mp4");

    // 다시 채택하면 남은 것만.
    await store.requestAdopt(created.id);
    await store.startAdopt(created.id, null);
    broken = false;
    expect(await adoptClips(created.id, { put, convert })).toBe(1);
    await store.finishAdopt(created.id);
    clips = await store.listClips(created.id);
    expect(clips.filter((c) => c.rank !== null).every((c) => c.blobUrl && c.adoptedAt)).toBe(true);
    expect(await store.getCollection(created.id)).toMatchObject({ adoptStatus: "done", adoptError: null });
  });
});
