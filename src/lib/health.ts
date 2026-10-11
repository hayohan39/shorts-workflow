export type DatabaseStatus =
  | { state: "not-configured" }
  | { state: "ok"; latencyMs: number; migrations: number }
  | { state: "error"; message: string };

export type Health = {
  ok: boolean;
  database: DatabaseStatus;
  commit: string | null;
  environment: string;
};

/**
 * 시크릿이 섞일 수 있는 오류 메시지에서 연결 문자열과 API 키·토큰을 가린다.
 * 외부 API 가 오류 응답에 받은 키를 그대로 되돌려 주는 경우에 대비한다.
 */
export function redact(message: string): string {
  return message
    .replace(/postgres(?:ql)?:\/\/[^\s'"]+/gi, "postgres://***")
    .replace(/\bBearer\s+[^\s'",]+/gi, "Bearer ***")
    .replace(/\bcw_(?:live|test)_[\w-]+/g, "cw_***")
    .replace(/\bsk-ant-[\w-]+/g, "sk-ant-***")
    .replace(/\b(?:github_pat|gh[pousr])_\w+/g, "gh_***");
}

export function summarize(
  database: DatabaseStatus,
  env: Record<string, string | undefined> = process.env,
): Health {
  return {
    // DB 를 아직 연결하지 않은 것은 장애가 아니다. 연결했는데 실패한 것만 장애로 본다.
    ok: database.state !== "error",
    database,
    commit: env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    environment: env.VERCEL_ENV ?? "local",
  };
}
