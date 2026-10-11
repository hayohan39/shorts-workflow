import Anthropic from "@anthropic-ai/sdk";
import { checkGuardrails } from "@/pipeline/script/guardrails";
import { modelProfile } from "@/pipeline/script/model";
import { buildUserPrompt, SYSTEM_PROMPT, type PromptInput } from "@/pipeline/script/prompt";
import {
  countChars,
  RULES,
  SUBMISSION_SCHEMA,
  toDraft,
  validateScript,
  type Problem,
  type ScriptDraft,
  type ScriptSubmission,
} from "@/pipeline/script/schema";

// Claude API 로 대본을 만든다: 웹 검색·웹 페이지 읽기(서버 도구)로 근거를 찾고,
// submit_script(직접 정의한 도구, strict 스키마)로 제출받는다.
//   - 이 모델은 도구 호출을 강제할 수 없어서(tool_choice any/tool 불가) 프롬프트로 요청하고,
//     제출하지 않고 끝나면 한 번 더 요청한다.
//   - 형식 오류는 tool_result(is_error)로 돌려보내 고치게 한다.
//   - 서버 도구 반복 한도로 멈추면(pause_turn) 그대로 이어서 보낸다.
//   - 안전 분류기가 거절하면 서버 측 대체 모델로 다시 시도한다(fallbacks: "default", 지원하는 모델만).
//   - 모델마다 되는 도구 버전·옵션이 달라 modelProfile 로 맞춘다(기본 Haiku 5.5 는 기본형 웹 도구, 대체 모델 없음).

const TOOL_NAME = "submit_script";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const MAX_ROUNDS = 10;
const MAX_CORRECTIONS = 2;

type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Message = Anthropic.Beta.Messages.BetaMessage;
export type SendMessage = (params: Params) => Promise<Message>;

/** 실제 API 호출. 응답이 길 수 있어 스트리밍으로 받고 완성된 메시지만 쓴다. */
export function createSender(client: Anthropic = new Anthropic()): SendMessage {
  return (params) => client.beta.messages.stream(params).finalMessage();
}

export interface ScriptUsage {
  inputTokens: number;
  outputTokens: number;
  webSearches: number;
  webFetches: number;
  rounds: number;
}

export interface GeneratedScript {
  draft: ScriptDraft;
  warnings: Problem[];
  model: string;
  usage: ScriptUsage;
}

const SUBMIT_TOOL: Anthropic.Beta.Messages.BetaTool = {
  name: TOOL_NAME,
  description: "조사를 마친 뒤 완성된 쇼츠 대본을 제출한다. 반드시 이 도구로 제출해야 작업이 끝난다.",
  strict: true,
  // eager_input_streaming 은 켜지 않는다: 켜면 서버가 입력을 검증하지 않는데, 입력이 작아서
  // 스트리밍 이득보다 strict 스키마 보장이 더 중요하다.
  input_schema: SUBMISSION_SCHEMA as unknown as Anthropic.Beta.Messages.BetaTool["input_schema"],
};

/** 모델에 맞는 요청 옵션(도구 버전·effort·대체 모델). */
export function requestOptions(model: string): Omit<Params, "messages"> {
  const profile = modelProfile(model);
  return {
    model,
    max_tokens: 64_000,
    system: SYSTEM_PROMPT,
    tools: [
      { type: profile.webSearch, name: "web_search", max_uses: 12 },
      { type: profile.webFetch, name: "web_fetch", max_uses: 8 },
      SUBMIT_TOOL,
    ],
    ...(profile.effort ? { output_config: { effort: "high" as const } } : {}),
    ...(profile.fallbacks ? { betas: [FALLBACK_BETA], fallbacks: "default" as const } : {}),
  };
}

export class ScriptGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScriptGenerationError";
  }
}

export async function generateScript(
  input: PromptInput,
  options: { model: string; send: SendMessage; onProgress?: (text: string) => Promise<void> },
): Promise<GeneratedScript> {
  const progress = options.onProgress ?? (async () => {});
  const base = requestOptions(options.model);
  const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [{ role: "user", content: buildUserPrompt(input) }];
  const usage: ScriptUsage = { inputTokens: 0, outputTokens: 0, webSearches: 0, webFetches: 0, rounds: 0 };
  let corrections = 0;
  let reminded = false;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const response = await options.send({ ...base, messages });
    usage.rounds++;
    usage.inputTokens += response.usage.input_tokens + (response.usage.cache_read_input_tokens ?? 0);
    usage.outputTokens += response.usage.output_tokens;
    usage.webSearches += response.usage.server_tool_use?.web_search_requests ?? 0;
    usage.webFetches += response.usage.server_tool_use?.web_fetch_requests ?? 0;

    if (response.stop_reason === "refusal") {
      const category = response.stop_details?.category ?? "분류 없음";
      throw new ScriptGenerationError(`대본 생성이 거절되었습니다(${category}). 주제·목차 표현을 바꿔 다시 시도하세요.`);
    }
    if (response.stop_reason === "max_tokens") {
      throw new ScriptGenerationError("응답이 길이 한도에 걸려 대본이 완성되지 않았습니다.");
    }
    messages.push({ role: "assistant", content: response.content });
    const research = `웹 검색 ${usage.webSearches}회 · 페이지 ${usage.webFetches}개`;
    if (response.stop_reason === "pause_turn") {
      await progress(`자료 조사 중 · ${research}`);
      continue;
    }

    const call = response.content.find(
      (block): block is Anthropic.Beta.Messages.BetaToolUseBlock => block.type === "tool_use" && block.name === TOOL_NAME,
    );
    if (!call) {
      if (reminded) throw new ScriptGenerationError("Claude 가 대본을 제출하지 않고 끝냈습니다.");
      reminded = true;
      await progress(`대본 제출을 다시 요청하는 중 · ${research}`);
      messages.push({ role: "user", content: "조사한 내용을 바탕으로 submit_script 도구로 대본을 제출하라." });
      continue;
    }

    const draft = toDraft(call.input as ScriptSubmission);
    const { errors, warnings } = validateScript(draft);
    // 길이는 경고 대상이지만, 첫 제출에서 벗어났으면 한 번은 고쳐 보게 한다(20초 타이밍에 중요).
    const length = countChars(draft.narration);
    const lengthOff = length < RULES.narrationMin || length > RULES.narrationMax;
    const fixes = [...errors, ...(lengthOff && corrections === 0 ? [{ field: "narration", message: `내레이션이 공백 제외 ${length}자다. ${RULES.narrationMin}~${RULES.narrationMax}자로 맞춘다.` }] : [])];

    if (fixes.length && corrections < MAX_CORRECTIONS) {
      corrections++;
      await progress(`대본 형식 고치는 중 (${corrections}/${MAX_CORRECTIONS}) · ${research}`);
      messages.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: call.id,
            is_error: true,
            content: `다음을 고쳐 submit_script 로 다시 제출하라:\n${fixes.map((p) => `- ${p.message}`).join("\n")}`,
          },
        ],
      });
      continue;
    }
    if (errors.length) {
      throw new ScriptGenerationError(`대본 형식 오류: ${errors.map((p) => p.message).join(" / ")}`);
    }
    return { draft, warnings: [...warnings, ...checkGuardrails(draft)], model: response.model, usage };
  }
  throw new ScriptGenerationError(`대본 생성이 ${MAX_ROUNDS}번 안에 끝나지 않았습니다.`);
}
