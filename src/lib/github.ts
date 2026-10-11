import type { Step } from "@/pipeline/status";

// 대시보드 버튼 → GitHub Actions(pipeline.yml) 실행 요청.
// docs/decisions.md "대시보드에서 모든 작업 진행" 참고.

const REPO = "hayohan39/shorts-workflow";
const WORKFLOW = "pipeline.yml";

type Env = Record<string, string | undefined>;

export type DispatchAvailability = { ok: true; token: string } | { ok: false; reason: string };

/**
 * 실행 요청을 보낼 수 있는가.
 * 프로덕션에서만 보낸다: 프리뷰는 복제 DB 를 쓰는데 Actions 는 프로덕션 DB 를 보므로,
 * 프리뷰에서 보내면 엉뚱한 에피소드가 처리된다.
 */
export function dispatchAvailability(env: Env = process.env): DispatchAvailability {
  if (env.VERCEL_ENV !== "production") {
    return { ok: false, reason: "프리뷰·로컬 화면에서는 작업을 실행하지 않습니다. 프로덕션 대시보드에서 실행하세요." };
  }
  if (!env.GITHUB_DISPATCH_TOKEN) {
    return { ok: false, reason: "GITHUB_DISPATCH_TOKEN 환경변수가 설정되지 않았습니다." };
  }
  return { ok: true, token: env.GITHUB_DISPATCH_TOKEN };
}

export class DispatchUnavailableError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "DispatchUnavailableError";
  }
}

export type Dispatcher = (step: Step, episodeId: number) => Promise<void>;

export function createDispatcher(env: Env = process.env, fetchImpl: typeof fetch = fetch): Dispatcher {
  return async (step, episodeId) => {
    const availability = dispatchAvailability(env);
    if (!availability.ok) throw new DispatchUnavailableError(availability.reason);

    const response = await fetchImpl(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${availability.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: "main", inputs: { step, episode_id: String(episodeId) } }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      const hint = response.status === 401 || response.status === 403 ? " (토큰 권한·만료를 확인하세요)" : "";
      throw new Error(`GitHub 실행 요청 실패: ${response.status} ${body?.message ?? response.statusText}${hint}`);
    }
  };
}
