import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { proxy } from "@/proxy";
import { createSessionToken, SESSION_COOKIE } from "@/lib/session";

const config = { password: "pw", secret: "s".repeat(32) };
const saved = { ...process.env };

function request(path: string, token?: string) {
  return new NextRequest(`https://dash.example${path}`, {
    headers: token ? { cookie: `${SESSION_COOKIE}=${token}` } : {},
  });
}

describe("proxy (로그인 확인)", () => {
  beforeEach(() => {
    process.env.DASHBOARD_PASSWORD = config.password;
    process.env.SESSION_SECRET = config.secret;
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("로그인 화면과 헬스체크는 그대로 통과", () => {
    for (const path of ["/login", "/api/health"]) {
      expect(proxy(request(path)).headers.get("x-middleware-next")).toBe("1");
    }
  });

  it("로그인 안 했으면 로그인 화면으로, 원래 경로를 next 로", () => {
    const response = proxy(request("/episodes/3?x=1"));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/episodes/3?x=1");
  });

  it("API 는 401", async () => {
    const response = proxy(request("/api/anything"));
    expect(response.status).toBe(401);
  });

  it("유효한 세션이면 통과, 위조면 거부", () => {
    const token = createSessionToken(config);
    expect(proxy(request("/", token)).headers.get("x-middleware-next")).toBe("1");
    expect(proxy(request("/", token + "x")).status).toBe(307);
  });

  it("설정이 없으면 아무도 통과하지 못한다", () => {
    const token = createSessionToken(config);
    delete process.env.SESSION_SECRET;
    expect(proxy(request("/", token)).status).toBe(307);
  });
});
