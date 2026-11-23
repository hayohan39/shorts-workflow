import type Anthropic from "@anthropic-ai/sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SendMessage } from "@/pipeline/script/generate";
import { lengthRules } from "@/pipeline/script/schema";
import { createMigratedSchema, testDatabaseUrl } from "./helpers/db";
import { validSubmission } from "./helpers/script";

const reply = (input: unknown) =>
  ({
    id: "m",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    stop_reason: "tool_use",
    content: [{ type: "tool_use", id: "tu", name: "submit_script", input }],
    usage: { input_tokens: 10, output_tokens: 5, server_tool_use: { web_search_requests: 1, web_fetch_requests: 0 } },
  }) as unknown as Anthropic.Beta.Messages.BetaMessage;

describe.skipIf(!testDatabaseUrl)("대본 단계 (실제 DB)", () => {
  let drop: () => Promise<void>;

  beforeAll(async () => {
    const schema = await createMigratedSchema("script");
    drop = schema.drop;
    process.env.DATABASE_URL = schema.url;
  });

  afterAll(async () => {
    const { getPool } = await import("@/lib/db");
    await getPool().end();
    await drop();
  });

  it("생성 → 저장(v1), 반려 메모 → 다음 생성에 반영(v2)", async () => {
    const { createEpisode, getEpisode } = await import("@/pipeline/episodes");
    const { runScriptStep } = await import("@/pipeline/steps/script");
    const { latestScript, setReviewerNote } = await import("@/pipeline/scripts");
    const episode = (await createEpisode({ topic: "PDRN", outline: "소개 → 효과" }))!;

    const prompts: string[] = [];
    const send: SendMessage = async (params) => {
      prompts.push(String(params.messages[0].content));
      return reply(validSubmission());
    };
    await runScriptStep((await getEpisode(episode.id))!, { send });
    const v1 = await latestScript(episode.id);
    expect(v1).toMatchObject({ version: 1, source: "generated", model: "claude-opus-5-5" });
    // 근거 문장의 "완치율"도 걸린다: 자동 반려하지 않고 사람이 문맥을 보고 판단하도록 경고만 남긴다.
    expect(v1?.warnings).toEqual([{ field: "scenes.3", message: '"완치" — 의약품 오인 표현(질병의 치료·처방)' }]);
    expect(v1?.usage).toMatchObject({ webSearches: 1 });
    expect(typeof v1?.usage?.costUsd).toBe("number");

    await setReviewerNote(v1!.id, "훅을 더 짧게");
    await runScriptStep((await getEpisode(episode.id))!, { send });
    expect((await latestScript(episode.id))?.version).toBe(2);
    expect(prompts[1]).toContain("메모: 훅을 더 짧게");
    expect(prompts[1]).toContain("이전 내레이션: 연어에서 뽑은");

    const { scriptCostTotal } = await import("@/pipeline/scripts");
    const costs = await scriptCostTotal(episode.id);
    expect(costs).toMatchObject({ runs: 2, unknown: 0 });
    expect(costs.total).toBeGreaterThan(0);
  });

  it("다른 편의 훅을 프롬프트에 넣어 겹치지 않게 한다", async () => {
    const { createEpisode, getEpisode } = await import("@/pipeline/episodes");
    const { runScriptStep } = await import("@/pipeline/steps/script");
    const episode = await createEpisode({ topic: "히알루론산", outline: "" });
    let prompt = "";
    await runScriptStep((await getEpisode(episode.id))!, {
      send: async (params) => {
        prompt = String(params.messages[0].content);
        return reply(validSubmission());
      },
    });
    expect(prompt).toContain("최근 편");
    expect(prompt).toContain("훅: 연어에서 뽑은 DNA");
  });

  it("채널마다 대본 지침(시스템 프롬프트)과 설명란 끝 문구가 다르다", async () => {
    const { createEpisode, getEpisode } = await import("@/pipeline/episodes");
    const { runScriptStep } = await import("@/pipeline/steps/script");
    const { latestScript } = await import("@/pipeline/scripts");
    const { savePrompt } = await import("@/pipeline/prompts");
    const systems: string[] = [];
    const send: SendMessage = async (params) => {
      systems.push(String(params.system));
      return reply(validSubmission());
    };
    const skin = await createEpisode({ topic: "세라마이드", outline: "", channel: "raccoon" });
    await runScriptStep((await getEpisode(skin.id))!, { send });
    expect(systems[0]).toContain("채널 지침\n건강·화장품 성분을 근거 중심으로");
    expect((await latestScript(skin.id))!.description.endsWith("전문의와 상담하세요.")).toBe(true);

    await savePrompt("script:saesae", "새 이야기만 한다(고친 지침).");
    const bird = await createEpisode({ topic: "참새의 모래 목욕", outline: "", channel: "saesae" });
    await runScriptStep((await getEpisode(bird.id))!, { send });
    expect(systems[1]).toContain("채널 지침\n새 이야기만 한다(고친 지침).");
    expect(systems[1]).not.toContain("화장품");
    expect((await latestScript(bird.id))!.description).not.toContain("의학적 조언");
  });

  it("직접 수정은 새 버전으로 저장하고 다시 검사한다", async () => {
    const { createEpisode, getEpisode } = await import("@/pipeline/episodes");
    const { runScriptStep } = await import("@/pipeline/steps/script");
    const { latestScript, saveEditedScript } = await import("@/pipeline/scripts");
    const episode = await createEpisode({ topic: "수정", outline: "" });
    await runScriptStep((await getEpisode(episode.id))!, { send: async () => reply(validSubmission()) });
    const base = (await latestScript(episode.id))!;

    const edited = await saveEditedScript(
      base,
      {
        narrations: base.scenes.map((s, i) => (i === 1 ? "피부 재생 성분입니다." : s.narration)),
        title: "새 제목",
        description: "출처 없이 쓴 설명",
        tags: "#shorts PDRN",
      },
      lengthRules(episode.targetSeconds),
      "※ 의학적 조언이 아닙니다.",
    );
    expect(edited).toMatchObject({ version: 2, source: "edited", title: "새 제목", tags: ["#shorts", "#PDRN"] });
    expect(edited.scenes[1].prompt).toBe(base.scenes[1].prompt);
    const messages = edited.warnings.map((w) => w.message).join(" | ");
    expect(messages).toContain("끝 문구(고지)가 없습니다");
    expect(messages).toContain("피부 재생");

    await expect(
      saveEditedScript(base, { narrations: ["", "", "", ""], title: "", description: "", tags: "" }, lengthRules(35)),
    ).rejects.toThrow(RangeError);
  });
});
