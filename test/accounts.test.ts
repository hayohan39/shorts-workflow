import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { numericFields, pickRemainingCredits } from "@/pipeline/providers/manymotions";
import { createMigratedSchema, testDatabaseUrl } from "./helpers/db";

describe("ManyMotions 계정 응답에서 잔여 크레딧 찾기", () => {
  it("숫자 필드만 펼친다(문자열은 버린다)", () => {
    expect(numericFields({ email: "a@b.c", plan: "starter", credits: { remaining: 1200, used: 300 }, tags: [1] })).toEqual({
      "credits.remaining": 1200,
      "credits.used": 300,
    });
  });

  it("남은·잔액 필드를 먼저, 사용량·한도는 빼고 고른다", () => {
    expect(pickRemainingCredits({ "credits.used": 300, "credits.remaining": 1200 })).toEqual({
      field: "credits.remaining",
      credits: 1200,
    });
    expect(pickRemainingCredits({ credits_used_this_month: 10, credit_balance: 77 })).toEqual({
      field: "credit_balance",
      credits: 77,
    });
    expect(pickRemainingCredits({ "account.credits": 500, "account.monthly_credits": 4000 })).toEqual({
      field: "account.credits",
      credits: 500,
    });
    expect(pickRemainingCredits({ "usage.total_credits": 9, id: 3 })).toBeNull();
    // credit 이라는 단어 없이 remaining/available 만 오는 응답도 찾는다.
    expect(pickRemainingCredits({ remaining: 3210, used: 90, limit: 4000 })).toEqual({ field: "remaining", credits: 3210 });
    expect(pickRemainingCredits({ "account.available": 15 })).toEqual({ field: "account.available", credits: 15 });
    // 요청 수 제한의 remaining 은 크레딧이 아니다.
    expect(pickRemainingCredits({ "rate_limit.remaining": 59, requests_remaining: 10 })).toBeNull();
  });
});

describe.skipIf(!testDatabaseUrl)("ManyMotions 잔여 크레딧 저장 (실제 DB)", () => {
  let drop: () => Promise<void>;

  beforeAll(async () => {
    const schema = await createMigratedSchema("accounts");
    drop = schema.drop;
    process.env.DATABASE_URL = schema.url;
  });

  afterAll(async () => {
    const { getPool } = await import("@/lib/db");
    await getPool().end();
    await drop();
  });

  it("조회 성공 → 저장, 실패 → 이전 잔액 유지하고 사유만 남김", async () => {
    const { getManyMotionsAccount, refreshManyMotionsAccount } = await import("@/pipeline/accounts");
    expect(await getManyMotionsAccount()).toBeNull();

    let auth = "";
    const ok = (async (_url: string, init: RequestInit) => {
      auth = (init.headers as Record<string, string>).Authorization;
      return new Response(JSON.stringify({ email: "me@example.com", credits_remaining: 3210 }), { status: 200 });
    }) as unknown as typeof fetch;
    const line = await refreshManyMotionsAccount("cw_live_key", ok);
    expect(auth).toBe("Bearer cw_live_key");
    expect(line).toContain("잔여 크레딧 3,210 (credits_remaining)");
    expect(line).not.toContain("example.com");
    const saved = await getManyMotionsAccount();
    expect(saved).toMatchObject({ state: "ok", credits: 3210, creditsField: "credits_remaining", message: null });
    expect(saved?.fields).toEqual({ credits_remaining: 3210 });

    const broken = (async () => new Response("bad cw_live_secret", { status: 401 })) as unknown as typeof fetch;
    expect(await refreshManyMotionsAccount("cw_live_key", broken)).toContain("401");
    const failed = await getManyMotionsAccount();
    expect(failed).toMatchObject({ state: "failed", credits: 3210 });
    expect(failed?.message).not.toContain("secret");
    expect(failed?.fetchedAt).toEqual(saved?.fetchedAt);

    const unknown = (async () => new Response(JSON.stringify({ plan: "pro", id: 7 }), { status: 200 })) as unknown as typeof fetch;
    expect(await refreshManyMotionsAccount("cw_live_key", unknown)).toContain("찾지 못함 · 숫자 필드: id=7");
    expect(await getManyMotionsAccount()).toMatchObject({ state: "ok", credits: null, message: expect.stringContaining("찾지 못했습니다") });
  });
});
