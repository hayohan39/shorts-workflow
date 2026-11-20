import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { generateScript, ScriptGenerationError, type SendMessage } from "@/pipeline/script/generate";
import { modelProfile } from "@/pipeline/script/model";
import { lengthRules, type ScriptSubmission } from "@/pipeline/script/schema";
import { validSubmission } from "./helpers/script";

type Message = Anthropic.Beta.Messages.BetaMessage;
type Params = Parameters<SendMessage>[0];

const usage = { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, server_tool_use: { web_search_requests: 2, web_fetch_requests: 1 } };

function message(stop_reason: string, content: unknown[], extra: object = {}): Message {
  return { id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason, content, usage, ...extra } as unknown as Message;
}
const submit = (input: ScriptSubmission, id = "tu_1") => message("tool_use", [{ type: "tool_use", id, name: "submit_script", input }]);
const text = (stop: string, t = "조사 중") => message(stop, [{ type: "text", text: t }]);

function fake(responses: Message[]) {
  const calls: Params[] = [];
  const send: SendMessage = async (params) => {
    calls.push(structuredClone(params));
    const next = responses.shift();
    if (!next) throw new Error("예상하지 못한 호출");
    return next;
  };
  return { send, calls };
}

const input = { topic: "PDRN", rules: lengthRules(35), outline: "소개 → 효과", reviewerNote: null, previousNarration: null, recentEpisodes: [] };

