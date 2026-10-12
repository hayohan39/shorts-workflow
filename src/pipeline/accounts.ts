import { query } from "@/lib/db";
import { redact } from "@/lib/health";
import {
  fetchManyMotionsAccount,
  numericFields,
  pickRemainingCredits,
} from "@/pipeline/providers/manymotions";

// ManyMotions 잔여 크레딧. Actions 의 probe 가 모델 목록과 함께 조회해 저장한다(키는 GitHub Secrets 에만).

const PROVIDER = "manymotions";

export interface ProviderAccount {
  state: "ok" | "failed";
  credits: number | null;
  creditsField: string | null;
  fields: Record<string, number>;
  message: string | null;
  /** 마지막으로 잔액을 받은 시각(받은 적 없으면 null). */
  fetchedAt: Date | null;
  checkedAt: Date;
}

interface AccountRow {
  state: "ok" | "failed";
  credits: string | null;
  credits_field: string | null;
  fields: Record<string, number>;
  message: string | null;
  fetched_at: Date | null;
  checked_at: Date;
}

export async function getManyMotionsAccount(): Promise<ProviderAccount | null> {
  const [row] = await query<AccountRow>(
    "select state, credits, credits_field, fields, message, fetched_at, checked_at from provider_accounts where provider = $1",
    [PROVIDER],
  );
  if (!row) return null;
  return {
    state: row.state,
    credits: row.credits === null ? null : Number(row.credits),
    creditsField: row.credits_field,
    fields: row.fields,
    message: row.message,
    fetchedAt: row.fetched_at,
    checkedAt: row.checked_at,
  };
}

/**
 * 잔여 크레딧을 다시 조회해 저장한다. 실패해도 throw 하지 않는다(모델 목록 조회를 막지 않게).
 * 실패하면 이전에 받은 잔액은 그대로 두고 상태·사유만 바꾼다. 결과 한 줄 요약을 돌려준다.
 */
export async function refreshManyMotionsAccount(apiKey: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  try {
    const fields = numericFields(await fetchManyMotionsAccount(apiKey, fetchImpl));
    const picked = pickRemainingCredits(fields);
    await query(
      `insert into provider_accounts (provider, state, credits, credits_field, fields, message, fetched_at, checked_at)
       values ($1, 'ok', $2, $3, $4, $5, now(), now())
       on conflict (provider) do update set state = 'ok', credits = excluded.credits, credits_field = excluded.credits_field,
         fields = excluded.fields, message = excluded.message, fetched_at = now(), checked_at = now()`,
      [
        PROVIDER,
        picked?.credits ?? null,
        picked?.field ?? null,
        JSON.stringify(fields),
        picked ? null : "응답에서 잔여 크레딧 필드를 찾지 못했습니다.",
      ],
    );
    const names = Object.entries(fields).map(([path, value]) => `${path}=${value}`).join(", ") || "(숫자 필드 없음)";
    return picked
      ? `ManyMotions 잔여 크레딧 ${picked.credits.toLocaleString("ko-KR")} (${picked.field}) · 숫자 필드: ${names}`
      : `ManyMotions 잔여 크레딧 필드를 찾지 못함 · 숫자 필드: ${names}`;
  } catch (error) {
    const message = redact(error instanceof Error ? error.message : String(error)).slice(0, 500);
    await query(
      `insert into provider_accounts (provider, state, message, checked_at) values ($1, 'failed', $2, now())
       on conflict (provider) do update set state = 'failed', message = excluded.message, checked_at = now()`,
      [PROVIDER, message],
    );
    return `ManyMotions 잔여 크레딧 조회 실패: ${message}`;
  }
}
