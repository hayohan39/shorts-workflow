import { getChannel } from "@/pipeline/channels";
import { availablePoolItems, collectPool } from "@/pipeline/clips/pool";
import { createAdapters } from "@/pipeline/clips/sources";
import type { SourceAdapter } from "@/pipeline/clips/types";
import { generateStories } from "@/pipeline/ideas/stories";
import { generateIdeas, IdeaGenerationError } from "@/pipeline/ideas/generate";
import {
  dueIdeaChannels,
  failIdeaRun,
  finishIdeaRun,
  getIdeaRun,
  listCategories,
  recentTopics,
  requestIdeaRun,
  setIdeaRunProgress,
  startIdeaRun,
  type Idea,
} from "@/pipeline/ideas/store";
import { categoryIdeaPromptKey, channelIdeaPromptKey, currentPrompts } from "@/pipeline/prompts";
import { DEFAULT_SCRIPT_MODEL } from "@/pipeline/script/model";
import type { SendMessage } from "@/pipeline/script/generate";
import { getSettings } from "@/pipeline/settings";

// 추천 실행(Actions 의 ideas 단계, 매일 실행의 ideas-daily). 모델은 대본과 같은 설정(기본 Haiku)을 쓴다.
//   생성형 채널: 카테고리마다 기획안 하나(ideas/generate.ts)
//   편집형 채널: 소재 풀 채우기(무료) → 풀에서 스토리 후보 3개(ideas/stories.ts)

export interface IdeaRunResult {
  ideas: Idea[];
  costUsd: number | null;
}

/** 대기 중인 추천 실행 하나를 돌린다. 실패하면 이유를 기록하고 다시 던진다. */
export interface RunOptions {
  send: SendMessage;
  runUrl?: string | null;
  /** 소재 풀 수집에 쓰는 소스(테스트에서 바꿔 끼운다). */
  adapters?: SourceAdapter[];
}

export async function runIdeaRun(id: number, options: RunOptions): Promise<IdeaRunResult> {
  const run = await getIdeaRun(id);
  if (!run) throw new Error(`추천 실행 #${id} 을 찾을 수 없습니다.`);
  await startIdeaRun(id, options.runUrl ?? null);
  try {
    const [channel, categories, topics, settings] = await Promise.all([
      getChannel(run.channel),
      listCategories(run.channel),
      recentTopics(run.channel),
      getSettings(),
    ]);
    if (!channel) throw new Error(`채널 ${run.channel} 을 찾을 수 없습니다.`);
    const prompts = await currentPrompts([
      channelIdeaPromptKey(channel.slug),
      ...categories.map((c) => categoryIdeaPromptKey(c.id)),
    ]);
    const model = settings.scriptModel || DEFAULT_SCRIPT_MODEL;
    const channelPrompt = prompts.get(channelIdeaPromptKey(channel.slug))?.body ?? channel.name;
    const onProgress = (text: string) => setIdeaRunProgress(id, text);
    let result;
    if (channel.route === "clips") {
      // 편집형: 소재 풀을 먼저 채우고(무료, 안 쓴 소재가 충분하면 건너뜀) 풀에서 스토리 후보를 만든다.
      await setIdeaRunProgress(id, "소재 풀 확인·수집 중");
      const pool = await collectPool(channel.slug, { adapters: options.adapters ?? createAdapters() });
      await setIdeaRunProgress(id, `스토리 후보 만드는 중 (${model}, 새 소재 ${pool.added}개)`);
      result = await generateStories(
        {
          channelPrompt,
          defaultSeconds: channel.defaultSeconds,
          recentTopics: topics,
          items: await availablePoolItems(channel.slug),
        },
        { model, send: options.send, onProgress },
      );
    } else {
      await setIdeaRunProgress(id, `기획안 만드는 중 (${model})`);
      result = await generateIdeas(
        {
          channelPrompt,
          categories: categories.map((category) => ({
            name: category.name,
            prompt: prompts.get(categoryIdeaPromptKey(category.id))?.body ?? category.name,
          })),
          defaultSeconds: channel.defaultSeconds,
          recentTopics: topics,
        },
        { model, send: options.send, onProgress },
      );
    }
    const ideas = await finishIdeaRun(id, result.ideas, { model: result.model, costUsd: result.costUsd });
    return { ideas, costUsd: result.costUsd };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failIdeaRun(id, message, error instanceof IdeaGenerationError ? error.costUsd : null);
    throw error;
  }
}

/** 매일 실행: 자동 추천이 켜져 있고 주기가 된 채널마다 한 번씩. 채널 하나가 실패해도 나머지는 돈다. */
export async function ideasDaily(
  options: RunOptions & { now?: number },
): Promise<{ channel: string; result: IdeaRunResult | null; error: string | null }[]> {
  const outcomes = [];
  for (const channel of await dueIdeaChannels(options.now)) {
    try {
      const run = await requestIdeaRun(channel, "schedule", options.now);
      outcomes.push({ channel, result: await runIdeaRun(run.id, options), error: null });
    } catch (error) {
      outcomes.push({ channel, result: null, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return outcomes;
}
