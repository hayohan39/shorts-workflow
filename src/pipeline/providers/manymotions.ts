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

/** GET /api/v1/account 응답 원문(형태는 문서 기준으로 아직 확정 전이라 그대로 받는다). */
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
const NOT_REMAINING = /(used|consum|spent|limit|total|monthly|refund|cost|price|reserved|pending)/i;

/** 숫자 필드 중 잔여 크레딧을 고른다. 못 찾으면 null. */
export function pickRemainingCredits(fields: Record<string, number>): { field: string; credits: number } | null {
  const paths = Object.keys(fields).filter((path) => /credit|balance/i.test(path) && !NOT_REMAINING.test(path));
  for (const pattern of REMAINING) {
    const field = paths.find((path) => pattern.test(path.split(".").pop() ?? path));
    if (field) return { field, credits: fields[field] };
  }
  return null;
}
