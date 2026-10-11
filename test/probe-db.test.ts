import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMigratedSchema, testDatabaseUrl } from "./helpers/db";

describe.skipIf(!testDatabaseUrl)("모델 조회·설정 (실제 DB)", () => {
  let drop: () => Promise<void>;

  beforeAll(async () => {
    const schema = await createMigratedSchema("probe");
    drop = schema.drop;
    process.env.DATABASE_URL = schema.url;
  });

  afterAll(async () => {
    const { getPool } = await import("@/lib/db");
    await getPool().end();
    await drop();
  });

  it("조회 요청 → 시작 → 완료, 진행 중에는 중복 요청을 받지 않는다", async () => {
    const { finishProbe, latestSuccessfulProbe, requestProbe, startProbe } = await import("@/pipeline/probe");
    const requested = await requestProbe();
    expect(requested).toMatchObject({ state: "pending" });
    expect(await requestProbe()).toBeNull();

    const started = await startProbe("https://example.test/run/9");
    expect(started).toMatchObject({ id: requested!.id, state: "running", runUrl: "https://example.test/run/9" });

    await finishProbe(started.id, {
      tools: [{ name: "list_models" }],
      listings: { list_models: [{ model_id: "m", name: "M" }] },
      models: [{ id: "m", label: "M", kind: null, credits: null, source: "list_models" }],
    });
    expect(await latestSuccessfulProbe()).toMatchObject({ id: started.id, state: "done", models: [{ id: "m" }] });
    expect(await requestProbe()).toMatchObject({ state: "pending" });
  });

  it("실패를 기록하고, 직접 실행(대기 없음)이면 새 행을 만든다", async () => {
    const { failProbe, latestProbe, startProbe } = await import("@/pipeline/probe");
    await failProbe("중단됨");
    expect(await latestProbe()).toMatchObject({ state: "failed", error: "중단됨" });
    expect(await failProbe("또 실패")).toBeNull();

    const direct = await startProbe(null);
    expect(direct).toMatchObject({ state: "running" });
    await failProbe("MCP 요청 실패: 401 postgres://u:secret@h/db", direct.id);
    const latest = await latestProbe();
    expect(latest?.error).toContain("postgres://***");
    expect(latest?.error).not.toContain("secret");
  });

  it("list_ 로 시작하고 필수 인자가 없는 도구만 부르고, 하나가 실패해도 계속한다", async () => {
    const { collectCatalog } = await import("@/pipeline/probe");
    const called: string[] = [];
    const result = await collectCatalog({
      listTools: async () => [
        { name: "list_models" },
        { name: "list_voices", inputSchema: { required: [] } },
        { name: "list_jobs", inputSchema: { required: ["since"] } },
        { name: "media_forge_generate" },
      ],
      callTool: async (name: string) => {
        called.push(name);
        if (name === "list_voices") throw new Error("권한 없음");
        return { models: [{ model_id: "kling", name: "Kling", type: "video" }] };
      },
    });
    expect(called).toEqual(["list_models", "list_voices"]);
    expect(result.listings.list_voices).toEqual({ error: "권한 없음" });
    expect(result.models.map((m) => m.id)).toEqual(["kling"]);
  });

  it("설정 저장: 빈 값은 미설정, 한도는 양의 정수만", async () => {
    const { getSettings, updateSettings } = await import("@/pipeline/settings");
    const base = { videoModel: " kling ", imageModel: "", voiceModel: "el-v3", voice: "v-ko-1", monthlyCreditLimit: "3500" };
    expect(await updateSettings(base)).toMatchObject({
      videoModel: "kling",
      imageModel: null,
      voiceModel: "el-v3",
      voice: "v-ko-1",
      monthlyCreditLimit: 3500,
    });
    await expect(updateSettings({ ...base, monthlyCreditLimit: "0" })).rejects.toThrow(RangeError);
    await expect(updateSettings({ ...base, monthlyCreditLimit: "1.5" })).rejects.toThrow(RangeError);
    await expect(updateSettings({ ...base, voice: "x".repeat(201) })).rejects.toThrow(RangeError);
    expect((await getSettings()).monthlyCreditLimit).toBe(3500);
  });
});
