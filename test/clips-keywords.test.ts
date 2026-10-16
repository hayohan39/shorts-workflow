import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { expandKeywords, KEYWORD_MODEL, normalizeKeywords, type CreateMessage } from "@/pipeline/clips/keywords";

function message(text: string, stop_reason: Anthropic.StopReason = "end_turn"): Anthropic.Message {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: KEYWORD_MODEL,
    content: [{ type: "text", text, citations: null }],
    stop_reason,
    stop_sequence: null,
    usage: { input_tokens: 200, output_tokens: 40 },
  } as Anthropic.Message;
}

describe("주제 → 영어 키워드", () => {
  it("구조화 출력으로 요청하고 키워드·비용을 돌려준다", async () => {
    const send = vi.fn<CreateMessage>(async () => message('{"keywords":["Salmon swimming","DNA strands","skincare"]}'));
    const result = await expandKeywords("연어 DNA 화장품", send);
    expect(result.keywords).toEqual(["salmon swimming", "dna strands", "skincare"]);
    expect(result.costUsd).toBeCloseTo((200 * 0.1 + 40 * 0.5) / 1_000_000);
    const params = send.mock.calls[0][0];
    expect(params.model).toBe(KEYWORD_MODEL);
    expect(params.output_config?.format?.type).toBe("json_schema");
    expect(params.messages[0].content).toContain("연어 DNA 화장품");
  });

  it("빈 응답·거절은 에러", async () => {
    await expect(expandKeywords("주제", async () => message('{"keywords":[]}'))).rejects.toThrow("키워드를 받지 못했습니다");
    await expect(expandKeywords("주제", async () => message("not json"))).rejects.toThrow("키워드를 받지 못했습니다");
    await expect(expandKeywords("주제", async () => message("", "refusal"))).rejects.toThrow("거절");
  });

  it("공백 정리·중복 제거·최대 5개", () => {
    expect(normalizeKeywords([" Ocean  Waves ", "ocean waves", "", 3, "a", "b", "c", "d", "e"])).toEqual([
      "ocean waves",
      "a",
      "b",
      "c",
      "d",
    ]);
    expect(normalizeKeywords("ocean")).toEqual([]);
  });
});
