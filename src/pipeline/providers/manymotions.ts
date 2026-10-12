import { McpClient } from "@/pipeline/providers/mcp";

// ManyMotions API (docs/plan.md 5장). 인증: Authorization: Bearer cw_live_…
// 모델 호출은 이 파일과 providers/ 아래에만 둔다. 공급자를 바꿀 때 여기만 바꾼다.
export const MANYMOTIONS_MCP_URL = "https://manymotions.com/api/mcp";

export function readManyMotionsKey(env: Record<string, string | undefined> = process.env): string {
  const key = env.MANYMOTIONS_API_KEY;
  if (!key) {
    throw new Error("MANYMOTIONS_API_KEY 가 없습니다. GitHub → Settings → Secrets → Actions 에 등록하세요.");
  }
  return key;
}

export function createManyMotionsClient(apiKey: string, fetchImpl: typeof fetch = fetch): McpClient {
  return new McpClient(MANYMOTIONS_MCP_URL, { Authorization: `Bearer ${apiKey}` }, fetchImpl);
}

export const MANYMOTIONS_ACCOUNT_URL = "https://manymotions.com/api/v1/account";

/**
 * GET /api/v1/account — 키 주인의 크레딧 잔액(읽기 전용, 과금 없음). 문서(docs/api/endpoints) 기준 응답:
 *   { "credits_remaining": 1234, "credits_used_this_period": 766, "credits_total_this_period": 2000,
 *     "api_key": { "id": 7, "scopes": [...] } }
 * credits_remaining 은 생성 API 가 차감 후 돌려주는 값과 같다. 잔액 기록이 없는 사용자는 셋 다 0.
 */
export async function fetchManyMotionsAccount(apiKey: string, fetchImpl: typeof fetch = fetch): Promise<unknown> {
  const response = await fetchImpl(MANYMOTIONS_ACCOUNT_URL, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`ManyMotions 계정 조회 실패(${response.status}). ${body.slice(0, 300)}`);
  }
  return response.json();
}

/** 응답의 숫자 필드만 {"a.b": 값} 으로 펼친다(문자열은 개인정보일 수 있어 버린다). */
export function numericFields(value: unknown, prefix = "", out: Record<string, number> = {}): Record<string, number> {
  if (typeof value === "number" && Number.isFinite(value)) {
    out[prefix || "(값)"] = value;
  } else if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) numericFields(child, prefix ? `${prefix}.${key}` : key, out);
  }
  return out;
}

// 잔여 크레딧으로 볼 필드. 앞 패턴일수록 우선. 사용량·한도처럼 보이는 필드는 뺀다.
const REMAINING = [/(remain|available|balance)/i, /credits?$/i];
// 요청 수 제한(rate limit) 같은 "remaining" 도 빼기 위해 request/rate 도 넣는다.
const NOT_REMAINING = /(used|consum|spent|limit|total|monthly|refund|cost|price|reserved|pending|request|rate|second|minute|hour|day)/i;

/** 문서에 적힌 잔여 크레딧 필드. 응답 형태가 바뀌면 아래 이름 규칙으로 찾는다. */
export const DOCUMENTED_REMAINING_FIELD = "credits_remaining";

/** 숫자 필드 중 잔여 크레딧을 고른다. 못 찾으면 null. */
export function pickRemainingCredits(fields: Record<string, number>): { field: string; credits: number } | null {
  if (DOCUMENTED_REMAINING_FIELD in fields) {
    return { field: DOCUMENTED_REMAINING_FIELD, credits: fields[DOCUMENTED_REMAINING_FIELD] };
  }
  const paths = Object.keys(fields).filter(
    (path) => /credit|balance|remain|available/i.test(path) && !NOT_REMAINING.test(path),
  );
  for (const pattern of REMAINING) {
    const field = paths.find((path) => pattern.test(path.split(".").pop() ?? path));
    if (field) return { field, credits: fields[field] };
  }
  return null;
}
