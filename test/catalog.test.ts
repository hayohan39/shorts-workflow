import { describe, expect, it } from "vitest";
import { countOptions, hasOption, parseModelCatalog } from "@/pipeline/catalog";
import { waitForJob, JobTimeoutError } from "@/pipeline/providers/poll";
import { effectiveModels, recommendedModels, recommendedOption } from "@/pipeline/recommended";
import type { Settings } from "@/pipeline/settings";

// 2026-10 프로덕션 조회 응답의 실제 형태(image)와 도구 설명에 적힌 형태(video)를 따른다.
const listings = {
  list_models: {
    note: "For reference-image + spoken dialogue together, use the video_editor_* tools.",
    image: [
      {
        id: "openai/gpt-image-2.5/flare/text-to-image",
        name: "GPT Image 2.5 Flare",
        category: "generate",
        multi_ref: false,
        max_images: 4,
        resolutions: ["1K"],
        aspect_ratios: ["1:1", "16:9", "9:16", "4:3", "3:4"],
        requires_image: false,
      },
      {
        id: "openai/gpt-image-2.5/flare/edit",
        name: "GPT Image 2.5 Flare Edit",
        category: "edit",
        resolutions: ["1K"],
        aspect_ratios: ["1:1", "9:16"],
        requires_image: true,
      },
      { id: "square/only", name: "Square Only", category: "generate", aspect_ratios: ["1:1"], requires_image: false },
    ],
    video: [
      {
        name: "Kling 3.0 Standard",
        text_to_video: true,
        image_to_video: true,
        t2v_id: "kling/v3/standard/text-to-video",
        i2v_id: "kling/v3/standard/image-to-video",
        durations: [5, 10],
        aspect_ratios: ["16:9", "9:16", "1:1"],
      },
      { name: "Image Only", text_to_video: false, image_to_video: true, i2v_id: "x/i2v", durations: ["6"] },
      { id: "flag/only", name: "Flag Only", text_to_video: true, durations: ["6s", "8s"] },
    ],
    audio: [{ id: "elevenlabs/v3/tts", name: "ElevenLabs v3", category: "tts" }],
    upscale: [{ id: "topaz/upscale", name: "Topaz" }],
  },
};

describe("모델 목록 분류", () => {
  it("영상은 텍스트→영상 ID 로, 이미지는 생성용만, 음성·기타는 따로", () => {
    const catalog = parseModelCatalog(listings);
    expect(catalog.video).toEqual([
      {
        id: "kling/v3/standard/text-to-video",
        label: "Kling 3.0 Standard",
        vertical: true,
        fiveSeconds: true,
        detail: "5/10초 · 이미지→영상 가능",
      },
      { id: "flag/only", label: "Flag Only", vertical: null, fiveSeconds: false, detail: "6/8초" },
    ]);
    expect(catalog.image.map((o) => [o.id, o.vertical])).toEqual([
      ["openai/gpt-image-2.5/flare/text-to-image", true],
      ["square/only", false],
    ]);
    expect(catalog.audio.map((o) => o.id)).toEqual(["elevenlabs/v3/tts"]);
    expect(Object.keys(catalog.other)).toEqual(["upscale"]);
    expect(countOptions(catalog)).toBe(6);
    expect(hasOption(catalog.image, "openai/gpt-image-2.5/flare/edit")).toBe(false);
  });

  it("응답이 없거나 형태가 달라도 깨지지 않는다", () => {
    expect(parseModelCatalog(null)).toEqual({ video: [], image: [], audio: [], other: {} });
    expect(parseModelCatalog({ list_models: { error: "401" } })).toEqual({ video: [], image: [], audio: [], other: {} });
  });
});

describe("추천 모델", () => {
  const option = (id: string, label: string, vertical: boolean | null = true, fiveSeconds: boolean | null = true) => ({
    id,
    label,
    vertical,
    fiveSeconds,
    detail: "",
  });

  it("이름으로 추천 모델을 찾고, 없으면 세로·5초를 지원하는 첫 모델", () => {
    const catalog = parseModelCatalog(listings);
    expect(recommendedModels(catalog)).toEqual({
      video: "kling/v3/standard/text-to-video",
      image: "openai/gpt-image-2.5/flare/text-to-image",
      voice: "elevenlabs/v3/tts",
    });
    expect(
      recommendedOption("image", [option("a", "GPT Image"), option("b", "Seedream 4.5"), option("c", "Seedream 5.0")])?.id,
    ).toBe("b");
    // 세로를 못 하면 이름이 맞아도 고르지 않는다.
    expect(recommendedOption("image", [option("b", "Seedream 4.5", false), option("a", "Other")])?.id).toBe("a");
    expect(recommendedOption("video", [option("v", "Kling 3.0 Pro", true, false)])).toBeNull();
    expect(recommendedModels(parseModelCatalog(null))).toEqual({ video: null, image: null, voice: null });
  });

  it("설정에 저장된 값이 있으면 그것을, 없으면 추천 모델을 쓴다", () => {
    const catalog = parseModelCatalog(listings);
    const settings = { videoModel: "my/video", imageModel: null, voiceModel: null } as Settings;
    expect(effectiveModels(settings, catalog)).toEqual({
      video: "my/video",
      image: "openai/gpt-image-2.5/flare/text-to-image",
      voice: "elevenlabs/v3/tts",
    });
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