describe("대본 생성 (가짜 API)", () => {
  it("웹 검색 도구·strict 제출 도구·effort high·서버 대체 모델로 요청하고, 제출을 받으면 끝낸다", async () => {
    const { send, calls } = fake([submit(validSubmission())]);
    const result = await generateScript(input, { model: "claude-opus-5-5", send });

    expect(result.draft.title).toBe("연어 DNA 화장품, 진짜 효과 있을까?");
    expect(result.usage).toMatchObject({ inputTokens: 100, outputTokens: 50, webSearches: 2, webFetches: 1, rounds: 1 });
    const params = calls[0];
    expect(params.model).toBe("claude-opus-5-5");
    expect(params.output_config).toEqual({ effort: "high" });
    expect(params.fallbacks).toBe("default");
    expect(params.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(params.tool_choice).toBeUndefined();
    expect(params.tools?.map((t) => ("type" in t && t.type ? t.type : t.name))).toEqual([
      "web_search_20260209",
      "web_fetch_20260209",
      "submit_script",
    ]);
    expect(params.tools?.[2]).toMatchObject({ strict: true });
    expect(String(params.messages[0].content)).toContain("주제: PDRN");
  });

  it("응답마다 비용을 더하고 진행 메모에 보여 준다", async () => {
    const haiku = { model: "claude-haiku-5-5" };
    const { send } = fake([message("pause_turn", [{ type: "text", text: "조사" }], haiku), message("tool_use", [{ type: "tool_use", id: "t", name: "submit_script", input: validSubmission() }], haiku)]);
    const notes: string[] = [];
    const result = await generateScript(input, { model: "claude-haiku-5-5", send, onProgress: async (n) => void notes.push(n) });
    // 응답 1회: 입력 100·출력 50 토큰(무시할 만큼 작음) + 웹 검색 2회 $0.02
    expect(result.usage.costUsd).toBeCloseTo(2 * (0.02 + (100 * 0.1 + 50 * 0.5) / 1_000_000));
    expect(notes[0]).toBe("자료 조사 중 · 웹 검색 2회 · 페이지 1개 · 비용 약 $0.020");
  });

  it("실패해도 그때까지 쓴 사용량을 오류에 붙인다", async () => {
    const { send } = fake([text("end_turn"), text("end_turn")]);
    const error = await generateScript(input, { model: "claude-opus-5-5", send }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ScriptGenerationError);
    expect((error as ScriptGenerationError).usage).toMatchObject({ rounds: 2, webSearches: 4 });

    const broken: SendMessage = async () => {
      throw new Error("연결 끊김");
    };
    // 응답을 하나도 못 받았으면 비용이 없으니 원래 오류 그대로.
    await expect(generateScript(input, { model: "claude-opus-5-5", send: broken })).rejects.toThrow("연결 끊김");
  });

  it("Haiku 5.5 는 기본형 웹 도구로, 서버 대체 모델 없이 요청한다", async () => {
    const { send, calls } = fake([submit(validSubmission())]);
    await generateScript(input, { model: "claude-haiku-5-5", send });
    const params = calls[0];
    expect(params.output_config).toEqual({ effort: "high" });
    expect(params.fallbacks).toBeUndefined();
    expect(params.betas).toBeUndefined();
    expect(params.tools?.map((t) => ("type" in t && t.type ? t.type : t.name))).toEqual([
      "web_search_20250305",
      "web_fetch_20250910",
      "submit_script",
    ]);
  });

  it("모델별 옵션: effort 를 못 받는 옛 모델은 빼고, Sonnet 5.5 는 대체 모델을 쓴다", () => {
    expect(modelProfile("claude-haiku-4-5")).toMatchObject({ effort: false, fallbacks: false });
    expect(modelProfile("claude-sonnet-5-5")).toEqual({
      webSearch: "web_search_20260209",
      webFetch: "web_fetch_20260209",
      effort: true,
      fallbacks: true,
    });
    expect(modelProfile("claude-opus-5")).toMatchObject({ fallbacks: true });
    expect(modelProfile("claude-opus-4-8")).toMatchObject({ webSearch: "web_search_20260209", fallbacks: false });
  });

  it("pause_turn 이면 같은 대화를 그대로 이어서 보내고 진행 메모를 남긴다", async () => {
    const { send, calls } = fake([text("pause_turn"), submit(validSubmission())]);
    const notes: string[] = [];
    await generateScript(input, { model: "m", send, onProgress: async (note) => void notes.push(note) });
    expect(calls).toHaveLength(2);
    expect(calls[1].messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    // 비용은 응답에 적힌 모델(가짜 응답은 Opus 5.5) 단가로 계산한다(서버 대체 모델로 바뀌어도 맞게).
    expect(notes).toEqual(["자료 조사 중 · 웹 검색 2회 · 페이지 1개 · 비용 약 $0.021"]);
  });

  it("제출 없이 끝나면 한 번 요청하고, 그래도 없으면 실패", async () => {
    const ok = fake([text("end_turn"), submit(validSubmission())]);
    await generateScript(input, { model: "m", send: ok.send });
    expect(String(ok.calls[1].messages.at(-1)?.content)).toContain("submit_script");

    const never = fake([text("end_turn"), text("end_turn")]);
    await expect(generateScript(input, { model: "m", send: never.send })).rejects.toThrow("제출하지 않고");
  });

  it("형식 오류는 tool_result(is_error)로 돌려보내 고치게 한다", async () => {
    const broken = validSubmission({ scenes: validSubmission().scenes.slice(0, 3) });
    const { send, calls } = fake([submit(broken, "tu_bad"), submit(validSubmission(), "tu_ok")]);
    const result = await generateScript(input, { model: "m", send });
    expect(result.draft.scenes).toHaveLength(4);
    const feedback = calls[1].messages.at(-1)?.content as Anthropic.Beta.Messages.BetaToolResultBlockParam[];
    expect(feedback[0]).toMatchObject({ type: "tool_result", tool_use_id: "tu_bad", is_error: true });
    expect(String(feedback[0].content)).toContain("정확히 4개");
  });

  it("길이만 벗어나면 한 번 고쳐 보게 하고, 그래도 벗어나면 경고로 남겨 받아들인다", async () => {
    const short = validSubmission();
    short.scenes[3].narration = "확인하세요.";
    const { send, calls } = fake([submit(short), submit(short)]);
    const result = await generateScript(input, { model: "m", send });
    expect(calls).toHaveLength(2);
    expect(result.warnings.map((w) => w.field)).toContain("narration");
  });

  it("고쳐도 형식 오류가 남으면 실패", async () => {
    const broken = validSubmission({ scenes: [] });
    const { send } = fake([submit(broken), submit(broken), submit(broken)]);
    await expect(generateScript(input, { model: "m", send })).rejects.toThrow(ScriptGenerationError);
  });

  it("거절되면 분류와 함께 실패", async () => {
    const { send } = fake([message("refusal", [], { stop_details: { type: "refusal", category: "bio", explanation: null } })]);
    await expect(generateScript(input, { model: "m", send })).rejects.toThrow("거절되었습니다(bio)");
  });

  it("금지 표현은 경고로 함께 돌려준다", async () => {
    const risky = validSubmission();
    risky.scenes[2].narration = "피부 재생 효과가 확실하게 효과가 좋아서 상처 치료에도 쓰였고 완치율이 37%로 대조군 19%보다 높았습니다.";
    const { send } = fake([submit(risky), submit(risky)]);
    const result = await generateScript(input, { model: "m", send });
    expect(result.warnings.some((w) => w.message.includes("피부 재생"))).toBe(true);
  });
});
