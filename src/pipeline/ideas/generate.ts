import type Anthropic from "@anthropic-ai/sdk";
import type { NewIdea } from "@/pipeline/ideas/store";
import { roundCost } from "@/pipeline/script/pricing";
import { modelProfile } from "@/pipeline/script/model";
import { TARGET_SECONDS } from "@/pipeline/script/schema";
import type { SendMessage } from "@/pipeline/script/generate";

// 채널 추천: 카테고리마다 쇼츠 거리 하나씩 기획안(제목·훅·목차·길이)을 받는다.
// 근거 조사와 대본은 사람이 고른 기획안에만 한다(script 단계). 여기서는 주제가 사실인지 가볍게만 확인한다.
//   - 고정 지시(시스템 프롬프트) + 화면에서 고친 채널·카테고리 프롬프트(사용자 메시지)
//   - submit_ideas(strict 스키마)로 제출받고, 카테고리가 빠지거나 겹치면 한 번 고치게 한다.

const TOOL_NAME = "submit_ideas";
const MAX_ROUNDS = 6;
const MAX_SEARCHES = 5;

export const IDEAS_SYSTEM_PROMPT = `당신은 한국어 유튜브 쇼츠 채널의 기획자다. 사용자 메시지의 채널 설명과 카테고리별 요청에 맞춰 카테고리마다 쇼츠 거리 하나씩 기획안을 만들고, submit_ideas 도구로 제출한다. 제출이 이 작업의 결과물이다.

- 웹 검색은 주제의 사실 여부와 요즘의 관심을 확인할 때만 짧게 쓴다. 자세한 근거 조사는 나중에 대본 단계에서 한다.
- title: 유튜브 제목, 40자 이내. 호기심이 생기되 과장하지 않는다.
- hook: 영상 첫 2초에 시청자에게 던지는 질문 한 문장. 물음표로 끝난다.
- outline: 목차 3~5줄, 줄마다 한 문장.
- target_seconds: 내용 양에 맞는 영상 길이(초). 사용자 메시지의 기본 길이 근처로 고르고, 영상은 절대 1분을 넘지 않는다.
- reason: 왜 이 주제가 좋은지 한 문장.
- "최근 주제"와 같거나 비슷한 주제는 고르지 않는다. 한 편에 메시지 하나. 단정·과장·의학적 조언처럼 들리는 표현은 피한다.`;

export interface IdeaRequest {
  /** 채널 공통 프롬프트(화면에서 고친 값). */
  channelPrompt: string;
  categories: { name: string; prompt: string }[];
  defaultSeconds: number;
  recentTopics: string[];
}

export interface GeneratedIdeas {
  ideas: NewIdea[];
  model: string;
  webSearches: number;
  /** 대략의 비용(USD). 단가를 모르는 모델이면 null. */
  costUsd: number | null;
}

export class IdeaGenerationError extends Error {
  costUsd: number | null = null;
  constructor(message: string) {
    super(message);
    this.name = "IdeaGenerationError";
  }
}

interface Submission {
  ideas: { category: string; title: string; hook: string; outline: string[]; target_seconds: number; reason: string }[];
}

export function buildIdeasPrompt(request: IdeaRequest): string {
  return [
    "채널:",
    request.channelPrompt,
    "",
    `기본 길이: ${request.defaultSeconds}초 (고를 수 있는 길이: ${TARGET_SECONDS.join("·")}초)`,
    "",
    `카테고리별 요청(카테고리마다 기획안 하나씩, 모두 ${request.categories.length}개):`,
    ...request.categories.map((category) => `- [${category.name}] ${category.prompt}`),
    "",
    "최근 주제(겹치지 말 것):",
    ...(request.recentTopics.length ? request.recentTopics.map((topic) => `- ${topic}`) : ["- (없음)"]),
  ].join("\n");
}

function submitTool(categories: string[]): Anthropic.Beta.Messages.BetaTool {
  return {
    name: TOOL_NAME,
    description: "카테고리마다 하나씩 만든 쇼츠 기획안을 제출한다. 반드시 이 도구로 제출해야 작업이 끝난다.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        ideas: {
          type: "array",
          items: {
            type: "object",
            properties: {
              category: { type: "string", enum: categories },
              title: { type: "string" },
              hook: { type: "string" },
              outline: { type: "array", items: { type: "string" } },
              target_seconds: { type: "integer", enum: [...TARGET_SECONDS] },
              reason: { type: "string" },
            },
            required: ["category", "title", "hook", "outline", "target_seconds", "reason"],
            additionalProperties: false,
          },
        },
      },
      required: ["ideas"],
      additionalProperties: false,
    },
  };
}

