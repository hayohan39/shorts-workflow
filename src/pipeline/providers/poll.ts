// 비동기 생성 작업(job)을 완료될 때까지 확인한다. 간격을 점점 늘리고 전체 시간에 상한을 둔다.

export type JobPoll<T> = { done: true; value: T } | { done: false };

export interface PollOptions {
  initialDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export class JobTimeoutError extends Error {
  constructor(seconds: number) {
    super(`생성 작업이 ${seconds}초 안에 끝나지 않았습니다.`);
    this.name = "JobTimeoutError";
  }
}

export async function waitForJob<T>(check: () => Promise<JobPoll<T>>, options: PollOptions = {}): Promise<T> {
  const {
    initialDelayMs = 3_000,
    maxDelayMs = 20_000,
    timeoutMs = 15 * 60_000,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now = Date.now,
  } = options;
  const deadline = now() + timeoutMs;
  let delay = initialDelayMs;
  for (;;) {
    const result = await check();
    if (result.done) return result.value;
    if (now() + delay > deadline) throw new JobTimeoutError(Math.round(timeoutMs / 1000));
    await sleep(delay);
    delay = Math.min(Math.round(delay * 1.5), maxDelayMs);
  }
}
