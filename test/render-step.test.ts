import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JobLostError } from "@/pipeline/providers/media-forge";
import type { RenderStepDeps } from "@/pipeline/steps/render";
import { createMigratedSchema, testDatabaseUrl } from "./helpers/db";
import { validSubmission } from "./helpers/script";

const listings = {
  list_models: {
    video: [{ name: "Kling 3.0 Standard", t2v_id: "kling/v3/standard/t2v", durations: [5, 10], aspect_ratios: ["9:16"] }],
    image: [{ id: "seedream/4.5/t2i", name: "Seedream 4.5", category: "generate", aspect_ratios: ["9:16"], requires_image: false }],
  },
};

describe.skipIf(!testDatabaseUrl)("장면 생성 (실제 DB, 가짜 Media Forge·Blob)", () => {
  let drop: () => Promise<void>;

  beforeAll(async () => {
    const schema = await createMigratedSchema("render");
    drop = schema.drop;
    process.env.DATABASE_URL = schema.url;
    const { query } = await import("@/lib/db");
    await query("insert into provider_probes (state, tools, listings) values ('done', '[]', $1)", [JSON.stringify(listings)]);
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

  /** prompt 로 장면을 구분하는 가짜 Media Forge. behave(prompt, attempt) 가 결과를 정한다. */
  function fakeDeps(behave: (prompt: string, attempt: number) => "ok" | "lost" | "fail") {
    const submits: { type: string; model_id: string; params: Record<string, unknown> }[] = [];
    const jobs = new Map<string, { type: string; outcome: "ok" | "lost" | "fail"; polls: number }>();
    const attempts = new Map<string, number>();
    const uploads: string[] = [];
    const deps: RenderStepDeps = {
      media: {
        callTool: async (name, args = {}) => {
          if (name === "media_forge_generate") {
            const input = args as { type: string; model_id: string; params: { prompt: string } };
            submits.push(input as never);
            const attempt = (attempts.get(input.params.prompt) ?? 0) + 1;
            attempts.set(input.params.prompt, attempt);
            const jobId = `job-${submits.length}`;
            jobs.set(jobId, { type: input.type, outcome: behave(input.params.prompt, attempt), polls: 0 });
            return { job_id: jobId, status: "processing", credits_consumed: input.type === "video" ? 105 : 23 };
          }
          const job = jobs.get(String(args.job_id))!;
          job.polls++;
          if (job.polls === 1) return { status: "processing", result: null, error: null };
          if (job.outcome === "lost") throw new Error("job_not_found");
          if (job.outcome === "fail") return { status: "failed", result: null, error: "provider error" };
          return job.type === "video"
            ? { status: "completed", result: { video: `https://v3b.fal.media/${args.job_id}.mp4` } }
            : { status: "completed", result: { images: [`/api/media-forge/asset/${args.job_id}/image-0.jpg`] } };
        },
      },
      put: async (pathname) => {
        uploads.push(pathname);
        return { url: `https://blob.example/${pathname}` };
      },
      fetchImpl: (async () => new Response(new Uint8Array([1]), { headers: { "content-type": "image/jpeg" } })) as unknown as typeof fetch,
      headersFor: (url) => (url.startsWith("https://manymotions.com") ? { Authorization: "Bearer k" } : undefined),
      poll: { initialDelayMs: 0, sleep: async () => {} },
    };
    return { deps, submits, uploads };
  }

  it("4장면을 추천 모델로 만들고, 사라진 작업은 한 번 다시 요청한다", async () => {
    const { runRenderStep } = await import("@/pipeline/steps/render");
    const { listAssets } = await import("@/pipeline/assets");
    const { monthlyCredits } = await import("@/pipeline/credits");
    const episode = await approvedEpisode("장면");
    const firstPrompt = validSubmission().scenes[0].prompt;
    const { deps, submits, uploads } = fakeDeps((prompt, attempt) => (prompt === firstPrompt && attempt === 1 ? "lost" : "ok"));

    const notes: string[] = [];
    const result = await runRenderStep(episode, { deps, progress: async (n) => void notes.push(n) });
    expect(result).toEqual({ created: 4, credits: 105 * 2 + 23 * 2 });
    expect(submits).toHaveLength(5);
    const video = submits.find((s) => s.type === "video")!;
    expect(video).toMatchObject({ model_id: "kling/v3/standard/t2v", params: { duration: 5, aspect_ratio: "9:16" } });
    expect(submits.find((s) => s.type === "image")).toMatchObject({ model_id: "seedream/4.5/t2i", params: { count: 1 } });
    expect(uploads.sort()).toEqual([1, 2, 3, 4].map((no) => expect.stringMatching(new RegExp(`^episodes/${episode.id}/scene-${no}\\.`))));
    expect(notes.at(-1)).toBe("장면 4/4 완료 · 256크레딧");

    const assets = await listAssets(episode.id);
    expect(assets.map((a) => a.sceneNo).sort()).toEqual([1, 2, 3, 4]);
    expect(assets.find((a) => a.sceneNo === 1)?.meta).toMatchObject({ scriptVersion: 1, attempts: 2 });
    // 이미지 결과는 ManyMotions 상대 경로 → 절대 주소로 받아 온다.
    expect(assets.find((a) => a.kind === "image")?.meta.sourceUrl).toMatch(/^https:\/\/manymotions\.com\/api\/media-forge\/asset\//);
    expect((await monthlyCredits()).used).toBe(256);

    // 다시 돌려도 이미 만든 장면은 만들지 않는다.
    const again = fakeDeps(() => "ok");
    expect(await runRenderStep(episode, { deps: again.deps })).toEqual({ created: 0, credits: 0 });
    expect(again.submits).toHaveLength(0);
  });

  it("일부가 실패하면 끝난 장면만 저장하고, 다시 시도하면 나머지만 만든다", async () => {
    const { runRenderStep } = await import("@/pipeline/steps/render");
    const { listAssets } = await import("@/pipeline/assets");
    const episode = await approvedEpisode("부분 실패");
    const lastPrompt = validSubmission().scenes[3].prompt;

    const first = fakeDeps((prompt) => (prompt === lastPrompt ? "fail" : "ok"));
    await expect(runRenderStep(episode, { deps: first.deps })).rejects.toThrow(/장면 1개 생성 실패.*\n4번: 생성 실패/);
    expect((await listAssets(episode.id)).map((a) => a.sceneNo).sort()).toEqual([1, 2, 3]);

    const retry = fakeDeps(() => "ok");
    expect(await runRenderStep(episode, { deps: retry.deps })).toMatchObject({ created: 1 });
    expect(retry.submits.map((s) => s.params.prompt)).toEqual([lastPrompt]);
  });

  it("한도를 넘으면 시작하지 않고, 사라진 작업이 두 번이면 실패한다", async () => {
    const { query } = await import("@/lib/db");
    const { runRenderStep } = await import("@/pipeline/steps/render");
    const episode = await approvedEpisode("한도");

    await query("update settings set monthly_credit_limit = 300");
    const blocked = fakeDeps(() => "ok");
    await expect(runRenderStep(episode, { deps: blocked.deps })).rejects.toThrow("크레딧 한도를 넘습니다");
    expect(blocked.submits).toHaveLength(0);
    await query("update settings set monthly_credit_limit = 100000");

    const lost = fakeDeps(() => "lost");
    await expect(runRenderStep(episode, { deps: lost.deps })).rejects.toThrow(new JobLostError("job-5").message);
  });
});
