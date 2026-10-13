import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { narrationInstruction, type VoiceStepDeps } from "@/pipeline/steps/voice";
import { findVoice, VOICES } from "@/pipeline/voices";
import { createMigratedSchema, testDatabaseUrl } from "./helpers/db";
import { validSubmission } from "./helpers/script";

describe("내레이션 지시문", () => {
  it("목소리 ID·모델·대본 전체를 넣고, 다른 생성은 막는다", () => {
    const text = narrationInstruction(VOICES[0], "eleven_v3", "첫 문장. 둘째 문장.");
    expect(text).toContain(`voice_id ${VOICES[0].id}`);
    expect(text).toContain("eleven_v3");
    expect(text).toContain('"""첫 문장. 둘째 문장."""');
    expect(text).toContain("영상·이미지·음악·효과음은 만들지 마세요");
    expect(findVoice("없는-id")).toBeNull();
  });
});

describe.skipIf(!testDatabaseUrl)("내레이션 생성 (실제 DB, 가짜 ManyMotions·Blob)", () => {
  let drop: () => Promise<void>;

  beforeAll(async () => {
    const schema = await createMigratedSchema("voice");
    drop = schema.drop;
    process.env.DATABASE_URL = schema.url;
  });

  afterAll(async () => {
    const { getPool } = await import("@/lib/db");
    await getPool().end();
    await drop();
  });

  async function approvedEpisode(topic: string) {
    const { query } = await import("@/lib/db");
    const { createEpisode, getEpisode } = await import("@/pipeline/episodes");
    const { saveScript } = await import("@/pipeline/scripts");
    const { toDraft } = await import("@/pipeline/script/schema");
    const episode = await createEpisode({ topic, outline: "" });
    await saveScript(episode.id, toDraft(validSubmission()), { source: "generated", warnings: [], model: null, usage: null });
    await query("update episodes set status = 'approved' where id = $1", [episode.id]);
    return (await getEpisode(episode.id))!;
  }

  function fakeDeps(options: { replies: object[]; balances?: (number | null)[] }) {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const replies = [...options.replies];
    const balances = [...(options.balances ?? [4500, 4420])];
    const uploads: { pathname: string; bytes: number; contentType: string }[] = [];
    const deps: VoiceStepDeps = {
      editor: {
        callTool: async (name, args = {}) => {
          calls.push({ name, args });
          if (name === "video_editor_create_project") return { project_id: "vp_test" };
          return replies.shift() ?? { assistant_text: "더 이상 응답 없음", assets_created: [] };
        },
      },
      readBalance: async () => balances.shift() ?? null,
      put: async (pathname, body, contentType) => {
        uploads.push({ pathname, bytes: body.length, contentType });
        return { url: `https://blob.example/${pathname}` };
      },
      fetchImpl: (async () =>
        new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/mpeg" } })) as unknown as typeof fetch,
      authHeaders: { Authorization: "Bearer test" },
    };
    return { deps, calls, uploads };
  }

  const audioReply = {
    assistant_text: "내레이션 음성을 생성했습니다.",
    assets_created: [{ id: "va_1", kind: "audio", url: "https://v3b.fal.media/files/x/output.mp3" }],
  };

  it("고른 목소리로 만들고 Blob 에 옮긴 뒤 실제 차감액과 함께 저장한다", async () => {
    const { setVoiceSelection, getEpisode } = await import("@/pipeline/episodes");
    const { runVoiceStep } = await import("@/pipeline/steps/voice");
    const { listAssets, voiceSamples } = await import("@/pipeline/assets");
    const episode = await approvedEpisode("내레이션");
    const voice = VOICES[4];
    await setVoiceSelection(episode.id, voice.id, "eleven_multilingual_v2");

    // 첫 응답이 확인 질문이면 한 번 더 지시한다.
    const { deps, calls, uploads } = fakeDeps({
      replies: [{ assistant_text: "진행할까요?", assets_created: [] }, audioReply],
    });
    const notes: string[] = [];
    const result = await runVoiceStep((await getEpisode(episode.id))!, { deps, progress: async (n) => void notes.push(n) });

    expect(result.credits).toBe(80);
    expect(calls.map((c) => c.name)).toEqual(["video_editor_create_project", "video_editor_instruct", "video_editor_instruct"]);
    expect(String(calls[1].args.instruction)).toContain(`voice_id ${voice.id}`);
    expect(String(calls[1].args.instruction)).toContain("eleven_multilingual_v2");
    expect(uploads).toEqual([{ pathname: `episodes/${episode.id}/narration-${voice.id}.mp3`, bytes: 3, contentType: "audio/mpeg" }]);
    expect(notes.at(-1)).toBe("내레이션 저장 · 80크레딧");

    const [asset] = await listAssets(episode.id, "voice");
    expect(asset).toMatchObject({
      kind: "voice",
      model: "eleven_multilingual_v2",
      credits: 80,
      mmJobId: "va_1",
      url: `https://blob.example/episodes/${episode.id}/narration-${voice.id}.mp3`,
    });
    expect(asset.meta).toMatchObject({ voiceId: voice.id, voiceName: voice.name, creditsEstimated: false, projectId: "vp_test" });
    expect((await voiceSamples())[voice.id]?.url).toBe(asset.url);

    // 이번 달 사용 크레딧에 반영된다.
    const { monthlyCredits } = await import("@/pipeline/credits");
    expect((await monthlyCredits()).used).toBe(80);
  });

  it("잔액을 못 읽으면 추정값으로 적고, 음성을 못 받으면 실패한다", async () => {
    const { runVoiceStep } = await import("@/pipeline/steps/voice");
    const { listAssets } = await import("@/pipeline/assets");
    const episode = await approvedEpisode("추정");

    const estimated = fakeDeps({ replies: [audioReply], balances: [null, null] });
    expect((await runVoiceStep(episode, { deps: estimated.deps })).credits).toBe(80);
    expect((await listAssets(episode.id, "voice"))[0].meta).toMatchObject({ creditsEstimated: true });

    const silent = fakeDeps({ replies: [{ assistant_text: "어떤 목소리를 쓸까요?" }, { assistant_text: "확인해 주세요" }] });
    await expect(runVoiceStep(episode, { deps: silent.deps })).rejects.toThrow("내레이션 음성을 받지 못했습니다. 에이전트 답: 확인해 주세요");
  });

  it("이번 달 크레딧 한도를 넘으면 시작하지 않는다", async () => {
    const { query } = await import("@/lib/db");
    const { runVoiceStep } = await import("@/pipeline/steps/voice");
    const episode = await approvedEpisode("한도");
    await query("update settings set monthly_credit_limit = 100");
    const { deps, calls } = fakeDeps({ replies: [audioReply] });
    await expect(runVoiceStep(episode, { deps })).rejects.toThrow("크레딧 한도를 넘습니다");
    expect(calls).toHaveLength(0);
    await query("update settings set monthly_credit_limit = 4000");
  });

  it("설정의 목소리·음성 모델은 목록에 있는 값만 받는다", async () => {
    const { updateSettings } = await import("@/pipeline/settings");
    const base = { scriptModel: "", videoModel: "", imageModel: "", monthlyCreditLimit: "4000" };
    await expect(updateSettings({ ...base, voice: "가짜", voiceModel: "" })).rejects.toThrow("목록에 없는 목소리");
    await expect(updateSettings({ ...base, voice: "", voiceModel: "tts-1" })).rejects.toThrow("목록에 없는 음성 모델");
    expect(await updateSettings({ ...base, voice: VOICES[1].id, voiceModel: "eleven_v3" })).toMatchObject({
      voice: VOICES[1].id,
      voiceModel: "eleven_v3",
    });
  });
});
