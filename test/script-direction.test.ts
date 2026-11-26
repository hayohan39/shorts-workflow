import type Anthropic from "@anthropic-ai/sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { canEditDirection } from "@/pipeline/episodes";
import { buildUserPrompt } from "@/pipeline/script/prompt";
import { lengthRules } from "@/pipeline/script/schema";
import { createMigratedSchema, testDatabaseUrl } from "./helpers/db";
import { validSubmission } from "./helpers/script";

const base = {
  topic: "PDRN",
  rules: lengthRules(30),
  outline: "",
  reviewerNote: null,
  previousNarration: null,
  recentEpisodes: [],
};

describe("대본 방향", () => {
  it("적으면 사용자 메시지에 넣고(사실·분량 규칙이 앞선다고 함께), 비우면 넣지 않는다", () => {
    const prompt = buildUserPrompt({ ...base, direction: "  친구한테 말하듯 가볍게. 마지막은 질문으로.  " });
    expect(prompt).toContain("이 편의 연출 방향(사용자 요청)");
    expect(prompt).toContain("사실 확인·근거·분량·형식 규칙보다 앞서지는 않는다");
    expect(prompt).toContain("\n친구한테 말하듯 가볍게. 마지막은 질문으로.\n");
    expect(buildUserPrompt({ ...base, direction: "   " })).not.toContain("연출 방향");
    expect(buildUserPrompt(base)).not.toContain("연출 방향");
  });

  it("대본 승인 전(대기·검토 중·대본 생성 실패)이고 도는 작업이 없을 때만 고친다", () => {
    const episode = { route: "ai" as const, status: "queued" as const, step: null, stepState: null };
    expect(canEditDirection(episode)).toBe(true);
    expect(canEditDirection({ ...episode, status: "script_review", step: "script", stepState: "done" })).toBe(true);
    expect(canEditDirection({ ...episode, status: "failed", step: "script", stepState: "failed" })).toBe(true);
    expect(canEditDirection({ ...episode, status: "failed", step: "voice", stepState: "failed" })).toBe(false);
    expect(canEditDirection({ ...episode, status: "approved" })).toBe(false);
    expect(canEditDirection({ ...episode, step: "script", stepState: "running" })).toBe(false);
    expect(canEditDirection({ ...episode, route: "music" })).toBe(false);
  });
});

describe.skipIf(!testDatabaseUrl)("대본 방향 (실제 DB)", () => {
  let drop: () => Promise<void>;

  beforeAll(async () => {
    const schema = await createMigratedSchema("direction");
    drop = schema.drop;
    process.env.DATABASE_URL = schema.url;
  });

  afterAll(async () => {
    const { getPool } = await import("@/lib/db");
    await getPool().end();
    await drop();
  });

  it("에피소드에 저장하고 대본 생성 프롬프트에 보낸다. 승인 뒤에는 바꾸지 않는다", async () => {
    const { createEpisode, getEpisode, setScriptDirection } = await import("@/pipeline/episodes");
    const { runScriptStep } = await import("@/pipeline/steps/script");
    const { query } = await import("@/lib/db");
    await expect(createEpisode({ topic: "a", outline: "", scriptDirection: "가".repeat(501) })).rejects.toThrow("500자");
    const episode = await createEpisode({ topic: "PDRN", outline: "", scriptDirection: "  유쾌하게  " });
    expect(episode.scriptDirection).toBe("유쾌하게");
    expect((await createEpisode({ topic: "기본", outline: "" })).scriptDirection).toBe("");

    await setScriptDirection(episode.id, "차분하고 진지하게");
    let prompt = "";
    await runScriptStep((await getEpisode(episode.id))!, {
      send: async (params) => {
        prompt = String(params.messages[0].content);
        return {
          id: "m",
          type: "message",
          role: "assistant",
          model: "claude-haiku-5-5",
          stop_reason: "tool_use",
          content: [{ type: "tool_use", id: "tu", name: "submit_script", input: validSubmission() }],
          usage: { input_tokens: 10, output_tokens: 5 },
        } as unknown as Anthropic.Beta.Messages.BetaMessage;
      },
    });
    expect(prompt).toContain("차분하고 진지하게");

    await query("update episodes set status = 'approved' where id = $1", [episode.id]);
    await expect(setScriptDirection(episode.id, "바꿈")).rejects.toThrow("승인하기 전에만");
    expect((await getEpisode(episode.id))?.scriptDirection).toBe("차분하고 진지하게");
  });
});
