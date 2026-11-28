import type Anthropic from "@anthropic-ai/sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildIdeasPrompt, checkIdeas, generateIdeas, IDEAS_SYSTEM_PROMPT, type IdeaRequest } from "@/pipeline/ideas/generate";
import type { SendMessage } from "@/pipeline/script/generate";
import { createMigratedSchema, testDatabaseUrl } from "./helpers/db";

type Message = Anthropic.Beta.Messages.BetaMessage;
type Params = Parameters<SendMessage>[0];

const CATEGORIES = ["화장품 성분", "피부건강 꿀팁", "피부 과학"];
const usage = { input_tokens: 1_000, output_tokens: 500, server_tool_use: { web_search_requests: 2 } };

function message(stop_reason: string, content: unknown[]): Message {
  return {
    id: "m",
    type: "message",
    role: "assistant",
    model: "claude-haiku-5-5",
    stop_reason,
    content,
    usage,
  } as unknown as Message;
}

const idea = (category: string, title = `${category} 이야기`) => ({
  category,
  title,
  hook: `${title}, 알고 계셨나요?`,
  outline: [" 첫째 ", "둘째", ""],
  target_seconds: 30,
  reason: "요즘 많이 묻는 주제",
});
const submitIdeas = (ideas: ReturnType<typeof idea>[], id = "tu_1") =>
  message("tool_use", [{ type: "tool_use", id, name: "submit_ideas", input: { ideas } }]);

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

const request: IdeaRequest = {
  channelPrompt: '채널 "피부건강 라쿤씨"',
  categories: CATEGORIES.map((name) => ({ name, prompt: `${name} 요청` })),
  defaultSeconds: 30,
  recentTopics: ["나이아신아마이드"],
};

describe("추천 기획안 생성 (가짜 API)", () => {
  it("채널·카테고리 프롬프트와 최근 주제를 넘기고, 카테고리를 enum 으로 묶은 제출 도구로 받는다", async () => {
    const { send, calls } = fake([submitIdeas(CATEGORIES.map((name) => idea(name)))]);
    const result = await generateIdeas(request, { model: "claude-haiku-5-5", send });

    expect(result.ideas).toHaveLength(3);
    expect(result.ideas[0]).toEqual({
      category: "화장품 성분",
      title: "화장품 성분 이야기",
      hook: "화장품 성분 이야기, 알고 계셨나요?",
      outline: "첫째\n둘째",
      reason: "요즘 많이 묻는 주제",
      targetSeconds: 30,
    });
    expect(result.webSearches).toBe(2);
    expect(result.costUsd).toBeGreaterThan(0);

    const params = calls[0];
    expect(params.system).toBe(IDEAS_SYSTEM_PROMPT);
    const prompt = String(params.messages[0].content);
    expect(prompt).toContain('채널 "피부건강 라쿤씨"');
    expect(prompt).toContain("- [피부건강 꿀팁] 피부건강 꿀팁 요청");
    expect(prompt).toContain("기본 길이: 30초");
    expect(prompt).toContain("- 나이아신아마이드");
    const tool = params.tools!.find((t) => "name" in t && t.name === "submit_ideas") as Anthropic.Beta.Messages.BetaTool;
    expect(JSON.stringify(tool.input_schema)).toContain(JSON.stringify(CATEGORIES));
    expect(params.tools!.find((t) => "name" in t && t.name === "web_search")).toMatchObject({ max_uses: 5 });
  });

  it("카테고리가 빠지거나 겹치면 한 번 고치게 하고, 그래도 틀리면 실패(쓴 비용을 남긴다)", async () => {
    expect(buildIdeasPrompt({ ...request, recentTopics: [] })).toContain("- (없음)");
    const wrong = [idea("화장품 성분"), idea("화장품 성분", "두 번째"), idea("피부 과학")];
    expect(checkIdeas({ ideas: wrong }, CATEGORIES)).toEqual([
      "[화장품 성분] 기획안이 2개다. 카테고리마다 정확히 하나씩 낸다.",
      "[피부건강 꿀팁] 기획안이 0개다. 카테고리마다 정확히 하나씩 낸다.",
    ]);

    const fixed = fake([
      submitIdeas(wrong),
      submitIdeas(
        CATEGORIES.map((name) => idea(name)),
        "tu_2",
      ),
    ]);
    expect((await generateIdeas(request, { model: "claude-haiku-5-5", send: fixed.send })).ideas).toHaveLength(3);
    const correction = fixed.calls[1].messages.at(-1)!.content as { type: string; is_error: boolean; content: string }[];
    expect(correction[0]).toMatchObject({ type: "tool_result", is_error: true });
    expect(correction[0].content).toContain("[피부건강 꿀팁] 기획안이 0개다");

    const stubborn = fake([submitIdeas(wrong), submitIdeas(wrong, "tu_2")]);
    const error = await generateIdeas(request, { model: "claude-haiku-5-5", send: stubborn.send }).catch((e: unknown) => e);
    expect(String(error)).toContain("기획안 형식 오류");
    expect((error as { costUsd: number }).costUsd).toBeGreaterThan(0);
  });
});