/** 카테고리마다 정확히 하나, 빈 칸 없이. 고칠 것을 돌려준다. */
export function checkIdeas(submission: Submission, categories: string[]): string[] {
  const problems: string[] = [];
  const seen = submission.ideas.map((idea) => idea.category);
  for (const name of categories) {
    const count = seen.filter((category) => category === name).length;
    if (count !== 1) problems.push(`[${name}] 기획안이 ${count}개다. 카테고리마다 정확히 하나씩 낸다.`);
  }
  submission.ideas.forEach((idea, index) => {
    if (!idea.title.trim() || !idea.hook.trim() || !idea.outline.some((line) => line.trim())) {
      problems.push(`${index + 1}번째 기획안에 제목·훅·목차 중 빈 것이 있다.`);
    }
  });
  return problems;
}

const toNewIdea = (idea: Submission["ideas"][number]): NewIdea => ({
  category: idea.category,
  title: idea.title.trim(),
  hook: idea.hook.trim(),
  outline: idea.outline
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n"),
  reason: idea.reason.trim(),
  targetSeconds: idea.target_seconds,
});

export async function generateIdeas(
  request: IdeaRequest,
  options: { model: string; send: SendMessage; onProgress?: (text: string) => Promise<void> },
): Promise<GeneratedIdeas> {
  if (!request.categories.length) throw new IdeaGenerationError("카테고리가 없습니다.");
  const progress = options.onProgress ?? (async () => {});
  const names = request.categories.map((category) => category.name);
  const profile = modelProfile(options.model);
  const base = {
    model: options.model,
    max_tokens: 8_000,
    system: IDEAS_SYSTEM_PROMPT,
    tools: [{ type: profile.webSearch, name: "web_search" as const, max_uses: MAX_SEARCHES }, submitTool(names)],
  };
  const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [{ role: "user", content: buildIdeasPrompt(request) }];
  let costUsd: number | null = 0;
  let webSearches = 0;
  let corrected = false;
  let reminded = false;
  const fail = (message: string) => {
    const error = new IdeaGenerationError(message);
    error.costUsd = costUsd;
    return error;
  };

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const response = await options.send({ ...base, messages } as Parameters<SendMessage>[0]);
    const cost = roundCost(response.model, response.usage);
    costUsd = costUsd === null || cost === null ? null : costUsd + cost;
    webSearches += response.usage.server_tool_use?.web_search_requests ?? 0;
    if (response.stop_reason === "refusal") throw fail("추천 생성이 거절되었습니다. 프롬프트 표현을 바꿔 다시 시도하세요.");
    if (response.stop_reason === "max_tokens") throw fail("응답이 길이 한도에 걸려 추천이 완성되지 않았습니다.");
    messages.push({ role: "assistant", content: response.content });
    if (response.stop_reason === "pause_turn") {
      await progress(`주제 확인 중 · 웹 검색 ${webSearches}회`);
      continue;
    }

    const call = response.content.find(
      (block): block is Anthropic.Beta.Messages.BetaToolUseBlock => block.type === "tool_use" && block.name === TOOL_NAME,
    );
    if (!call) {
      if (reminded) throw fail("Claude 가 기획안을 제출하지 않고 끝냈습니다.");
      reminded = true;
      messages.push({ role: "user", content: "submit_ideas 도구로 기획안을 제출하라." });
      continue;
    }
    const submission = call.input as Submission;
    const problems = checkIdeas(submission, names);
    if (problems.length && !corrected) {
      corrected = true;
      await progress("기획안 형식 고치는 중");
      messages.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: call.id,
            is_error: true,
            content: `다음을 고쳐 submit_ideas 로 다시 제출하라:\n${problems.map((p) => `- ${p}`).join("\n")}`,
          },
        ],
      });
      continue;
    }
    if (problems.length) throw fail(`기획안 형식 오류: ${problems.join(" / ")}`);
    return { ideas: submission.ideas.map(toNewIdea), model: response.model, webSearches, costUsd };
  }
  throw fail(`추천 생성이 ${MAX_ROUNDS}번 안에 끝나지 않았습니다.`);
}
