import { describe, expect, it, vi } from "vitest";
import { fetchSourceJson, RateLimitError, retryDelayMs, skipOnError, USER_AGENT } from "@/pipeline/clips/http";

function respond(status: number, body: unknown = {}, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

describe("소스 API 요청", () => {
  it("User-Agent 를 붙이고 JSON 을 돌려준다", async () => {
    const fetchImpl = vi.fn(async () => respond(200, { hits: [1] }));
    await expect(fetchSourceJson("https://api.test/x", { source: "pixabay", fetchImpl })).resolves.toEqual({ hits: [1] });
    expect(fetchImpl).toHaveBeenCalledWith("https://api.test/x", {
      headers: { "user-agent": USER_AGENT, accept: "application/json" },
    });
  });

  it("429 는 Retry-After 만큼 기다렸다가 다시 시도하고, 상태를 알린다", async () => {
    const responses = [respond(429, {}, { "retry-after": "5" }), respond(200, { ok: true })];
    const sleep = vi.fn(async () => {});
    const statuses: number[] = [];
    const result = await fetchSourceJson("https://api.test/x", {
      source: "pixabay",
      fetchImpl: async () => responses.shift()!,
      sleep,
      onResponse: (status) => statuses.push(status),
    });
    expect(result).toEqual({ ok: true });
    expect(sleep).toHaveBeenCalledWith(5_000);
    expect(statuses).toEqual([429, 200]);
  });

  it("계속 429 면 RateLimitError", async () => {
    const sleep = vi.fn(async () => {});
    const error = await fetchSourceJson("https://api.test/x", { source: "wikimedia", fetchImpl: async () => respond(429), sleep }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).source).toBe("wikimedia");
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("그 밖의 실패는 상태 코드와 응답 앞부분으로 에러", async () => {
    await expect(
      fetchSourceJson("https://api.test/x", { source: "nasa", fetchImpl: async () => respond(400, { reason: "bad q" }) }),
    ).rejects.toThrow('nasa 요청 실패 (HTTP 400): {"reason":"bad q"}');
  });

  it("대기 시간: Retry-After 초·날짜, 없으면 2·4·8초, 최대 60초", () => {
    expect(retryDelayMs("3", 0)).toBe(3_000);
    expect(retryDelayMs("600", 0)).toBe(60_000);
    expect(retryDelayMs(new Date(10_000).toUTCString(), 0, 4_000)).toBe(6_000);
    expect(retryDelayMs(null, 0)).toBe(2_000);
    expect(retryDelayMs(null, 2)).toBe(8_000);
  });

  it("항목 하나의 실패는 건너뛰고(null), 요청 한도는 그대로 던진다", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await skipOnError(async () => 1)).toBe(1);
    expect(await skipOnError(async () => Promise.reject(new Error("404")))).toBeNull();
    const limited = new RateLimitError("nasa", new Date());
    await expect(skipOnError(async () => Promise.reject(limited))).rejects.toBe(limited);
  });
});
