import { execFile, execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assTime, buildAss, buildCues, highlightNumbers, NOTICE, splitLines } from "@/pipeline/compose/ass";
import { buildFfmpegArgs, checkOutput } from "@/pipeline/compose/ffmpeg";
import { MIN_SCENE_SECONDS, planTimeline, TAIL_SECONDS } from "@/pipeline/compose/timeline";
import { createMigratedSchema, testDatabaseUrl } from "./helpers/db";
import { validSubmission } from "./helpers/script";

const scenes = validSubmission().scenes;

describe("타임라인", () => {
  it("내레이션 길이를 장면별 글자 수 비율로 나누고, 마지막 장면에 여유를 둔다", () => {
    const timeline = planTimeline(scenes, 20);
    const speech = timeline.scenes.reduce((sum, scene) => sum + scene.speech, 0);
    expect(speech).toBeCloseTo(20, 1);
    expect(timeline.total).toBeCloseTo(20 + TAIL_SECONDS, 1);
    // 장면은 빈틈 없이 이어진다.
    timeline.scenes.slice(1).forEach((scene, i) => {
      const prev = timeline.scenes[i];
      expect(scene.start).toBeCloseTo(prev.start + prev.duration, 2);
    });
    // 글자가 많은 4번 장면이 1번보다 길다.
    expect(timeline.scenes[3].speech).toBeGreaterThan(timeline.scenes[0].speech);
  });

  it("아주 짧은 장면도 최소 길이를 보장하고, 길이를 모르면 실패한다", () => {
    const short = planTimeline([{ no: 1, kind: "video", narration: "네." }, ...scenes.slice(1)], 10);
    expect(short.scenes[0].speech).toBe(MIN_SCENE_SECONDS);
    expect(() => planTimeline(scenes, 0)).toThrow("내레이션 길이");
  });
});

describe("자막(ASS)", () => {
  it("시간 형식·숫자 강조·제어 문자", () => {
    expect(assTime(0)).toBe("0:00:00.00");
    expect(assTime(65.237)).toBe("0:01:05.24");
    expect(highlightNumbers("2014년 완치율 37%")).toBe("{\\c&H0000FFFF&}2014년{\\r} 완치율 {\\c&H0000FFFF&}37%{\\r}");
    expect(highlightNumbers("{굵게}")).toBe("｛굵게｝");
  });

  it("문장·줄 길이로 나누고, 두 줄씩 묶은 자막이 장면 안에서 이어진다", () => {
    expect(splitLines("첫 문장입니다. 둘째 문장은 조금 더 길어서 한 줄을 넘어갑니다.", 12)).toEqual([
      "첫 문장입니다.",
      "둘째 문장은 조금 더",
      "길어서 한 줄을",
      "넘어갑니다.",
    ]);
    const timeline = planTimeline(scenes, 20);
    const cues = buildCues(timeline);
    for (const scene of timeline.scenes) {
      const own = cues.filter((cue) => cue.start >= scene.start - 1e-6 && cue.start < scene.start + scene.duration);
      expect(own.length).toBeGreaterThan(0);
      expect(own[0].start).toBeCloseTo(scene.start, 3);
      expect(own.at(-1)!.end).toBeCloseTo(scene.start + scene.duration, 3);
      own.forEach((cue) => expect(cue.lines.length).toBeLessThanOrEqual(2));
    }
  });

  it("고지가 처음부터 끝까지 깔린다", () => {
    const timeline = planTimeline(scenes, 20);
    const ass = buildAss(timeline);
    expect(ass).toContain("PlayResX: 1080");
    expect(ass).toContain(`Dialogue: 1,0:00:00.00,${assTime(timeline.total)},Notice,,0,0,0,,${NOTICE}`);
    expect(ass).toContain("\\N");
  });
});

