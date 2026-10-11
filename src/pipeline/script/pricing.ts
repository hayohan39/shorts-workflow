// Claude API 비용 계산(대략). 화면에 "약 $0.012" 로 보여 주기 위한 것이라 정산 금액과 조금 다를 수 있다.
// 단가: 1M 토큰당 USD (Anthropic 공개 가격, 2026-10 기준). 웹 검색은 1,000회당 $10, 웹 페이지 읽기는 토큰 외 추가 요금 없음.
// 캐시 읽기는 입력 단가의 0.1배, 캐시 쓰기(5분)는 1.25배.

interface Price {
  input: number;
  output: number;
  /** 프롬프트가 이 토큰 수를 넘으면 longInput/longOutput 단가(Haiku 5.5). */
  longAbove?: number;
  longInput?: number;
  longOutput?: number;
}

// 앞에서부터 맞는 첫 항목을 쓴다(구체적인 ID 를 위에).
const PRICES: [RegExp, Price][] = [
  [/^claude-haiku-5-5/, { input: 0.1, output: 0.5, longAbove: 100_000, longInput: 0.5, longOutput: 2.5 }],
  [/^claude-haiku-4-5/, { input: 1, output: 5 }],
  [/^claude-sonnet-5/, { input: 2, output: 10 }],
  [/^claude-sonnet-4/, { input: 3, output: 15 }],
  [/^claude-opus-5-5/, { input: 4, output: 20 }],
  [/^claude-opus-(5|4-[5-8])/, { input: 5, output: 25 }],
  [/^claude-(fable|mythos)-5/, { input: 10, output: 50 }],
];

export const WEB_SEARCH_USD = 0.01;

export interface RoundUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  server_tool_use?: { web_search_requests?: number | null } | null;
}

export function priceOf(model: string): Price | null {
  return PRICES.find(([pattern]) => pattern.test(model))?.[1] ?? null;
}

/** 응답 한 번의 비용(USD). 모르는 모델이면 null. */
export function roundCost(model: string, usage: RoundUsage): number | null {
  const price = priceOf(model);
  if (!price) return null;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const prompt = usage.input_tokens + cacheRead + cacheWrite;
  const long = price.longAbove !== undefined && prompt > price.longAbove;
  const input = long ? (price.longInput ?? price.input) : price.input;
  const output = long ? (price.longOutput ?? price.output) : price.output;
  const tokens =
    (usage.input_tokens * input + cacheRead * input * 0.1 + cacheWrite * input * 1.25 + usage.output_tokens * output) /
    1_000_000;
  return tokens + (usage.server_tool_use?.web_search_requests ?? 0) * WEB_SEARCH_USD;
}

/** 저장된 사용량 요약으로 비용을 추정한다(비용이 기록되지 않은 예전 대본용). */
export function estimateCost(
  model: string | null,
  usage: { inputTokens?: number; outputTokens?: number; webSearches?: number } | null,
): number | null {
  if (!model || !usage) return null;
  return roundCost(model, {
    input_tokens: usage.inputTokens ?? 0,
    output_tokens: usage.outputTokens ?? 0,
    server_tool_use: { web_search_requests: usage.webSearches ?? 0 },
  });
}

/** "$0.012" / "$1.24". 1센트 미만은 소수 셋째 자리까지. */
export function formatUsd(usd: number): string {
  if (usd > 0 && usd < 0.001) return "$0.001 미만";
  return `$${usd < 1 ? usd.toFixed(3) : usd.toFixed(2)}`;
}
