import { describe, expect, it } from "vitest";
import { estimateCost, formatUsd, roundCost } from "@/pipeline/script/pricing";
import { scriptCost } from "@/pipeline/scripts";

describe("대본 생성 비용 계산", () => {
  it("모델 단가·캐시·웹 검색을 반영한다", () => {
    // Haiku 5.5: 입력 $0.10 · 출력 $0.50 per 1M, 웹 검색 1회 $0.01
    expect(roundCost("claude-haiku-5-5", { input_tokens: 20_000, output_tokens: 4_000, server_tool_use: { web_search_requests: 3 } })).toBeCloseTo(
      0.002 + 0.002 + 0.03,
    );
    // Opus 5.5: $4 / $20, 캐시 읽기 0.1배, 캐시 쓰기 1.25배
    expect(
      roundCost("claude-opus-5-5", {
        input_tokens: 1_000_000,
        output_tokens: 100_000,
        cache_read_input_tokens: 1_000_000,
        cache_creation_input_tokens: 1_000_000,
      }),
    ).toBeCloseTo(4 + 2 + 0.4 + 5);
    expect(roundCost("claude-sonnet-5-5", { input_tokens: 1_000_000, output_tokens: 0 })).toBeCloseTo(2);
    expect(roundCost("unknown-model", { input_tokens: 1, output_tokens: 1 })).toBeNull();
  });

  it("Haiku 5.5 는 프롬프트가 10만 토큰을 넘으면 높은 단가", () => {
    expect(roundCost("claude-haiku-5-5", { input_tokens: 200_000, output_tokens: 0 })).toBeCloseTo(0.1);
    expect(roundCost("claude-haiku-5-5", { input_tokens: 100_000, output_tokens: 0 })).toBeCloseTo(0.01);
  });

  it("기록이 없는 예전 대본은 토큰 수로 추정하고, 직접 수정본은 0", () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 0, webSearches: 2 };
    expect(estimateCost("claude-opus-5-5", usage)).toBeCloseTo(4.02);
    expect(scriptCost({ source: "generated", model: "claude-opus-5-5", usage })).toBeCloseTo(4.02);
    expect(scriptCost({ source: "generated", model: "claude-opus-5-5", usage: { ...usage, costUsd: 0.5 } })).toBe(0.5);
    expect(scriptCost({ source: "edited", model: null, usage: null })).toBe(0);
    expect(estimateCost(null, usage)).toBeNull();
  });

  it("금액 표시", () => {
    expect(formatUsd(0.0123)).toBe("$0.012");
    expect(formatUsd(1.234)).toBe("$1.23");
    expect(formatUsd(0.0004)).toBe("$0.001 미만");
    expect(formatUsd(0)).toBe("$0.000");
  });
});