describe("ffmpeg 인자", () => {
  it("영상은 그대로, 이미지는 반복 입력+확대, 내레이션 음량 정규화, 자막·길이 지정", () => {
    const timeline = planTimeline(scenes, 20);
    const args = buildFfmpegArgs(timeline, {
      scenes: new Map([[1, "a.mp4"], [2, "b.jpg"], [3, "c.mp4"], [4, "d.jpg"]]),
      narration: "n.mp3",
      output: "out.mp4",
    });
    const joined = args.join(" ");
    expect(joined).toContain(`-loop 1 -framerate 30 -t ${timeline.scenes[1].duration.toFixed(3)} -i b.jpg`);
    expect(joined).toContain("tpad=stop_mode=clone");
    expect(joined).toContain("zoompan=");
    expect(joined).toContain("concat=n=4:v=1:a=0");
    expect(joined).toContain("ass=subs.ass");
    expect(joined).toContain("[4:a]loudnorm=I=-14");
    expect(args.slice(-3)).toEqual(["-t", timeline.total.toFixed(3), "out.mp4"]);
    expect(() => buildFfmpegArgs(timeline, { scenes: new Map(), narration: "n", output: "o" })).toThrow("1번 장면 파일이 없습니다");
  });

  it("결과 검사", () => {
    expect(checkOutput({ width: 1080, height: 1920, duration: 20.3, hasAudio: true }, 20.4)).toEqual([]);
    expect(checkOutput({ width: 720, height: 1280, duration: 15, hasAudio: false }, 20.4)).toEqual([
      "해상도 720×1280 (기대 1080×1920)",
      "길이 15.00초 (기대 20.40초)",
      "소리가 없습니다",
    ]);
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

describe.skipIf(!testDatabaseUrl || !hasFfmpeg)("영상 합성 (실제 DB·실제 ffmpeg, 시험 패턴 영상)", () => {
  const run = promisify(execFile);
  let drop: () => Promise<void>;
  let media: string;

  beforeAll(async () => {
    const schema = await createMigratedSchema("compose");
    drop = schema.drop;
    process.env.DATABASE_URL = schema.url;
    media = await mkdtemp(path.join(os.tmpdir(), "compose-test-"));
    const ff = (...args: string[]) => run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { cwd: media });
    await ff("-f", "lavfi", "-i", "testsrc=size=360x640:rate=24:duration=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "v.mp4");
    await ff("-f", "lavfi", "-i", "testsrc2=size=400x400", "-frames:v", "1", "i.jpg");
    await ff("-f", "lavfi", "-i", "sine=f=440:d=8", "-c:a", "libmp3lame", "n.mp3");
  }, 60_000);

  afterAll(async () => {
    const { getPool } = await import("@/lib/db");
    await getPool().end();
    await drop();
    await rm(media, { recursive: true, force: true });
  });

  it("장면 4개 + 내레이션 → 1080×1920 영상을 만들어 저장한다", async () => {
    const { query } = await import("@/lib/db");
    const { createEpisode, getEpisode } = await import("@/pipeline/episodes");
    const { saveScript } = await import("@/pipeline/scripts");
    const { toDraft } = await import("@/pipeline/script/schema");
    const { listAssets, saveAsset } = await import("@/pipeline/assets");
    const { runComposeStep } = await import("@/pipeline/steps/compose");

    const episode = await createEpisode({ topic: "합성", outline: "" });
    await saveScript(episode.id, toDraft(validSubmission()), { source: "generated", warnings: [], model: null, usage: null });
    await query("update episodes set status = 'rendering' where id = $1", [episode.id]);
    const fetchImpl = (async (url: string) => new Response(await readFile(path.join(media, path.basename(url))))) as unknown as typeof fetch;
    const uploads: { pathname: string; bytes: number }[] = [];
    const deps = {
      fetchImpl,
      put: async (pathname: string, body: Buffer) => {
        uploads.push({ pathname, bytes: body.length });
        return { url: `https://blob.example/${pathname}` };
      },
    };

    // 장면·내레이션이 없으면 시작하지 않는다.
    await expect(runComposeStep((await getEpisode(episode.id))!, { deps })).rejects.toThrow("장면 1·2·3·4번이 없습니다");
    for (const scene of validSubmission().scenes) {
      await saveAsset({
        episodeId: episode.id,
        kind: scene.kind,
        sceneNo: scene.no,
        model: "m",
        credits: 1,
        url: `https://blob.example/${scene.kind === "video" ? "v.mp4" : "i.jpg"}`,
        meta: { scriptVersion: 1 },
      });
    }
    await expect(runComposeStep((await getEpisode(episode.id))!, { deps })).rejects.toThrow("내레이션이 없습니다");
    await saveAsset({ episodeId: episode.id, kind: "voice", model: "eleven_v3", credits: 80, url: "https://blob.example/n.mp3", meta: { voiceName: "Sian" } });

    const result = await runComposeStep((await getEpisode(episode.id))!, { deps });
    expect(result.seconds).toBeCloseTo(8 + 0.4, 0);
    expect(uploads).toEqual([{ pathname: `episodes/${episode.id}/final.mp4`, bytes: expect.any(Number) }]);
    expect(uploads[0].bytes).toBeGreaterThan(10_000);
    const [final] = await listAssets(episode.id, "final");
    expect(final).toMatchObject({ credits: 0, url: `https://blob.example/episodes/${episode.id}/final.mp4` });
    expect(final.meta).toMatchObject({ scriptVersion: 1, voiceName: "Sian" });
  }, 180_000);
});
