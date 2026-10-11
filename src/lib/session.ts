import { createHash, createHmac, timingSafeEqual } from "node:crypto";

// 대시보드 로그인: 비밀번호 1개 + 서명된 쿠키 (docs/decisions.md "대시보드 인증").
// 쿠키 값은 `만료시각.서명` 이다. 서명에 비밀번호의 해시를 섞어서,
// 비밀번호를 바꾸면 기존 로그인이 모두 풀린다.

export const SESSION_COOKIE = "sw_session";
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const MIN_SECRET_LENGTH = 32;

export interface AuthConfig {
  password: string;
  secret: string;
}

export type AuthConfigResult = { ok: true; config: AuthConfig } | { ok: false; missing: string[] };

export function readAuthConfig(env: Record<string, string | undefined> = process.env): AuthConfigResult {
  const password = env.DASHBOARD_PASSWORD ?? "";
  const secret = env.SESSION_SECRET ?? "";
  const missing: string[] = [];
  if (!password) missing.push("DASHBOARD_PASSWORD");
  if (secret.length < MIN_SECRET_LENGTH) missing.push(`SESSION_SECRET (${MIN_SECRET_LENGTH}자 이상)`);
  return missing.length ? { ok: false, missing } : { ok: true, config: { password, secret } };
}

function sign(config: AuthConfig, expiresAt: number): string {
  const passwordHash = createHash("sha256").update(config.password).digest("hex");
  return createHmac("sha256", config.secret).update(`v1.${expiresAt}.${passwordHash}`).digest("base64url");
}

export function createSessionToken(config: AuthConfig, now = Date.now()): string {
  const expiresAt = Math.floor(now / 1000) + SESSION_MAX_AGE_SECONDS;
  return `${expiresAt}.${sign(config, expiresAt)}`;
}

export function verifySessionToken(token: string | undefined, config: AuthConfig, now = Date.now()): boolean {
  if (!token) return false;
  const [expiresRaw, signature, ...rest] = token.split(".");
  if (rest.length || !expiresRaw || !signature || !/^\d+$/.test(expiresRaw)) return false;
  const expiresAt = Number(expiresRaw);
  if (expiresAt * 1000 <= now) return false;
  return safeEqual(signature, sign(config, expiresAt));
}

/** 입력한 비밀번호가 맞는가. 길이·내용에 따라 걸리는 시간이 달라지지 않게 비교한다. */
export function checkPassword(input: string, config: AuthConfig): boolean {
  return safeEqual(input, config.password);
}

function safeEqual(a: string, b: string): boolean {
  // 길이가 달라도 같은 길이의 다이제스트로 비교해서 시간 차이를 없앤다.
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(a), digest(b)) && a === b;
}
