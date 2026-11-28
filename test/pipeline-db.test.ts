import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMigratedSchema, testDatabaseUrl } from "./helpers/db";

const run = promisify(execFile);

// 테스트 전용 스키마에 실제 마이그레이션을 적용하고 그 위에서 파이프라인 DB 코드를 검증한다.
describe.skipIf(!testDatabaseUrl)("파이프라인 DB (실제 DB)", () => {
  let schemaUrl = "";
  let drop: () => Promise<void>;

  beforeAll(async () => {
    ({ url: schemaUrl, drop } = await createMigratedSchema("pl"));
    process.env.DATABASE_URL = schemaUrl;
  });

  afterAll(async () => {
    const { getPool } = await import("@/lib/db");
    await getPool().end();
    await drop();
  });

  it("설정 기본값 한 행이 있다", async () => {
    const { query } = await import("@/lib/db");
    const rows = await query<{ monthly_credit_limit: number; upload_days: number[] }>(
      "select monthly_credit_limit, upload_days from settings",
    );
    expect(rows).toEqual([{ monthly_credit_limit: 4000, upload_days: [2, 5] }]);
  });

  it("에피소드를 만들고 조회한다", async () => {
    const { createEpisode, getEpisode, listEpisodes } = await import("@/pipeline/episodes");
    const created = await createEpisode({ topic: "  PDRN  ", outline: "소개 → 효과" });
    expect(created).toMatchObject({ topic: "PDRN", status: "queued", step: null, creditsUsed: 0 });
    expect(await getEpisode(created.id)).toMatchObject({ id: created.id });
    expect((await listEpisodes()).map((e) => e.id)).toContain(created.id);
    await expect(createEpisode({ topic: " ", outline: "" })).rejects.toThrow("주제를 입력하세요");
  });

  it("단계 요청 → 실행 → 완료, 그리고 승인", async () => {
    const { createEpisode, requestStep, decide } = await import("@/pipeline/episodes");
    const { runStep } = await import("@/pipeline/runner");
    const episode = await createEpisode({ topic: "흐름", outline: "" });

    expect(await requestStep(episode.id, "script")).toMatchObject({ step: "script", stepState: "pending" });
    let seen: number | undefined;
    const result = await runStep(episode.id, "script", {
      runUrl: "https://example.test/run/1",
      handlers: { script: async (e) => void (seen = e.id) },
    });
    expect(seen).toBe(episode.id);
    expect(result).toMatchObject({
      ok: true,
      episode: { status: "script_review", stepState: "done", runUrl: "https://example.test/run/1" },
    });
    expect(await decide(episode.id, "approve-script")).toMatchObject({ status: "approved" });
  });

  it("실행 중에는 진행 메모와 시작 시각이 남고, 끝나면 메모를 지운다", async () => {
    const { createEpisode, getEpisode, reportProgress, requestStep } = await import("@/pipeline/episodes");
    const { runStep } = await import("@/pipeline/runner");
    const episode = await createEpisode({ topic: "진행", outline: "" });

    const requested = await requestStep(episode.id, "script");
    expect(requested.stepStartedAt).toBeInstanceOf(Date);
    // 실행 중이 아니면 메모를 받지 않는다(늦게 온 메모가 다음 단계에 섞이지 않게).
    expect(await reportProgress(episode.id, "script", "대기 중 메모")).toBe(false);

    let during: string | null = null;
    const result = await runStep(episode.id, "script", {
      runUrl: null,
      handlers: {
        script: async (_e, context) => {
          await context.progress("자료 조사 중 · 웹 검색 1회 sk-ant-api03-secret");
          during = (await getEpisode(episode.id))!.stepProgress;
        },
      },
    });
    expect(during).toContain("자료 조사 중");
    expect(during).not.toContain("secret");
    expect(result.episode).toMatchObject({ status: "script_review", stepProgress: null });
    expect(await reportProgress(episode.id, "script", "끝난 뒤 메모")).toBe(false);
  });

  it("작업이 실패하면 failed + 에러, 다시 시도하면 그 단계부터", async () => {
    const { createEpisode, requestStep } = await import("@/pipeline/episodes");
    const { runStep } = await import("@/pipeline/runner");
    const episode = await createEpisode({ topic: "실패", outline: "" });

    const result = await runStep(episode.id, "script", {
      runUrl: null,
      handlers: {
        script: async () => {
          throw new Error("연결 실패 postgres://user:secret@host/db");
        },
      },
    });
    expect(result.ok).toBe(false);
    expect(result.episode).toMatchObject({ status: "failed", step: "script", stepState: "failed" });
    expect(result.episode.error).toContain("postgres://***");
    expect(result.episode.error).not.toContain("secret");

    expect(await requestStep(episode.id, "script")).toMatchObject({
      status: "queued",
      stepState: "pending",
      error: null,
    });
  });

  it("구현되지 않은 단계는 실패로 기록된다", async () => {
    const { createEpisode } = await import("@/pipeline/episodes");
    const { runStep } = await import("@/pipeline/runner");
    const episode = await createEpisode({ topic: "미구현", outline: "" });
    const result = await runStep(episode.id, "script", { runUrl: null, handlers: {} });
    expect(result).toMatchObject({ ok: false, error: "대본 생성 단계는 아직 구현되지 않았습니다." });
  });

  it("시작할 수 없는 상태면 아무것도 기록하지 않는다", async () => {
    const { createEpisode, getEpisode } = await import("@/pipeline/episodes");
    const { runStep } = await import("@/pipeline/runner");
    const { TransitionError } = await import("@/pipeline/status");
    const episode = await createEpisode({ topic: "순서", outline: "" });
    await expect(runStep(episode.id, "upload", { runUrl: null, handlers: {} })).rejects.toThrow(TransitionError);
    expect(await getEpisode(episode.id)).toMatchObject({ status: "queued", step: null, error: null });
  });

  it("실행 중이 아닌 단계의 실패 보고는 무시한다", async () => {
    const { createEpisode, failStep } = await import("@/pipeline/episodes");
    const episode = await createEpisode({ topic: "무시", outline: "" });
    expect(await failStep(episode.id, "script", "늦게 온 실패")).toMatchObject({ status: "queued", error: null });
  });

  it("같은 단계를 동시에 두 번 요청하면 한 번만 받는다", async () => {
    const { createEpisode, requestStep } = await import("@/pipeline/episodes");
    const episode = await createEpisode({ topic: "동시", outline: "" });
    const results = await Promise.allSettled([requestStep(episode.id, "script"), requestStep(episode.id, "script")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });

  it("CLI: run 은 결과를 요약에 쓰고 실패하면 종료 코드 1", async () => {
    const { createEpisode, getEpisode } = await import("@/pipeline/episodes");
    const episode = await createEpisode({ topic: "CLI", outline: "" });
    const summaryFile = path.join(os.tmpdir(), `pipeline-summary-${Date.now()}.md`);
    const env = { ...process.env, DATABASE_URL: schemaUrl, RUN_URL: "https://example.test/run/2", GITHUB_STEP_SUMMARY: summaryFile };
    const cli = path.resolve("node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");

    const failed = await run(cli, ["src/pipeline/cli.ts", "run", "script", String(episode.id)], { env }).catch(
      (error: { code: number; stdout: string }) => error,
    );
    expect(failed).toMatchObject({ code: 1 });
    // 대본 단계는 실제 API 키가 필요하다. 테스트 환경에는 없으므로 그 사유로 실패해야 한다.
    expect((failed as { stdout: string }).stdout).toContain("ANTHROPIC_API_KEY 가 없습니다");
    expect(await getEpisode(episode.id)).toMatchObject({ status: "failed", runUrl: "https://example.test/run/2" });

    const { readFile, rm } = await import("node:fs/promises");
    expect(await readFile(summaryFile, "utf8")).toContain(`쇼츠 #${episode.id}`);
    await rm(summaryFile, { force: true });
  }, 30_000);
});
