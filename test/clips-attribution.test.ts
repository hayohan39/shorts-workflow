import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { probeMedia, runFfmpeg } from "@/pipeline/compose/ffmpeg";
import { buildConvertArgs, clipsToAdopt } from "@/pipeline/clips/adopt";
import { attributionText, buildManifest, hasShareAlike, selectedClips } from "@/pipeline/clips/attribution";
import type { ClipCollection, StoredClip } from "@/pipeline/clips/store";
import { clip } from "./helpers/clips";

function stored(overrides: Partial<StoredClip> = {}): StoredClip {
  return {
    ...clip(),
    id: 1,
    collectionId: 7,
    rank: 1,
    score: 3,
    fetchedAt: new Date("2026-10-16T00:00:00Z"),
    blobUrl: null,
    adoptedAt: null,
    ...overrides,
  };
}

const ccBySa = {
  code: "cc-by-sa" as const,
  name: "CC BY-SA 4.0",
  url: "https://creativecommons.org/licenses/by-sa/4.0/",
  raw: {},
};

describe("출처 표기", () => {
  it("주어진 순서대로 저작자·소스·라이선스·링크를 적는다(선택된 클립만 고르는 건 selectedClips)", () => {
    const text = attributionText(selectedClips([
      stored({ title: "ocean waves", author: "kim", pageUrl: "https://pixabay.com/videos/id-1/" }),
      stored({ id: 2, rank: 2, source: "wikimedia", title: "Sea.webm", author: null, license: ccBySa, pageUrl: "https://w/2" }),
      stored({ id: 3, rank: null, title: "교체 후보" }),
    ]));
    expect(text).toBe(
      [
        "영상 출처",
        '- "ocean waves" / kim / Pixabay / Pixabay Content License / https://pixabay.com/videos/id-1/',
        '- "Sea.webm" / Wikimedia Commons / CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/) / https://w/2',
      ].join("\n"),
    );
    expect(attributionText([])).toBe("");
  });

  it("CC BY-SA 가 섞였는지 표시한다", () => {
    expect(hasShareAlike([stored()])).toBe(false);
    expect(hasShareAlike([stored(), stored({ license: ccBySa })])).toBe(true);
  });

  it("manifest 에 수집 정보·라이선스 스냅샷·파일 주소를 담는다", () => {
    const collection = {
      id: 7,
      topic: "겨울 바다",
      keywords: ["ocean"],
      finishedAt: new Date("2026-10-16T01:00:00Z"),
      totalSeconds: 10,
    } as ClipCollection;
    const manifest = buildManifest(collection, [
      stored({ blobUrl: "https://blob/1.mp4", license: { ...ccBySa, raw: { LicenseShortName: "CC BY-SA 4.0" } } }),
      stored({ id: 2, rank: null }),
    ]);
    expect(manifest).toMatchObject({
      collectionId: 7,
      topic: "겨울 바다",
      collectedAt: "2026-10-16T01:00:00.000Z",
      shareAlike: true,
      clips: [{ rank: 1, file: "https://blob/1.mp4", license: { code: "cc-by-sa", raw: { LicenseShortName: "CC BY-SA 4.0" } } }],
    });
    expect(manifest.clips).toHaveLength(1);
    expect(manifest.attribution).toContain("CC BY-SA 4.0");
  });
});

describe("채택 대상·변환", () => {
  it("선택됐고 받을 파일이 있고 아직 저장하지 않은 클립만", () => {
    const clips = [
      stored({ id: 1 }),
      stored({ id: 2, blobUrl: "https://blob/2.mp4" }),
      stored({ id: 3, rank: null }),
      stored({ id: 4, downloadUrl: null }),
    ];
    expect(clipsToAdopt(clips).map((c) => c.id)).toEqual([1]);
  });

  it("원본 주소에서 쓰는 구간만 읽어 소리 없는 짝수 크기 H.264 mp4 로 바꾼다", () => {
    const args = buildConvertArgs({ url: "https://cdn.test/a.webm", start: 49.8, length: 15 }, "out.mp4");
    expect(args).toEqual(expect.arrayContaining(["-an", "libx264", "yuv420p", "+faststart", "-user_agent"]));
    expect(args.join(" ")).toContain("-ss 49.8 -t 15 -i https://cdn.test/a.webm");
    expect(args.at(-1)).toBe("out.mp4");
    expect(buildConvertArgs({ url: "in.mkv", start: 0, length: 5 }, "o.mp4")).not.toContain("-ss");
  });
});

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasFfmpeg)("채택 변환 (실제 ffmpeg)", () => {
  it("홀수 크기·소리 있는 mkv 를 짝수 크기·소리 없는 mp4 로 바꾼다", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "clips-convert-"));
    try {
      const input = path.join(dir, "in.mkv");
      execFileSync("ffmpeg", [
        ...["-hide_banner", "-loglevel", "error", "-y"],
        ...["-f", "lavfi", "-i", "testsrc=size=361x641:rate=24:duration=1"],
        ...["-f", "lavfi", "-i", "sine=f=440:d=1"],
        ...["-c:v", "mpeg4", "-c:a", "aac", "-shortest", input],
      ]);
      const output = path.join(dir, "out.mp4");
      await runFfmpeg(buildConvertArgs({ url: input, start: 0, length: 1 }, output), dir);
      const info = await probeMedia(output);
      expect(info).toMatchObject({ width: 360, height: 640, hasAudio: false });
      expect(info.duration).toBeCloseTo(1, 0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
