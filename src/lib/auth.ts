import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { readAuthConfig, SESSION_COOKIE, verifySessionToken } from "@/lib/session";

/** 지금 요청이 로그인된 상태인가. 한 번의 렌더에서 여러 번 불러도 한 번만 계산한다. */
export const isLoggedIn = cache(async (): Promise<boolean> => {
  // cookies() 를 먼저 읽는다: 이 함수를 쓰는 화면이 빌드 때 정적으로 굳지 않고 요청마다 판단되게.
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const auth = readAuthConfig();
  return auth.ok && verifySessionToken(token, auth.config);
});

/** 페이지·서버 액션의 첫 줄에서 부른다. 로그인 안 됐으면 로그인 화면으로. */
export async function requireSession(): Promise<void> {
  if (!(await isLoggedIn())) redirect("/login");
}

/** 로그인 후 돌아갈 경로. 다른 사이트로 보내는 값(//evil.com 등)은 버린다. */
export function safeNextPath(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return "/";
  }
  return value;
}
