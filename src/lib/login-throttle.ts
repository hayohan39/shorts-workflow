import { query } from "@/lib/db";

// 로그인 시도 제한. 비밀번호 하나로 지키는 대시보드라 대입 공격을 늦춘다(저장소 공개 대비).
//   IP 당: 15분에 5번 실패하면 15분 동안 막는다
//   전체: 1시간에 100번 실패하면(여러 IP 로 나눠 시도) 1시간 동안 새 로그인을 막는다
// 이미 로그인한 기기(30일 쿠키)는 영향이 없다. 막혀 있는 동안의 시도도 실패로 센다.

export const LOGIN_LIMITS = {
  perIp: { failures: 5, minutes: 15 },
  total: { failures: 100, minutes: 60 },
} as const;

export type LoginGate = { ok: true } | { ok: false; retryAfterMinutes: number };

/** 요청한 쪽 IP. Vercel 은 x-real-ip·x-forwarded-for 를 직접 채운다(클라이언트가 바꿀 수 없음). */
export function clientIp(headers: Headers): string {
  return headers.get("x-real-ip") ?? headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

/** 기간 안의 기록이 limit 개를 넘으면, 그중 가장 오래된 것이 기간 밖으로 나갈 때까지 남은 분. 아니면 null. */
async function blockedMinutes(ip: string | null, limit: number, minutes: number): Promise<number | null> {
  const [row] = await query<{ count: string; oldest: Date | null }>(
    `select count(*) as count, min(failed_at) as oldest from (
       select failed_at from login_failures
        where ($1::text is null or ip = $1) and failed_at > now() - make_interval(mins => $2)
        order by failed_at desc limit $3) recent`,
    [ip, minutes, limit + 1],
  );
  if (Number(row.count) <= limit || !row.oldest) return null;
  const until = row.oldest.getTime() + minutes * 60_000;
  return Math.max(1, Math.ceil((until - Date.now()) / 60_000));
}

/**
 * 로그인 시도를 시작한다: 먼저 실패로 기록하고(비밀번호가 맞으면 clearLoginFailures 가 지운다) 그 다음 한도를 본다.
 * 기록을 먼저 해야 동시에 여러 요청을 보내 확인을 한꺼번에 통과하는 우회를 막을 수 있다.
 */
export async function beginLoginAttempt(ip: string): Promise<LoginGate> {
  await query("insert into login_failures (ip) values ($1)", [ip]);
  await query("delete from login_failures where failed_at < now() - interval '1 day'");
  const perIp = await blockedMinutes(ip, LOGIN_LIMITS.perIp.failures, LOGIN_LIMITS.perIp.minutes);
  const total = await blockedMinutes(null, LOGIN_LIMITS.total.failures, LOGIN_LIMITS.total.minutes);
  const wait = Math.max(perIp ?? 0, total ?? 0);
  return wait ? { ok: false, retryAfterMinutes: wait } : { ok: true };
}

/** 로그인 성공: 그 IP 의 실패 기록(방금 시도 포함)을 지운다. */
export async function clearLoginFailures(ip: string): Promise<void> {
  await query("delete from login_failures where ip = $1", [ip]);
}
