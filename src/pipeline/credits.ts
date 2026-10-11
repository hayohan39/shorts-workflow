import { query } from "@/lib/db";

export interface MonthlyCredits {
  used: number;
  limit: number;
}

/** 이번 달(한국 시간) 사용한 ManyMotions 크레딧과 월 한도. */
export async function monthlyCredits(): Promise<MonthlyCredits> {
  const [row] = await query<{ used: number; credit_limit: number }>(
    `select
       (select coalesce(sum(credits), 0)::int from assets
         where created_at >= date_trunc('month', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul') as used,
       (select monthly_credit_limit from settings) as credit_limit`,
  );
  return { used: row?.used ?? 0, limit: row?.credit_limit ?? 0 };
}
