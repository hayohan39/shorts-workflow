import { query } from "@/lib/db";

// 로그인 시도 제한. 비밀번호 하나로 지키는 대시보드라 대입 공격을 늦춘다(저장소 공개 대비).
//   같은 IP 에서 15분에 5번 넘게 실패하면, 가장 오래된 실패가 15분을 지날 때까지 막는다.
//   막힌 동안의 시도는 기록하지 않는다(계속 두드려도 잠금이 연장되지 않게).
// 여러 IP 를 합친 전체 한도는 두지 않는다: 비밀번호를 몰라도 주인의 로그인을 막는 수단이 되기 때문이다.
// 대신 비밀번호를 길고 무작위하게 둔다(분산 대입으로도 뚫을 수 없게). 이미 로그인한 기기(30일 쿠키)는 영향이 없다.

export const LOGIN_LIMITS = { failures: 5, minutes: 15 } as const;

export type LoginGate = { ok: true } | { ok: false; retryAfterMinutes: number };

/** 요청한 쪽 IP. Vercel 은 x-real-ip·x-forwarded-for 를 직접 채운다(클라이언트가 바꿀 수 없음). */
export function clientIp(headers: Headers): string {
  return headers.get("x-real-ip") ?? headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

/**
 * 로그인 시도를 시작한다: 먼저 실패로 기록하고(비밀번호가 맞으면 clearLoginFailures 가 지운다) 그 다음 한도를 본다.
 * 기록을 먼저 해야 동시에 여러 요청을 보내 확인을 한꺼번에 통과하는 우회를 막을 수 있다.
 * 한도를 넘었으면 방금 기록을 지운다(막힌 동안의 시도가 잠금을 연장하지 않게).
 */
export async function beginLoginAttempt(ip: string): Promise<LoginGate> {
  const [attempt] = await query<{ id: string }>("insert into login_failures (ip) values ($1) returning id", [ip]);
  await query("delete from login_failures where failed_at < now() - interval '1 day'");
  const [recent] = await query<{ count: string }>(
    "select count(*) as count from login_failures where ip = $1 and failed_at > now() - make_interval(mins => $2)",
    [ip, LOGIN_LIMITS.minutes],
  );
  if (Number(recent.count) <= LOGIN_LIMITS.failures) return { ok: true };
  await query("delete from login_failures where id = $1", [attempt.id]);
  // 최근 실패 5번 중 가장 오래된 것이 기간 밖으로 나가면 다시 시도할 수 있다.
  const [fifth] = await query<{ failed_at: Date }>(
    `select failed_at from login_failures
      where ip = $1 and failed_at > now() - make_interval(mins => $2)
      order by failed_at desc offset $3 - 1 limit 1`,
    [ip, LOGIN_LIMITS.minutes, LOGIN_LIMITS.failures],
  );
  const until = (fifth?.failed_at ?? new Date()).getTime() + LOGIN_LIMITS.minutes * 60_000;
  return { ok: false, retryAfterMinutes: Math.max(1, Math.ceil((until - Date.now()) / 60_000)) };
}

/** 로그인 성공: 그 IP 의 실패 기록(방금 시도 포함)을 지운다. */
export async function clearLoginFailures(ip: string): Promise<void> {
  await query("delete from login_failures where ip = $1", [ip]);
}
