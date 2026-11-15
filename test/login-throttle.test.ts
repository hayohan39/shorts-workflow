import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { clientIp, LOGIN_LIMITS } from "@/lib/login-throttle";
import { createMigratedSchema, testDatabaseUrl } from "./helpers/db";

describe("로그인 요청 IP", () => {
  it("x-real-ip, 없으면 x-forwarded-for 의 첫 값", () => {
    expect(clientIp(new Headers({ "x-real-ip": "1.1.1.1", "x-forwarded-for": "2.2.2.2" }))).toBe("1.1.1.1");
    expect(clientIp(new Headers({ "x-forwarded-for": "3.3.3.3, 10.0.0.1" }))).toBe("3.3.3.3");
    expect(clientIp(new Headers())).toBe("unknown");
  });
});

describe.skipIf(!testDatabaseUrl)("로그인 시도 제한 (실제 DB)", () => {
  let drop: () => Promise<void>;

  beforeAll(async () => {
    const schema = await createMigratedSchema("login");
    drop = schema.drop;
    process.env.DATABASE_URL = schema.url;
  });

  beforeEach(async () => {
    const { query } = await import("@/lib/db");
    await query("delete from login_failures");
  });

  afterAll(async () => {
    const { getPool } = await import("@/lib/db");
    await getPool().end();
    await drop();
  });

  it("IP 당 15분에 5번까지, 6번째부터 막고, 다른 IP 는 그대로, 성공하면 기록을 지운다", async () => {
    const { beginLoginAttempt, clearLoginFailures } = await import("@/lib/login-throttle");
    for (let i = 0; i < LOGIN_LIMITS.perIp.failures; i++) {
      expect(await beginLoginAttempt("9.9.9.9")).toEqual({ ok: true });
    }
    const blocked = await beginLoginAttempt("9.9.9.9");
    expect(blocked).toMatchObject({ ok: false });
    expect(!blocked.ok && blocked.retryAfterMinutes).toBeGreaterThanOrEqual(14);
    expect(await beginLoginAttempt("8.8.8.8")).toEqual({ ok: true });

    await clearLoginFailures("9.9.9.9");
    expect(await beginLoginAttempt("9.9.9.9")).toEqual({ ok: true });
  });

  it("동시에 여러 요청을 보내도 한도만큼만 통과한다", async () => {
    const { beginLoginAttempt } = await import("@/lib/login-throttle");
    const gates = await Promise.all(Array.from({ length: 20 }, () => beginLoginAttempt("4.4.4.4")));
    expect(gates.filter((gate) => gate.ok).length).toBeLessThanOrEqual(LOGIN_LIMITS.perIp.failures);
  });

  it("오래된 실패는 세지 않고, 하루 지난 기록은 지운다", async () => {
    const { query } = await import("@/lib/db");
    const { beginLoginAttempt } = await import("@/lib/login-throttle");
    await query(
      "insert into login_failures (ip, failed_at) select '7.7.7.7', now() - interval '20 minutes' from generate_series(1, 10)",
    );
    await query("insert into login_failures (ip, failed_at) values ('6.6.6.6', now() - interval '2 days')");
    expect(await beginLoginAttempt("7.7.7.7")).toEqual({ ok: true });
    const [old] = await query<{ count: string }>("select count(*) from login_failures where ip = '6.6.6.6'");
    expect(old.count).toBe("0");
  });

  it("여러 IP 로 나눠 1시간에 100번 넘게 실패하면 새 로그인을 모두 막는다", async () => {
    const { query } = await import("@/lib/db");
    const { beginLoginAttempt } = await import("@/lib/login-throttle");
    await query(
      `insert into login_failures (ip, failed_at)
       select '10.0.' || g || '.1', now() - interval '30 minutes' from generate_series(1, $1) g`,
      [LOGIN_LIMITS.total.failures],
    );
    const gate = await beginLoginAttempt("5.5.5.5");
    expect(gate).toMatchObject({ ok: false });
    expect(!gate.ok && gate.retryAfterMinutes).toBeGreaterThanOrEqual(29);
    expect(!gate.ok && gate.retryAfterMinutes).toBeLessThanOrEqual(31);
  });
});
