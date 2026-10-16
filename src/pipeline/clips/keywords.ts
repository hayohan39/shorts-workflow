import type Anthropic from "@anthropic-ai/sdk";
import { roundCost } from "@/pipeline/script/pricing";

// 한국어 주제 → 스톡 영상 검색용 영어 키워드 3~5개. 소스 API 는 영어 검색이 결과가 훨씬 많다.
// 대본 기본 모델(Haiku 5.5)로 한 번 호출한다. 구조화 출력(output_config.format)으로 JSON 만 받는다.
// 1회 비용은 입력·출력 합쳐 수백 토큰이라 $0.001 미만이다.

export const KEYWORD_MODEL = "claude-haiku-5-5";
const MIN_KEYWORDS = 3;
const MAX_KEYWORDS = 5;

export type CreateMessage = (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>;

const SYSTEM = `You turn a Korean YouTube Shorts topic into English search keywords for free stock video libraries
(Pixabay, NASA, Wikimedia Commons, Internet Archive).
Return ${MIN_KEYWORDS}-${MAX_KEYWORDS} short keywords (1-3 words each) that describe footage a viewer would see:
concrete subjects, places and actions. Avoid brand names, people's names, text overlays and abstract words.
Order them from most to least relevant.`;

const SCHEMA = {
  type: "object",
  properties: { keywords: { type: "array", items: { type: "string" } } },
  required: ["keywords"],
  additionalProperties: false,
};

export interface KeywordResult {
  keywords: string[];
  model: string;
  costUsd: number | null;
}

export async function expandKeywords(topic: string, send: CreateMessage): Promise<KeywordResult> {
  const response = await send({
    model: KEYWORD_MODEL,
    max_tokens: 4_000,
    system: SYSTEM,
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    messages: [{ role: "user", content: `주제: ${topic}` }],
  });
  const costUsd = roundCost(response.model, response.usage);
  if (response.stop_reason === "refusal") {
    throw new Error("키워드 생성이 거절되었습니다. 주제 표현을 바꿔 다시 시도하세요.");
  }
  const text = response.content.find((block) => block.type === "text")?.text ?? "";
  const keywords = normalizeKeywords(parseKeywords(text));
  if (keywords.length === 0) {
    throw new Error(`키워드를 받지 못했습니다(응답: ${text.slice(0, 200) || "없음"}).`);
  }
  return { keywords, model: response.model, costUsd };
}

function parseKeywords(text: string): unknown {
  try {
    return (JSON.parse(text) as { keywords?: unknown }).keywords;
  } catch {
    return null;
  }
}

/** 공백 정리·소문자·중복 제거 후 최대 5개. */
export function normalizeKeywords(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const words = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.replace(/\s+/g, " ").trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(words)].slice(0, MAX_KEYWORDS);
}
