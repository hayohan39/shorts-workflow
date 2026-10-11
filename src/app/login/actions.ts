"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { safeNextPath } from "@/lib/auth";
import { checkPassword, createSessionToken, readAuthConfig, SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from "@/lib/session";

export type LoginState = { error?: string };

const FAILURE_DELAY_MS = 1000;

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const auth = readAuthConfig();
  if (!auth.ok) return { error: `대시보드 설정이 필요합니다: ${auth.missing.join(", ")}` };

  const password = String(formData.get("password") ?? "");
  if (!checkPassword(password, auth.config)) {
    // 비밀번호를 빠르게 여러 번 대입하지 못하게 실패 응답을 늦춘다.
    await new Promise((resolve) => setTimeout(resolve, FAILURE_DELAY_MS));
    return { error: "비밀번호가 맞지 않습니다." };
  }

  (await cookies()).set(SESSION_COOKIE, createSessionToken(auth.config), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  redirect(safeNextPath(formData.get("next")));
}
