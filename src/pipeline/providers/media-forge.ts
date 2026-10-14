import type { McpClient } from "@/pipeline/providers/mcp";
import { waitForJob, type PollOptions } from "@/pipeline/providers/poll";

// ManyMotions Media Forge 생성(MCP 도구). 2026-10-14 실측 응답:
//   media_forge_generate → { job_id, status: "processing", model, credits_consumed, poll_with: "job_status" }
//   job_status → { job_id, status: "processing" | "completed" | "failed", type, result, error }
//     이미지: result.images = ["/api/media-forge/asset/<job>/image-0.jpg"], 영상: result.video (도구 설명 기준)
// 작업은 ManyMotions 서버 메모리에만 있어 재배포 때 사라질 수 있다(job_not_found) → 부르는 쪽이 다시 요청한다.

export type MediaType = "image" | "video";

export class JobLostError extends Error {
  constructor(jobId: string) {
    super(`생성 작업(${jobId})이 ManyMotions 에서 사라졌습니다.`);
    this.name = "JobLostError";
  }
}

export async function submitMedia(
  client: Pick<McpClient, "callTool">,
  input: { type: MediaType; modelId: string; params: Record<string, unknown> },
): Promise<{ jobId: string; credits: number }> {
  const reply = (await client.callTool("media_forge_generate", {
    type: input.type,
    model_id: input.modelId,
    params: input.params,
  })) as { job_id?: string; credits_consumed?: number };
  if (!reply.job_id) throw new Error(`생성 요청이 job_id 없이 끝났습니다: ${JSON.stringify(reply).slice(0, 200)}`);
  return { jobId: reply.job_id, credits: Number(reply.credits_consumed ?? 0) };
}

interface JobStatus {
  status?: string;
  result?: { video?: string | { url?: string }; images?: (string | { url?: string })[] } | null;
  error?: unknown;
}

function resultUrl(type: MediaType, result: JobStatus["result"]): string | null {
  const value = type === "video" ? result?.video : result?.images?.[0];
  if (typeof value === "string") return value;
  return value?.url ?? null;
}

/** 작업이 끝날 때까지 기다려 결과 파일 주소를 돌려준다. */
export async function waitForMedia(
  client: Pick<McpClient, "callTool">,
  type: MediaType,
  jobId: string,
  poll?: PollOptions,
): Promise<string> {
  return waitForJob<string>(async () => {
    let status: JobStatus;
    try {
      status = (await client.callTool("job_status", { job_id: jobId })) as JobStatus;
    } catch (error) {
      if (/job_not_found|not.found/i.test(error instanceof Error ? error.message : String(error))) {
        throw new JobLostError(jobId);
      }
      throw error;
    }
    if (status.status === "completed") {
      const url = resultUrl(type, status.result);
      if (!url) throw new Error(`생성은 끝났지만 결과 주소가 없습니다: ${JSON.stringify(status.result).slice(0, 200)}`);
      return { done: true, value: url };
    }
    if (status.status === "failed" || status.status === "cancelled") {
      throw new Error(`생성 실패(크레딧은 자동 환불): ${String(status.error ?? status.status).slice(0, 300)}`);
    }
    if (/not.found/i.test(String(status.error ?? ""))) throw new JobLostError(jobId);
    return { done: false };
  }, poll);
}
