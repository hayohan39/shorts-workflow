import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createMigratedSchema, testDatabaseUrl } from "./helpers/db";

// 대시보드에서 단계를 시작시키는 흐름(triggerStep)과 크레딧 집계를 실제 DB 로 확인한다.
describe.skipIf(!testDatabaseUrl)("대시보드 실행 요청 (실제 DB)", () => {
  let drop: () => Promise<void>;

  beforeAll(async () => {
    const schema = await createMigratedSchema("dash");
    drop = schema.drop;
    process.env.DATABASE_URL = schema.url;
  });

  afterAll(async () => {
    const { getPool } = await import("@/lib/db");
    await getPool().end();
    await drop();
  });

  it("요청하면 대기 상태가 되고 Actions 실행을 요청한다", async () => {
    const { createEpisode } = await import("@/pipeline/episodes");
    const { triggerStep } = await import("@/pipeline/trigger");
    const episode = await createEpisode({ topic: "요청", outline: "" });
    const dispatch = vi.fn(async () => {});
    expect(await triggerStep(episode.id, "script", dispatch)).toMatchObject({ step: "script", stepState: "pending" });
    expect(dispatch).toHaveBeenCalledWith("script", episode.id);
  });

  it("실행 요청이 실패하면 실패로 기록해 다시 시도할 수 있게 한다", async () => {
    const { createEpisode } = await import("@/pipeline/episodes");
    const { runnableStep, triggerStep } = await import("@/pipeline/trigger");
    const episode = await createEpisode({ topic: "요청 실패", outline: "" });
    const failed = await triggerStep(episode.id, "script", async () => {
      throw new Error("GitHub 실행 요청 실패: 401 Bad credentials");
    });
    expect(failed).toMatchObject({ status: "failed", error: "GitHub 실행 요청 실패: 401 Bad credentials" });
    expect(runnableStep(failed)).toBe("script");
  });

  it("오래 멈춘 대기는 중단 처리하고 다시 요청한다", async () => {
    const { createEpisode, requestStep } = await import("@/pipeline/episodes");
    const { isStale, runnableStep, STALE_AFTER_MS, triggerStep } = await import("@/pipeline/trigger");
    const episode = await createEpisode({ topic: "멈춤", outline: "" });
    const pending = await requestStep(episode.id, "script");
    const later = pending.updatedAt.getTime() + STALE_AFTER_MS.pending + 1000;

    expect(isStale(pending)).toBe(false);
    expect(runnableStep(pending)).toBeNull();
    expect(isStale(pending, later)).toBe(true);
    expect(runnableStep(pending, later)).toBe("script");

    const dispatch = vi.fn(async () => {});
    expect(await triggerStep(episode.id, "script", dispatch, later)).toMatchObject({
      status: "queued",
      stepState: "pending",
    });
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it("진행 중인 단계가 있으면 새로 요청하지 않는다", async () => {
    const { createEpisode, requestStep } = await import("@/pipeline/episodes");
    const { triggerStep } = await import("@/pipeline/trigger");
    const { TransitionError } = await import("@/pipeline/status");
    const episode = await createEpisode({ topic: "중복", outline: "" });
    await requestStep(episode.id, "script");
    const dispatch = vi.fn(async () => {});
    await expect(triggerStep(episode.id, "script", dispatch)).rejects.toThrow(TransitionError);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("이번 달 크레딧과 월 한도", async () => {
    const { query } = await import("@/lib/db");
    const { createEpisode } = await import("@/pipeline/episodes");
    const { monthlyCredits } = await import("@/pipeline/credits");
    const episode = await createEpisode({ topic: "크레딧", outline: "" });
    await query(
      `insert into assets (episode_id, kind, credits, created_at) values
         ($1, 'video', 105, now()), ($1, 'image', 23, now()), ($1, 'voice', 75, now() - interval '40 days')`,
      [episode.id],
    );
    expect(await monthlyCredits()).toEqual({ used: 128, limit: 4000 });
  });
});
