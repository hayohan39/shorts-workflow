"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { safeNextPath } from "@/lib/auth";
import { beginLoginAttempt, clearLoginFailures, clientIp } from "@/lib/login-throttle";
import { checkPassword, createSessionToken, readAuthConfig, SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from "@/lib/session";

export type LoginState = { error?: string };

const FAILURE_DELAY_MS = 1000;

/** 시도 제한 기록(DB)이 실패해도 로그인 자체는 막지 않는다(실패 응답 지연은 그대로 둔다). */
async function bestEffort<T>(work: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await work();
  } catch (error) {
    console.warn(`로그인 시도 제한 기록 실패: ${error instanceof Error ? error.message : String(error)}`);
    return fallback;
  }
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const auth = readAuthConfig();
  if (!auth.ok) return { error: `대시보드 설정이 필요합니다: ${auth.missing.join(", ")}` };

  const ip = clientIp(await headers());
  const gate = await bestEffort(() => beginLoginAttempt(ip), { ok: true } as const);
  if (!gate.ok) {
    return { error: `로그인 실패가 많아 잠시 막았습니다. ${gate.retryAfterMinutes}분 뒤에 다시 시도하세요.` };
  }

  const password = String(formData.get("password") ?? "");
  if (!checkPassword(password, auth.config)) {
    // 비밀번호를 빠르게 여러 번 대입하지 못하게 실패 응답을 늦춘다.
    await new Promise((resolve) => setTimeout(resolve, FAILURE_DELAY_MS));
    return { error: "비밀번호가 맞지 않습니다." };
  }

  await bestEffort(() => clearLoginFailures(ip), undefined);
  (await cookies()).set(SESSION_COOKIE, createSessionToken(auth.config), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  redirect(safeNextPath(formData.get("next")));
}
