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
