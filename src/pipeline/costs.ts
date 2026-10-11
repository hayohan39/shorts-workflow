import { query } from "@/lib/db";
import { redact } from "@/lib/health";
import {
  fetchCostReport,
  readAdminKey,
  summarizeCosts,
  type DailyCost,
} from "@/pipeline/providers/anthropic-costs";

// 실제 청구 비용(Anthropic Cost API)을 DB 에 저장하고 화면용으로 묶는다.
// 조회는 Actions 의 probe 단계가 한다(매일 + 설정 화면 갱신 때). Admin 키는 GitHub Secrets 에만 둔다.

const PROVIDER = "anthropic";
/** 한 번에 가져오는 기간. 이번 달 합계를 위해 지난달 말일까지 덮는다. */
const LOOKBACK_DAYS = 35;

export type CostState = "ok" | "skipped" | "failed";

export interface CostStatus {
  state: CostState;
  message: string | null;
  updatedAt: Date;
}

export interface CostDay {
  day: string;
  usd: number;
  breakdown: DailyCost["breakdown"];
  fetchedAt: Date;
}

/** UTC 기준 이번 달 1일 00:00. Cost API 가 UTC 날짜로만 나눠 주므로 달도 UTC 로 센다. */
export function utcMonthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export async function saveDailyCosts(days: DailyCost[]): Promise<void> {
  for (const day of days) {
    await query(
      `insert into api_costs (provider, day, amount_usd, breakdown, fetched_at)
       values ($1, $2, $3, $4, now())
       on conflict (provider, day) do update
         set amount_usd = excluded.amount_usd, breakdown = excluded.breakdown, fetched_at = now()`,
      [PROVIDER, day.day, day.usd, JSON.stringify(day.breakdown)],
    );
  }
}

export async function setCostStatus(state: CostState, message: string | null): Promise<void> {
  await query(
    `insert into api_cost_status (provider, state, message, updated_at) values ($1, $2, $3, now())
     on conflict (provider) do update set state = excluded.state, message = excluded.message, updated_at = now()`,
    [PROVIDER, state, message === null ? null : redact(message).slice(0, 500)],
  );
}

export async function getCostStatus(): Promise<CostStatus | null> {
  const [row] = await query<{ state: CostState; message: string | null; updated_at: Date }>(
    "select state, message, updated_at from api_cost_status where provider = $1",
    [PROVIDER],
  );
  return row ? { state: row.state, message: row.message, updatedAt: row.updated_at } : null;
}

/** 최근 며칠의 일별 실제 비용(최신순). */
export async function recentCosts(limit = 7): Promise<CostDay[]> {
  const rows = await query<{ day: string; amount_usd: string; breakdown: DailyCost["breakdown"]; fetched_at: Date }>(
    `select to_char(day, 'YYYY-MM-DD') as day, amount_usd, breakdown, fetched_at
       from api_costs where provider = $1 order by day desc limit $2`,
    [PROVIDER, limit],
  );
  return rows.map((row) => ({ day: row.day, usd: Number(row.amount_usd), breakdown: row.breakdown, fetchedAt: row.fetched_at }));
}

/** 이번 달(UTC) 실제 비용 합계와 마지막 조회 시각. 조회한 적이 없으면 null. */
export async function monthlyActualCost(now = new Date()): Promise<{ usd: number; fetchedAt: Date } | null> {
  const [row] = await query<{ usd: string; fetched_at: Date | null }>(
    `select coalesce(sum(amount_usd) filter (where day >= $2::date), 0) as usd, max(fetched_at) as fetched_at
       from api_costs where provider = $1`,
    [PROVIDER, utcMonthStart(now).toISOString().slice(0, 10)],
  );
  return row?.fetched_at ? { usd: Number(row.usd), fetchedAt: row.fetched_at } : null;
}

/**
 * 실제 비용을 다시 가져와 저장한다. 실패해도 throw 하지 않고 상태로 남긴다
 * (모델 목록 조회 같은 다른 작업을 막지 않기 위해). 결과 한 줄 요약을 돌려준다.
 */
export async function refreshActualCosts(options: {
  env?: Record<string, string | undefined>;
  fetchFn?: typeof fetch;
  now?: Date;
} = {}): Promise<string> {
  const env = options.env ?? process.env;
  const key = readAdminKey(env);
  if (!key) {
    const message = "ANTHROPIC_ADMIN_KEY 가 없어 실제 비용을 가져오지 않았습니다.";
    await setCostStatus("skipped", message);
    return message;
  }
  try {
    const now = options.now ?? new Date();
    const since = new Date(Math.min(utcMonthStart(now).getTime(), now.getTime() - LOOKBACK_DAYS * 86_400_000));
    since.setUTCHours(0, 0, 0, 0);
    const buckets = await fetchCostReport({ key, startingAt: since, fetchFn: options.fetchFn });
    const days = summarizeCosts(buckets, env.ANTHROPIC_COST_WORKSPACE_ID?.trim() || null);
    await saveDailyCosts(days);
    const total = days.reduce((sum, day) => sum + day.usd, 0);
    await setCostStatus("ok", null);
    return `실제 비용 ${days.length}일치 저장 (합계 $${total.toFixed(2)})`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await setCostStatus("failed", message);
    return `실제 비용 조회 실패: ${redact(message)}`;
  }
}
