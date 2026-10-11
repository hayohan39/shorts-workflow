import { describe, expect, it } from "vitest";
import { extractCatalog } from "@/pipeline/catalog";
import { waitForJob, JobTimeoutError } from "@/pipeline/providers/poll";

describe("모델 목록 추출", () => {
  it("여러 형태의 응답에서 ID·이름·종류·크레딧을 뽑는다", () => {
    const items = extractCatalog({
      list_models: {
        models: [
          { model_id: "kling-3.0-standard", name: "Kling 3.0 Standard", type: "video", credits_per_second: 21 },
          { model_id: "seedream-4.5", name: "Seedream 4.5", type: "image", credits: 23 },
        ],
      },
      list_voices: [{ voice_id: "v-ko-1", display_name: "지민", category: "voice" }],
    });
    expect(items).toEqual([
      { id: "kling-3.0-standard", label: "Kling 3.0 Standard", kind: "video", credits: "21", source: "list_models" },
      { id: "seedream-4.5", label: "Seedream 4.5", kind: "image", credits: "23", source: "list_models" },
      { id: "v-ko-1", label: "지민", kind: "voice", credits: null, source: "list_voices" },
    ]);
  });

  it("ID 만 있는 객체(작업 ID 등)와 중복은 넣지 않는다", () => {
    const items = extractCatalog({ a: [{ id: "job-1" }, { id: "m", name: "M" }, { id: "m", name: "중복" }] });
    expect(items.map((i) => i.id)).toEqual(["m"]);
  });

  it("오류 응답이나 문자열이면 빈 목록", () => {
    expect(extractCatalog({ list_models: { error: "401" }, list_x: "text" })).toEqual([]);
  });
});

describe("작업 완료 대기", () => {
  it("완료될 때까지 간격을 늘려 가며 확인한다", async () => {
    const sleeps: number[] = [];
    let n = 0;
    const value = await waitForJob(async () => (++n < 4 ? { done: false } : { done: true, value: "ok" }), {
      initialDelayMs: 1000,
      maxDelayMs: 2000,
      sleep: async (ms) => void sleeps.push(ms),
      now: () => 0,
    });
    expect(value).toBe("ok");
    expect(sleeps).toEqual([1000, 1500, 2000]);
  });

  it("전체 시간을 넘기면 JobTimeoutError", async () => {
    let clock = 0;
    await expect(
      waitForJob(async () => ({ done: false }), {
        initialDelayMs: 1000,
        timeoutMs: 3000,
        sleep: async (ms) => void (clock += ms),
        now: () => clock,
      }),
    ).rejects.toThrow(JobTimeoutError);
  });
});
