import { NextResponse, type NextRequest } from "next/server";
import { readAuthConfig, SESSION_COOKIE, verifySessionToken } from "@/lib/session";

// 로그인하지 않은 요청은 로그인 화면으로 보낸다(API 는 401).
// 1차 방어선이다. 페이지와 서버 액션도 각자 requireSession() 으로 다시 확인한다.
const PUBLIC_PATHS = new Set(["/login", "/api/health"]);

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  const auth = readAuthConfig();
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (auth.ok && verifySessionToken(token, auth.config)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  const login = new URL("/login", request.url);
  if (pathname !== "/") login.searchParams.set("next", pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  // 아이콘·매니페스트는 로그인 화면과 홈 화면 추가에서도 보여야 해서 로그인 없이 연다.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|manifest.webmanifest|icons/).*)"],
};
