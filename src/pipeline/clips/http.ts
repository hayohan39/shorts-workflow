import type { ClipSourceId } from "@/pipeline/clips/types";

// 소스 API 공통 요청. 공식 API 만 쓰고(스크래핑 안 함), 각 소스의 예절을 지킨다.
//   - 연락처가 들어간 User-Agent(Wikimedia·Internet Archive 정책)
//   - 429·503 은 Retry-After 만큼(없으면 2·4·8초) 기다렸다가 다시 시도, 그래도 안 되면 RateLimitError
//   - 요청마다 상태 코드를 onResponse 로 알려 호출 수·마지막 429 를 기록할 수 있게 한다

export const USER_AGENT = "shorts-workflow/0.1 (+https://github.com/hayohan39/shorts-workflow)";
const MAX_RETRIES = 3;
const MAX_WAIT_MS = 60_000;

export class RateLimitError extends Error {
  constructor(
    readonly source: ClipSourceId,
    /** 다시 시도해도 되는 시각 */
    readonly retryAt: Date,
  ) {
    super(`${source} 요청 한도에 걸렸습니다. ${retryAt.toISOString()} 이후 다시 시도하세요.`);
    this.name = "RateLimitError";
  }
}

export interface RequestOptions {
  source: ClipSourceId;
  fetchImpl?: typeof fetch;
  headers?: Record<string, string>;
  sleep?: (ms: number) => Promise<void>;
  onResponse?: (status: number) => void;
}

/** 대기 시간(ms). Retry-After 는 초 또는 HTTP 날짜. */
export function retryDelayMs(retryAfter: string | null, attempt: number, now = Date.now()): number {
  const seconds = Number(retryAfter);
  if (retryAfter && Number.isFinite(seconds)) return Math.min(seconds * 1000, MAX_WAIT_MS);
  const date = retryAfter ? Date.parse(retryAfter) : NaN;
  if (Number.isFinite(date)) return Math.min(Math.max(date - now, 0), MAX_WAIT_MS);
  return 2_000 * 2 ** attempt;
}

export async function fetchSource(url: string, options: RequestOptions): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; ; attempt++) {
    const response = await fetchImpl(url, {
      headers: { "user-agent": USER_AGENT, accept: "application/json", ...options.headers },
    });
    options.onResponse?.(response.status);
    if (response.status !== 429 && response.status !== 503) return response;
    const waitMs = retryDelayMs(response.headers.get("retry-after"), attempt);
    if (attempt >= MAX_RETRIES - 1) throw new RateLimitError(options.source, new Date(Date.now() + waitMs));
    await sleep(waitMs);
  }
}

/** JSON 응답. 실패 상태는 응답 앞부분을 붙여 에러로. */
export async function fetchSourceJson<T>(url: string, options: RequestOptions): Promise<T> {
  const response = await fetchSource(url, options);
  if (!response.ok) {
    const body = (await response.text()).slice(0, 200);
    throw new Error(`${options.source} 요청 실패 (HTTP ${response.status}): ${body}`);
  }
  return (await response.json()) as T;
}

/**
 * 항목 하나의 세부 정보 요청(NASA·Internet Archive). 그 항목만 실패하면 건너뛰도록 null 을 돌려준다.
 * 요청 한도(RateLimitError)는 그 소스 전체를 멈춰야 하므로 그대로 던진다.
 */
export async function skipOnError<T>(request: () => Promise<T>): Promise<T | null> {
  try {
    return await request();
  } catch (error) {
    if (error instanceof RateLimitError) throw error;
    console.warn(error instanceof Error ? error.message : String(error));
    return null;
  }
}
