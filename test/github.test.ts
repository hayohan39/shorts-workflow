import { describe, expect, it, vi } from "vitest";
import { createDispatcher, createWorkflowDispatcher, dispatchAvailability, DispatchUnavailableError } from "@/lib/github";

const production = { VERCEL_ENV: "production", GITHUB_DISPATCH_TOKEN: "github_pat_test" };

describe("Actions 실행 요청", () => {
  it("프로덕션 + 토큰이 있을 때만 보낸다", () => {
    expect(dispatchAvailability(production)).toMatchObject({ ok: true });
    expect(dispatchAvailability({ ...production, VERCEL_ENV: "preview" })).toMatchObject({ ok: false });
    expect(dispatchAvailability({ GITHUB_DISPATCH_TOKEN: "x" })).toMatchObject({ ok: false });
    expect(dispatchAvailability({ VERCEL_ENV: "production" })).toMatchObject({
      ok: false,
      reason: expect.stringContaining("GITHUB_DISPATCH_TOKEN"),
    });
  });

  it("pipeline.yml 을 main 에서 단계·에피소드 입력으로 실행한다", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    await createDispatcher(production, fetchMock)("script", 7);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.github.com/repos/hayohan39/shorts-workflow/actions/workflows/pipeline.yml/dispatches");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer github_pat_test");
    expect(JSON.parse(String(init.body))).toEqual({ ref: "main", inputs: { step: "script", episode_id: "7" } });
  });

  it("실패하면 상태 코드와 메시지를 담되 토큰은 담지 않는다", async () => {
    const fetchMock = vi.fn(async () => Response.json({ message: "Bad credentials" }, { status: 401 }));
    const error = await createDispatcher(production, fetchMock)("render", 1).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("401 Bad credentials");
    expect((error as Error).message).toContain("토큰 권한");
    expect((error as Error).message).not.toContain("github_pat_test");
  });

  it("프리뷰에서는 요청 자체를 보내지 않는다", async () => {
    const fetchMock = vi.fn();
    await expect(createDispatcher({ VERCEL_ENV: "preview", GITHUB_DISPATCH_TOKEN: "x" }, fetchMock)("script", 1)).rejects.toThrow(
      DispatchUnavailableError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("모델 조회는 에피소드 없이 probe 로 실행한다", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    await createWorkflowDispatcher(production, fetchMock)({ step: "probe", episode_id: "" });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ ref: "main", inputs: { step: "probe", episode_id: "" } });
  });
});
