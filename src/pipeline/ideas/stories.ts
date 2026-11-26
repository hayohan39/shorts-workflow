import type Anthropic from "@anthropic-ai/sdk";
import { savePicks } from "@/pipeline/clips/picks";
import { createStoryCollection, markPoolUsed } from "@/pipeline/clips/pool";
import { getClips, type StoredClip } from "@/pipeline/clips/store";
import { createEpisode } from "@/pipeline/episodes";
import type { Idea } from "@/pipeline/ideas/store";
import { SOURCE_LABELS } from "@/pipeline/clips/types";
import { IdeaGenerationError, type GeneratedIdeas } from "@/pipeline/ideas/generate";
import { roundCost } from "@/pipeline/script/pricing";
import { modelProfile } from "@/pipeline/script/model";
import { lengthRules, TARGET_SECONDS } from "@/pipeline/script/schema";
import type { SendMessage } from "@/pipeline/script/generate";

// 편집형 채널(새새 열매)의 스토리 후보: 소재 풀에서 장면 순서대로 소재를 골라 이야기를 입힌 기획안 N개.
// 근거 조사와 대본은 고른 후보에만 한다(script 단계). 여기서는 사실 여부를 가볍게만 확인한다.

const TOOL_NAME = "submit_stories";
const MAX_ROUNDS = 6;
const MAX_SEARCHES = 3;
/** 하루에 받는 후보 수 */
export const STORY_COUNT = 3;

export const STORIES_SYSTEM_PROMPT = `당신은 한국어 유튜브 쇼츠 채널의 기획자다. 사용자 메시지의 채널 설명에 맞춰, 주어진 소재(영상·사진) 목록에서 장면에 쓸 소재를 골라 이야기를 입힌 스토리 후보를 만들고 submit_stories 도구로 제출한다. 제출이 이 작업의 결과물이다.

- 후보는 사용자 메시지에 적힌 개수만큼, 서로 다른 주제로 만든다.
- item_ids: 장면 순서대로 고른 소재 ID. 개수는 target_seconds 의 장면 수(사용자 메시지의 표)와 정확히 같다. 한 소재는 한 후보에만 쓴다.
- 한 후보의 소재는 같은 종(또는 한 이야기로 이어지는 새들)이어야 하고, 내레이션이 화면의 새와 맞아야 한다. 새가 아닌 소재는 절대 쓰지 않는다.
- 1번 장면은 첫 2초 훅에 어울리는 눈에 띄는 소재로 고른다.
- title: 유튜브 제목, 40자 이내. hook: 첫 2초에 던지는 질문 한 문장(물음표로 끝남). outline: 목차 3~5줄. reason: 왜 재밌는지 한 문장.
- 사실은 웹 검색으로 짧게 확인한다. 확인되지 않은 사실은 쓰지 않는다. 자세한 근거 조사는 나중에 대본 단계에서 한다.
- "최근 주제"와 같거나 비슷한 주제는 고르지 않는다.`;

export interface StoryRequest {
  channelPrompt: string;
  defaultSeconds: number;
  recentTopics: string[];
  items: StoredClip[];
  count?: number;
}

interface Submission {
  stories: { title: string; hook: string; outline: string[]; target_seconds: number; item_ids: number[]; reason: string }[];
}

const mediaLabel = (clip: StoredClip) => (clip.media === "image" ? "사진" : `영상 ${clip.durationSec ?? "?"}초`);

export function buildStoriesPrompt(request: StoryRequest): string {
  const count = request.count ?? STORY_COUNT;
  return [
    "채널:",
    request.channelPrompt,
    "",
    `만들 후보: ${count}개 · 기본 길이 ${request.defaultSeconds}초`,
    `길이별 장면 수: ${TARGET_SECONDS.map((seconds) => `${seconds}초 ${lengthRules(seconds).scenes}개`).join(", ")}`,
    "",
    "소재 목록(ID · 종류 · 제목 · 출처 · 검색어):",
    ...request.items.map(
      (clip) => `- #${clip.id} · ${mediaLabel(clip)} · ${clip.title} · ${SOURCE_LABELS[clip.source]} · ${clip.keyword}`,
    ),
    "",
    "최근 주제(겹치지 말 것):",
    ...(request.recentTopics.length ? request.recentTopics.map((topic) => `- ${topic}`) : ["- (없음)"]),
  ].join("\n");
}

function submitTool(ids: number[]): Anthropic.Beta.Messages.BetaTool {
  return {
    name: TOOL_NAME,
    description: "소재를 골라 만든 스토리 후보를 제출한다. 반드시 이 도구로 제출해야 작업이 끝난다.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        stories: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              hook: { type: "string" },
              outline: { type: "array", items: { type: "string" } },
              target_seconds: { type: "integer", enum: [...TARGET_SECONDS] },
              item_ids: { type: "array", items: { type: "integer", enum: ids } },
              reason: { type: "string" },
            },
            required: ["title", "hook", "outline", "target_seconds", "item_ids", "reason"],
            additionalProperties: false,
          },
        },
      },
      required: ["stories"],
      additionalProperties: false,
    },
  };
}