describe.skipIf(!testDatabaseUrl)("추천 기획안 (실제 DB)", () => {
  let drop: () => Promise<void>;

  beforeAll(async () => {
    const schema = await createMigratedSchema("ideas");
    drop = schema.drop;
    process.env.DATABASE_URL = schema.url;
  });

  afterAll(async () => {
    const { getPool } = await import("@/lib/db");
    await getPool().end();
    await drop();
  });

  it("라쿤씨는 카테고리 3개와 기본 프롬프트로 시작하고, 프롬프트는 버전으로 쌓여 되돌릴 수 있다", async () => {
    const { listCategories, isEditablePromptKey } = await import("@/pipeline/ideas/store");
    const prompts = await import("@/pipeline/prompts");
    const categories = await listCategories("raccoon");
    expect(categories.map((category) => category.name)).toEqual(CATEGORIES);
    expect(await listCategories("saesae")).toEqual([]);

    const keys = [prompts.channelIdeaPromptKey("raccoon"), ...categories.map((c) => prompts.categoryIdeaPromptKey(c.id))];
    const current = await prompts.currentPrompts(keys);
    expect([...current.values()].map((p) => p.version)).toEqual([1, 1, 1, 1]);
    expect(current.get("ideas:raccoon")?.body).toContain("피부건강 라쿤씨");

    const key = prompts.categoryIdeaPromptKey(categories[0].id);
    const original = current.get(key)!.body;
    expect(await prompts.savePrompt(key, `  ${original}  `)).toBeNull(); // 같은 내용이면 저장하지 않는다
    expect(await prompts.savePrompt(key, "새 요청")).toMatchObject({ version: 2, body: "새 요청" });
    await expect(prompts.savePrompt(key, " ")).rejects.toThrow("비울 수 없습니다");
    // 되돌리기 = 예전 내용을 새 버전으로
    expect(await prompts.savePrompt(key, original)).toMatchObject({ version: 3, body: original });
    expect((await prompts.promptHistory(key)).map((p) => p.version)).toEqual([3, 2, 1]);

    expect(await isEditablePromptKey("ideas:raccoon")).toBe(true);
    expect(await isEditablePromptKey(key)).toBe(true);
    expect(await isEditablePromptKey("ideas:nope")).toBe(false);
    expect(await isEditablePromptKey("ideas:category:99999")).toBe(false);
    expect(await isEditablePromptKey("script:raccoon")).toBe(true);
  });

  it("추천 실행: 하나씩만 돌고, 기획안을 카테고리에 붙여 저장한다. 실패하면 이유와 비용을 남긴다", async () => {
    const store = await import("@/pipeline/ideas/store");
    const { runIdeaRun } = await import("@/pipeline/ideas/run");
    const { savePrompt } = await import("@/pipeline/prompts");
    const { createEpisode } = await import("@/pipeline/episodes");
    await createEpisode({ topic: "세라마이드 이야기", outline: "", channel: "raccoon" });
    await savePrompt("ideas:raccoon", "고친 채널 프롬프트");

    const run = await store.requestIdeaRun("raccoon", "manual");
    await expect(store.requestIdeaRun("raccoon", "manual")).rejects.toThrow("만드는 중입니다");
    // 30분 넘게 멈춘 실행은 막지 않는다
    expect(store.isRunActive(run, Date.now() + store.RUN_STALE_MS + 1)).toBe(false);

    const { send, calls } = fake([submitIdeas(CATEGORIES.map((name) => idea(name)))]);
    const result = await runIdeaRun(run.id, { send, runUrl: "https://github.test/run/1" });
    expect(result.ideas.map((i) => [i.title, i.status, i.categoryId !== null])).toEqual(
      CATEGORIES.map((name) => [`${name} 이야기`, "new", true]),
    );
    const prompt = String(calls[0].messages[0].content);
    expect(prompt).toContain("고친 채널 프롬프트");
    expect(prompt).toContain("- 세라마이드 이야기");
    expect(await store.latestIdeaRun("raccoon")).toMatchObject({
      status: "done",
      model: "claude-haiku-5-5",
      runUrl: "https://github.test/run/1",
    });
    expect(await store.countNewIdeas("raccoon")).toBe(3);
    expect(await store.recentTopics("raccoon")).toEqual(expect.arrayContaining(["피부 과학 이야기", "세라마이드 이야기"]));

    const failed = await store.requestIdeaRun("raccoon", "manual");
    const broken: SendMessage = async () => {
      throw new Error("overloaded");
    };
    await expect(runIdeaRun(failed.id, { send: broken })).rejects.toThrow("overloaded");
    expect(await store.getIdeaRun(failed.id)).toMatchObject({ status: "failed", error: "overloaded" });
  });

  it("저장·폐기·되살리기, 에피소드로 만든 기획안은 다시 쓰지 않는다", async () => {
    const store = await import("@/pipeline/ideas/store");
    const { createEpisode } = await import("@/pipeline/episodes");
    const [first, second] = await store.listIdeas("raccoon", ["new"]);
    expect(await store.decideIdea(first.id, "saved")).toMatchObject({ status: "saved" });
    expect(await store.decideIdea(second.id, "discarded")).toMatchObject({ status: "discarded" });
    expect(await store.decideIdea(second.id, "saved")).toMatchObject({ status: "saved" });

    const create = (idea: { title: string; outline: string }) =>
      createEpisode({ topic: idea.title, outline: idea.outline, channel: "raccoon", targetSeconds: 30 }).then((e) => e.id);
    // 만들다 실패하면 기획안은 그대로
    await expect(store.claimIdea(first.id, () => createEpisode({ topic: "", outline: "" }).then((e) => e.id))).rejects.toThrow(
      "주제를 입력하세요",
    );
    expect(await store.getIdea(first.id)).toMatchObject({ status: "saved", episodeId: null });
    // 두 번 눌러도 에피소드는 하나
    const results = await Promise.allSettled([store.claimIdea(first.id, create), store.claimIdea(first.id, create)]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    const episodeId = (results.find((r) => r.status === "fulfilled") as PromiseFulfilledResult<number>).value;
    const { query } = await import("@/lib/db");
    expect(await query("select id from episodes where topic = $1", [first.title])).toHaveLength(1);
    await expect(store.decideIdea(first.id, "discarded")).rejects.toThrow("이미 쇼츠로 만든");
    expect(await store.getIdea(first.id)).toMatchObject({ status: "used", episodeId });
  });

  it("자동 추천: 켠 채널만, 주기가 됐을 때만, 보지 않은 기획안이 많으면 건너뛴다. 실패한 실행은 다음 날 다시", async () => {
    const store = await import("@/pipeline/ideas/store");
    const { updateIdeaSettings } = await import("@/pipeline/channels");
    const { query } = await import("@/lib/db");
    const day = 24 * 60 * 60_000;
    const now = Date.now();
    expect(await store.dueIdeaChannels(now)).toEqual([]); // 기본 꺼짐

    await updateIdeaSettings("raccoon", { auto: true, everyDays: 2 });
    await updateIdeaSettings("saesae", { auto: false, everyDays: 1 }); // 편집형은 stories.test.ts 에서 본다
    await expect(updateIdeaSettings("raccoon", { auto: true, everyDays: 8 })).rejects.toThrow("1~7일");
    // 방금 성공한 실행이 있다 → 아직
    expect(await store.dueIdeaChannels(now)).toEqual([]);
    // 이틀 뒤(매일 실행이 조금 일찍 돌아도) → 대상
    expect(await store.dueIdeaChannels(now + 2 * day - 2 * 60 * 60_000)).toEqual(["raccoon"]);

    // 성공한 실행을 사흘 전으로 → 실패한 실행만 최근이면 대상
    await query("update idea_runs set created_at = now() - interval '3 days' where status = 'done'");
    expect(await store.dueIdeaChannels(now)).toEqual(["raccoon"]);

    // 보지 않은 새 기획안이 7개 이상이면 건너뛴다
    await query(
      `insert into ideas (channel, title, hook, outline, target_seconds)
        select 'raccoon', '쌓인 ' || n, '?', '-', 30 from generate_series(1, 7) n`,
    );
    expect(await store.dueIdeaChannels(now)).toEqual([]);
  });
});
