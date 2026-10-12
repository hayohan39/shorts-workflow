// Anthropic Usage & Cost Admin API 의 cost_report(실제 청구 비용) 조회.
// SDK 에 없는 엔드포인트라 HTTP 로 직접 부른다.
//   GET /v1/organizations/cost_report?starting_at=…&bucket_width=1d&group_by[]=description&limit=31
// 금액은 "가장 작은 통화 단위(센트)의 십진 문자열" 이다: "123.45" = $1.2345.
// 하루(UTC) 단위로만 나오고, 요청 후 보통 5분 안에 반영된다.
// Admin API 키(sk-ant-admin01-…)가 필요하다. 개인 계정에서는 발급할 수 없다(조직 필요).

const ENDPOINT = "https://api.anthropic.com/v1/organizations/cost_report";
const MAX_PAGES = 10;

export interface CostItem {
  amount: string;
  currency: string;
  cost_type: string | null;
  description: string | null;
  model: string | null;
  workspace_id: string | null;
}

export interface CostBucket {
  starting_at: string;
  ending_at: string;
  results: CostItem[];
}

export interface DailyCost {
  /** UTC 날짜 YYYY-MM-DD */
  day: string;
  usd: number;
  breakdown: { model: string | null; costType: string; usd: number }[];
}

export function readAdminKey(env: Record<string, string | undefined> = process.env): string | null {
  return env.ANTHROPIC_ADMIN_KEY?.trim() || null;
}

export class CostApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CostApiError";
  }
}

/** starting_at 부터 지금까지의 일별 비용 버킷(페이지를 끝까지 넘긴다). */
export async function fetchCostReport(options: {
  key: string;
  startingAt: Date;
  fetchFn?: typeof fetch;
}): Promise<CostBucket[]> {
  const fetchFn = options.fetchFn ?? fetch;
  const buckets: CostBucket[] = [];
  let page: string | null = null;
  for (let i = 0; i < MAX_PAGES; i++) {
    const params = new URLSearchParams({
      starting_at: options.startingAt.toISOString(),
      bucket_width: "1d",
      limit: "31",
    });
    params.append("group_by[]", "description");
    params.append("group_by[]", "workspace_id");
    if (page) params.set("page", page);
    const response = await fetchFn(`${ENDPOINT}?${params}`, {
      headers: {
        "x-api-key": options.key,
        "anthropic-version": "2023-06-01",
        "user-agent": "shorts-workflow (cost report)",
      },
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new CostApiError(costErrorMessage(response.status, body));
    }
    const json = (await response.json()) as { data?: CostBucket[]; has_more?: boolean; next_page?: string | null };
    buckets.push(...(json.data ?? []));
    if (!json.has_more || !json.next_page) return buckets;
    page = json.next_page;
  }
  return buckets;
}

function costErrorMessage(status: number, body: string): string {
  const detail = body.slice(0, 300);
  if (status === 401 || status === 403) {
    return `Cost API 권한 없음(${status}). Admin API 키(sk-ant-admin01-…)인지, 조직 계정인지 확인하세요. ${detail}`;
  }
  return `Cost API 오류(${status}). ${detail}`;
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/**
 * 버킷을 UTC 날짜별 합계로 바꾼다. workspaceId 를 주면 그 워크스페이스의 비용만 센다
 * ("default" 는 기본 워크스페이스 = workspace_id null).
 */
export function summarizeCosts(buckets: CostBucket[], workspaceId?: string | null): DailyCost[] {
  return buckets.map((bucket) => {
    const parts = new Map<string, { model: string | null; costType: string; usd: number }>();
    let total = 0;
    for (const item of bucket.results) {
      if (item.currency && item.currency !== "USD") continue;
      if (workspaceId) {
        const target = workspaceId === "default" ? null : workspaceId;
        if (item.workspace_id !== target) continue;
      }
      const usd = Number(item.amount) / 100;
      if (!Number.isFinite(usd)) continue;
      total += usd;
      const costType = item.cost_type ?? "other";
      const key = `${item.model ?? ""}|${costType}`;
      const part = parts.get(key) ?? { model: item.model, costType, usd: 0 };
      part.usd += usd;
      parts.set(key, part);
    }
    return {
      day: bucket.starting_at.slice(0, 10),
      usd: round4(total),
      breakdown: [...parts.values()].map((part) => ({ ...part, usd: round4(part.usd) })).sort((a, b) => b.usd - a.usd),
    };
  });
}