/** 개수, 장면 수, 소재 중복·목록 밖 소재를 본다. 고칠 것을 돌려준다. */
export function checkStories(submission: Submission, ids: number[], count: number): string[] {
  const problems: string[] = [];
  if (submission.stories.length !== count) problems.push(`후보가 ${submission.stories.length}개다. 정확히 ${count}개를 낸다.`);
  const allowed = new Set(ids);
  const used = new Set<number>();
  submission.stories.forEach((story, index) => {
    const label = `${index + 1}번 후보`;
    const scenes = lengthRules(story.target_seconds).scenes;
    if (story.item_ids.length !== scenes) {
      problems.push(`${label}: ${story.target_seconds}초는 장면 ${scenes}개인데 소재가 ${story.item_ids.length}개다.`);
    }
    for (const id of story.item_ids) {
      if (!allowed.has(id)) problems.push(`${label}: #${id} 는 목록에 없는 소재다.`);
      else if (used.has(id)) problems.push(`${label}: #${id} 는 다른 장면·후보에서 이미 썼다.`);
      used.add(id);
    }
    if (!story.title.trim() || !story.hook.trim() || !story.outline.some((line) => line.trim())) {
      problems.push(`${label}: 제목·훅·목차 중 빈 것이 있다.`);
    }
  });
  return problems;
}

export async function generateStories(
  request: StoryRequest,
  options: { model: string; send: SendMessage; onProgress?: (text: string) => Promise<void> },
): Promise<GeneratedIdeas> {
  const count = request.count ?? STORY_COUNT;
  const ids = request.items.map((clip) => clip.id);
  const minimum = count * lengthRules(TARGET_SECONDS[0]).scenes;
  if (ids.length < minimum) {
    throw new IdeaGenerationError(
      `쓸 수 있는 소재가 ${ids.length}개라 후보 ${count}개를 만들 수 없습니다(${minimum}개 이상 필요). 소재 풀을 먼저 채우세요.`,
    );
  }
  const progress = options.onProgress ?? (async () => {});
  const profile = modelProfile(options.model);
  const base = {
    model: options.model,
    max_tokens: 8_000,
    system: STORIES_SYSTEM_PROMPT,
    tools: [{ type: profile.webSearch, name: "web_search" as const, max_uses: MAX_SEARCHES }, submitTool(ids)],
  };
  const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [{ role: "user", content: buildStoriesPrompt(request) }];
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
    if (response.stop_reason === "refusal") throw fail("스토리 생성이 거절되었습니다. 프롬프트 표현을 바꿔 다시 시도하세요.");
    if (response.stop_reason === "max_tokens") throw fail("응답이 길이 한도에 걸려 스토리가 완성되지 않았습니다.");
    messages.push({ role: "assistant", content: response.content });
    if (response.stop_reason === "pause_turn") {
      await progress(`사실 확인 중 · 웹 검색 ${webSearches}회`);
      continue;
    }
    const call = response.content.find(
      (block): block is Anthropic.Beta.Messages.BetaToolUseBlock => block.type === "tool_use" && block.name === TOOL_NAME,
    );
    if (!call) {
      if (reminded) throw fail("Claude 가 스토리를 제출하지 않고 끝냈습니다.");
      reminded = true;
      messages.push({ role: "user", content: "submit_stories 도구로 스토리 후보를 제출하라." });
      continue;
    }
    const submission = call.input as Submission;
    const problems = checkStories(submission, ids, count);
    if (problems.length && !corrected) {
      corrected = true;
      await progress("스토리 형식 고치는 중");
      messages.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: call.id,
            is_error: true,
            content: `다음을 고쳐 submit_stories 로 다시 제출하라:\n${problems.map((p) => `- ${p}`).join("\n")}`,
          },
        ],
      });
      continue;
    }
    if (problems.length) throw fail(`스토리 형식 오류: ${problems.join(" / ")}`);
    return {
      ideas: submission.stories.map((story) => ({
        category: "",
        title: story.title.trim(),
        hook: story.hook.trim(),
        outline: story.outline
          .map((line) => line.trim())
          .filter(Boolean)
          .join("\n"),
        reason: story.reason.trim(),
        targetSeconds: story.target_seconds,
        clipIds: story.item_ids,
      })),
      model: response.model,
      webSearches,
      costUsd,
    };
  }
  throw fail(`스토리 생성이 ${MAX_ROUNDS}번 안에 끝나지 않았습니다.`);
}

/**
 * 스토리 후보로 편집형 에피소드를 만든다: 고른 풀 소재를 그 에피소드의 소재 찾기 결과로 옮기고 장면 순서대로 고른다.
 * 소재는 "사용됨" 으로 표시해 다음 스토리에 다시 넣지 않는다. 만든 에피소드와 소재 수집 번호를 돌려준다.
 */
export async function createStoryEpisode(
  idea: Pick<Idea, "channel" | "hook" | "targetSeconds" | "clipIds">,
  edit: { title: string; outline: string; scriptDirection?: string },
): Promise<{ episodeId: number; collectionId: number }> {
  const ids = idea.clipIds ?? [];
  const clips = await getClips(ids);
  if (!ids.length || clips.length !== ids.length)
    throw new RangeError("스토리의 소재 일부를 찾을 수 없습니다. 다른 후보를 고르세요.");
  const episode = await createEpisode({
    topic: edit.title,
    outline: `컨셉: ${idea.hook}\n\n${edit.outline.trim()}`,
    route: "clips",
    channel: idea.channel,
    targetSeconds: idea.targetSeconds,
    scriptDirection: edit.scriptDirection,
  });
  const picked = await createStoryCollection(episode.id, edit.title, clips);
  const [saved] = await savePicks(episode, picked);
  await markPoolUsed(ids);
  return { episodeId: episode.id, collectionId: saved.collectionId };
}
