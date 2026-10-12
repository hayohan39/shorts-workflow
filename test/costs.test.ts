import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CostApiError, fetchCostReport, summarizeCosts, type CostBucket } from "@/pipeline/providers/anthropic-costs";
import { createMigratedSchema, testDatabaseUrl } from "./helpers/db";

const item = (amount: string, extra: Partial<CostBucket["results"][number]> = {}) => ({
  amount,
  currency: "USD",
  cost_type: "tokens",
  description: "Claude Haiku 5.5 Usage - Input Tokens",
  model: "claude-haiku-5-5",
  workspace_id: null,
  ...extra,
});

const buckets: CostBucket[] = [
  {
    starting_at: "2026-10-01T00:00:00Z",
    ending_at: "2026-10-02T00:00:00Z",
    results: [
      item("12.5"),
      item("7.5", { description: "Output Tokens" }),
      item("4", { cost_type: "web_search", model: null, description: "Web Search" }),
      item("100", { workspace_id: "wrkspc_other", model: "claude-opus-5-5" }),
    ],
  },
  { starting_at: "2026-10-02T00:00:00Z", ending_at: "2026-10-03T00:00:00Z", results: [] },
];

describe("Cost API 응답 정리", () => {
  it("센트 문자열을 달러로 바꿔 날짜·모델·종류별로 합친다", () => {
    const [first, second] = summarizeCosts(buckets);
    expect(first.day).toBe("2026-10-01");
    expect(first.usd).toBeCloseTo(1.24);
    expect(first.breakdown).toEqual([
      { model: "claude-opus-5-5", costType: "tokens", usd: 1 },
      { model: "claude-haiku-5-5", costType: "tokens", usd: 0.2 },
      { model: null, costType: "web_search", usd: 0.04 },
    ]);
    expect(second).toEqual({ day: "2026-10-02", usd: 0, breakdown: [] });
  });

  it("워크스페이스를 지정하면 그 워크스페이스만 센다(default = 기본 워크스페이스)", () => {
    expect(summarizeCosts(buckets, "default")[0].usd).toBeCloseTo(0.24);
    expect(summarizeCosts(buckets, "wrkspc_other")[0].usd).toBeCloseTo(1);
  });

  it("페이지를 끝까지 넘기고, 권한 오류는 알아볼 수 있게 알린다", async () => {
    const urls: string[] = [];
    const pages = [
      { data: [buckets[0]], has_more: true, next_page: "page_2" },
      { data: [buckets[1]], has_more: false, next_page: null },
    ];
    const fetchFn = (async (url: string, init: RequestInit) => {
      urls.push(url);
      expect((init.headers as Record<string, string>)["x-api-key"]).toBe("sk-ant-admin01-test");
      return new Response(JSON.stringify(pages.shift()), { status: 200 });
    }) as unknown as typeof fetch;
    const result = await fetchCostReport({ key: "sk-ant-admin01-test", startingAt: new Date("2026-10-01T00:00:00Z"), fetchFn });
    expect(result).toHaveLength(2);
    expect(urls[0]).toContain("bucket_width=1d");
    expect(urls[0]).toContain("group_by%5B%5D=description");
    expect(urls[1]).toContain("page=page_2");

    const denied = (async () => new Response("{}", { status: 403 })) as unknown as typeof fetch;
    await expect(fetchCostReport({ key: "k", startingAt: new Date(), fetchFn: denied })).rejects.toThrow(CostApiError);
    await expect(fetchCostReport({ key: "k", startingAt: new Date(), fetchFn: denied })).rejects.toThrow("조직 계정");
  });
});

describe.skipIf(!testDatabaseUrl)("실제 비용 저장 (실제 DB)", () => {
  let drop: () => Promise<void>;

  beforeAll(async () => {
    const schema = await createMigratedSchema("costs");
    drop = schema.drop;
    process.env.DATABASE_URL = schema.url;
  });

  afterAll(async () => {
    const { getPool } = await import("@/lib/db");
    await getPool().end();
    await drop();
  });

  it("키가 없으면 건너뛰고, 있으면 저장하고, 실패하면 상태로만 남긴다", async () => {
    const { getCostStatus, monthlyActualCost, recentCosts, refreshActualCosts } = await import("@/pipeline/costs");
    const now = new Date("2026-10-03T12:00:00Z");
    expect(await monthlyActualCost(now)).toBeNull();

    expect(await refreshActualCosts({ env: {}, now })).toContain("ANTHROPIC_ADMIN_KEY");
    expect(await getCostStatus()).toMatchObject({ state: "skipped" });

    const september: CostBucket = {
      starting_at: "2026-09-30T00:00:00Z",
      ending_at: "2026-10-01T00:00:00Z",
      results: [item("50")],
    };
    let startingAt = "";
    const fetchFn = (async (url: string) => {
      startingAt = new URL(url).searchParams.get("starting_at") ?? "";
      return new Response(JSON.stringify({ data: [september, ...buckets], has_more: false }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await refreshActualCosts({ env: { ANTHROPIC_ADMIN_KEY: "sk-ant-admin01-x" }, fetchFn, now })).toContain("3일치");
    // 이번 달 합계를 위해 지난달까지 넉넉히 가져온다.
    expect(startingAt.slice(0, 10)).toBe("2026-08-29");
    expect(await getCostStatus()).toMatchObject({ state: "ok", message: null });
    // 9월 30일($0.50)은 이번 달(10월)에서 빠진다.
    expect((await monthlyActualCost(now))?.usd).toBeCloseTo(1.24);
    expect((await recentCosts(2)).map((day) => day.day)).toEqual(["2026-10-02", "2026-10-01"]);

    // 같은 날을 다시 가져오면 덮어쓴다.
    const again = (async () =>
      new Response(JSON.stringify({ data: [{ ...buckets[0], results: [item("10")] }], has_more: false }), {
        status: 200,
      })) as unknown as typeof fetch;
    await refreshActualCosts({ env: { ANTHROPIC_ADMIN_KEY: "sk-ant-admin01-x" }, fetchFn: again, now });
    expect((await monthlyActualCost(now))?.usd).toBeCloseTo(0.1);

    const broken = (async () => new Response("bad sk-ant-admin01-secret", { status: 500 })) as unknown as typeof fetch;
    const line = await refreshActualCosts({ env: { ANTHROPIC_ADMIN_KEY: "sk-ant-admin01-x" }, fetchFn: broken, now });
    expect(line).toContain("실패");
    const status = await getCostStatus();
    expect(status).toMatchObject({ state: "failed" });
    expect(status?.message).not.toContain("secret");
    // 실패해도 이전 값은 그대로 남는다.
    expect((await monthlyActualCost(now))?.usd).toBeCloseTo(0.1);
  });

  it("이번 달 대본 계산값 합계", async () => {
    const { createEpisode } = await import("@/pipeline/episodes");
    const { saveScript, scriptCostSince } = await import("@/pipeline/scripts");
    const { toDraft } = await import("@/pipeline/script/schema");
    const { validSubmission } = await import("./helpers/script");
    const episode = await createEpisode({ topic: "비용", outline: "" });
    await saveScript(episode.id, toDraft(validSubmission()), {
      source: "generated",
      warnings: [],
      model: "claude-haiku-5-5",
      usage: { inputTokens: 0, outputTokens: 0, webSearches: 0, costUsd: 0.25 },
    });
    expect(await scriptCostSince(new Date(Date.now() - 60_000))).toEqual({ total: 0.25, runs: 1 });
    expect(await scriptCostSince(new Date(Date.now() + 60_000))).toEqual({ total: 0, runs: 0 });
  });
});
