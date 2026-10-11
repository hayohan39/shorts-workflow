import { describe, expect, it } from "vitest";
import {
  checkPassword,
  createSessionToken,
  readAuthConfig,
  SESSION_MAX_AGE_SECONDS,
  verifySessionToken,
} from "@/lib/session";
import { safeNextPath } from "@/lib/auth";

const config = { password: "correct horse battery", secret: "s".repeat(32) };

describe("대시보드 세션", () => {
  it("환경변수가 없거나 비밀값이 짧으면 설정 필요", () => {
    expect(readAuthConfig({})).toEqual({
      ok: false,
      missing: ["DASHBOARD_PASSWORD", "SESSION_SECRET (32자 이상)"],
    });
    expect(readAuthConfig({ DASHBOARD_PASSWORD: "p", SESSION_SECRET: "short" })).toMatchObject({ ok: false });
    expect(readAuthConfig({ DASHBOARD_PASSWORD: "p", SESSION_SECRET: "x".repeat(32) })).toMatchObject({ ok: true });
  });

  it("비밀번호 확인", () => {
    expect(checkPassword("correct horse battery", config)).toBe(true);
    expect(checkPassword("correct horse batter", config)).toBe(false);
    expect(checkPassword("", config)).toBe(false);
  });

  it("발급한 토큰은 만료 전까지 유효하다", () => {
    const now = Date.UTC(2026, 9, 11);
    const token = createSessionToken(config, now);
    expect(verifySessionToken(token, config, now + 1000)).toBe(true);
    expect(verifySessionToken(token, config, now + SESSION_MAX_AGE_SECONDS * 1000 + 1000)).toBe(false);
  });

  it("위조·변조된 토큰은 거부한다", () => {
    const token = createSessionToken(config);
    const [expires, signature] = token.split(".");
    expect(verifySessionToken(undefined, config)).toBe(false);
    expect(verifySessionToken("", config)).toBe(false);
    expect(verifySessionToken(`${Number(expires) + 999999}.${signature}`, config)).toBe(false);
    expect(verifySessionToken(`${expires}.${signature}x`, config)).toBe(false);
    expect(verifySessionToken(`${token}.extra`, config)).toBe(false);
    expect(verifySessionToken(token, { ...config, secret: "t".repeat(32) })).toBe(false);
  });

  it("비밀번호를 바꾸면 기존 로그인이 풀린다", () => {
    const token = createSessionToken(config);
    expect(verifySessionToken(token, { ...config, password: "new password" })).toBe(false);
  });

  it("로그인 후 돌아갈 경로는 이 사이트 안으로만", () => {
    expect(safeNextPath("/episodes/3")).toBe("/episodes/3");
    expect(safeNextPath("//evil.example")).toBe("/");
    expect(safeNextPath("/\\evil.example")).toBe("/");
    expect(safeNextPath("https://evil.example")).toBe("/");
    expect(safeNextPath(undefined)).toBe("/");
  });
});
