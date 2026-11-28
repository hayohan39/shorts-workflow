import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { formatClock } from "@/lib/format";
import { canEditMusic, isMusicBlobUrl, musicSegment, musicUploadPath, parseMusicUploadPath } from "@/pipeline/music/rules";
import { statusLabel } from "@/pipeline/status";
import { workflow } from "@/pipeline/workflow";
import { createMigratedSchema, testDatabaseUrl } from "./helpers/db";

const BLOB = "https://abc123.public.blob.vercel-storage.com";

describe("음악형 음원 규칙", () => {
  it("구간은 시작부터 에피소드 길이만큼, 곡 끝을 넘으면 당기고 곡이 짧으면 곡 전체", () => {
    expect(musicSegment({ durationSeconds: 120, startSeconds: 42.5 }, 30)).toEqual({ start: 42.5, end: 72.5, seconds: 30 });
    expect(musicSegment({ durationSeconds: 120, startSeconds: 110 }, 30)).toEqual({ start: 90, end: 120, seconds: 30 });
    expect(musicSegment({ durationSeconds: 24, startSeconds: 5 }, 30)).toEqual({ start: 0, end: 24, seconds: 24 });
  });

  it("업로드 경로는 에피소드 폴더 아래 영문 파일 이름으로, 토큰은 그 형식에만 준다", () => {
    expect(musicUploadPath(7, "떡볶이 랩 (v2).MP3")).toBe("music/7/v2.mp3");
    expect(musicUploadPath(7, "My Song!.wav")).toBe("music/7/My-Song.wav");
    expect(musicUploadPath(7, "가사.m4a")).toBe("music/7/track.m4a");
    expect(parseMusicUploadPath(musicUploadPath(12, "a b.mp3"))).toBe(12);
    expect(parseMusicUploadPath("music/12/../x.mp3")).toBeNull();
    expect(parseMusicUploadPath("music/12/..")).toBeNull();
    expect(parseMusicUploadPath("music/12/sub/x.mp3")).toBeNull();
    expect(parseMusicUploadPath("episodes/12/final.mp4")).toBeNull();
    expect(parseMusicUploadPath("music/0/x.mp3")).toBeNull();
  });

  it("저장하는 주소는 우리 Blob 스토어의 그 에피소드 폴더 것만", () => {
    expect(isMusicBlobUrl(`${BLOB}/music/7/song-AbC123.mp3`, 7)).toBe(true);
    expect(isMusicBlobUrl(`${BLOB}/music/8/song.mp3`, 7)).toBe(false);
    expect(isMusicBlobUrl(`${BLOB}/episodes/7/final.mp4`, 7)).toBe(false);
    expect(isMusicBlobUrl("https://evil.example/music/7/song.mp3", 7)).toBe(false);
    expect(isMusicBlobUrl(`http://abc123.public.blob.vercel-storage.com/music/7/a.mp3`, 7)).toBe(false);
    expect(isMusicBlobUrl(`${BLOB}/music/7/a.mp3?x=1`, 7)).toBe(false);
    expect(isMusicBlobUrl("not a url", 7)).toBe(false);
  });

  it("음원·구간은 음악형이 대기 중이고 도는 작업이 없을 때만 바꾼다", () => {
    const base = { route: "music" as const, status: "queued" as const, step: null, stepState: null };
    expect(canEditMusic(base)).toBe(true);
    expect(canEditMusic({ ...base, route: "ai" })).toBe(false);
    expect(canEditMusic({ ...base, status: "approved" })).toBe(false);
    expect(canEditMusic({ ...base, step: "render", stepState: "pending" })).toBe(false);
  });

  it("곡 위치 표시", () => {
    expect(formatClock(0)).toBe("0:00.0");
    expect(formatClock(72.46)).toBe("1:12.5");
    expect(formatClock(59.96)).toBe("1:00.0");
  });
});

describe("음악형 단계", () => {
  const queued = { route: "music" as const, status: "queued" as const, step: null, stepState: null };

  it("음원 → 가사 → 이미지 → 영상 → 업로드, 음원을 올리면 가사 단계", () => {
    const before = workflow(queued, { hasNarration: false, scenesLeft: 1, hasAudio: false });
    expect(before.stages.map((stage) => stage.label)).toEqual(["음원", "가사", "이미지", "영상", "업로드"]);
    expect(before.current).toBe("audio");
    const after = workflow(queued, { hasNarration: false, scenesLeft: 1, hasAudio: true, lyricsSynced: false });
    expect(after.current).toBe("lyrics");
    expect(after.stages.map((stage) => stage.state)).toEqual(["done", "current", "todo", "todo", "todo"]);
    expect(
      workflow({ ...queued, status: "approved" }, { hasNarration: false, scenesLeft: 2, hasAudio: true, lyricsSynced: true })
        .current,
    ).toBe("scenes");
  });

  it("대기 상태 이름은 대본 대신 음원·가사", () => {
    expect(statusLabel(queued)).toBe("음원·가사 준비");
    expect(statusLabel({ ...queued, route: "ai" })).toBe("대본 대기");
  });
});

describe.skipIf(!testDatabaseUrl)("음악형 에피소드 (실제 DB)", () => {
  let drop: () => Promise<void>;

  beforeAll(async () => {
    const schema = await createMigratedSchema("music");
    drop = schema.drop;
    process.env.DATABASE_URL = schema.url;
  });

  afterAll(async () => {
    const { getPool } = await import("@/lib/db");
    await getPool().end();
    await drop();
  });

  it("음악 채널이 있고 음악형 에피소드를 만들 수 있다", async () => {
    const { getChannel } = await import("@/pipeline/channels");
    const { createEpisode } = await import("@/pipeline/episodes");
    expect(await getChannel("music")).toMatchObject({
      route: "music",
      defaultSeconds: 30,
      youtubeTokenSecret: "YOUTUBE_REFRESH_TOKEN_MUSIC",
      youtubeChannelId: null,
    });
    const episode = await createEpisode({
      topic: "떡볶이 랩",
      outline: "밝은 붐뱁",
      route: "music",
      channel: "music",
      targetSeconds: 30,
    });
    expect(episode).toMatchObject({ route: "music", channel: "music", status: "queued" });
  });

  it("음원을 저장하고 구간을 고른다. 바꾸면 구간은 처음부터", async () => {
    const { createEpisode } = await import("@/pipeline/episodes");
    const { getMusicTrack, saveMusicTrack, setMusicStart } = await import("@/pipeline/music/track");
    const episode = await createEpisode({ topic: "랩", outline: "", route: "music", channel: "music", targetSeconds: 30 });
    const url = `${BLOB}/music/${episode.id}/song-x1.mp3`;

    await expect(setMusicStart(episode.id, 10)).rejects.toThrow("음원을 먼저");
    await expect(
      saveMusicTrack(episode.id, { audioUrl: `${BLOB}/music/999/a.mp3`, fileName: "a.mp3", durationSeconds: 90 }),
    ).rejects.toThrow("주소");
    await expect(saveMusicTrack(episode.id, { audioUrl: url, fileName: "a.mp3", durationSeconds: 5 })).rejects.toThrow(
      "짧습니다",
    );

    await saveMusicTrack(episode.id, { audioUrl: url, fileName: "떡볶이.mp3", durationSeconds: 92.345 });
    expect(await getMusicTrack(episode.id)).toMatchObject({
      audioUrl: url,
      fileName: "떡볶이.mp3",
      durationSeconds: 92.35,
      startSeconds: 0,
    });

    await setMusicStart(episode.id, 42.46);
    expect((await getMusicTrack(episode.id))?.startSeconds).toBe(42.5);
    await expect(setMusicStart(episode.id, 70)).rejects.toThrow("30초를 쓸 수 없습니다");
    await expect(setMusicStart(episode.id, -1)).rejects.toThrow("올바르지");

    const replaced = `${BLOB}/music/${episode.id}/song2-x2.mp3`;
    await saveMusicTrack(episode.id, { audioUrl: replaced, fileName: "v2.mp3", durationSeconds: 60 });
    expect(await getMusicTrack(episode.id)).toMatchObject({ audioUrl: replaced, startSeconds: 0, durationSeconds: 60 });
  });

  it("다른 길의 에피소드나 다음 단계로 넘어간 에피소드에는 저장하지 않는다", async () => {
    const { createEpisode } = await import("@/pipeline/episodes");
    const { saveMusicTrack } = await import("@/pipeline/music/track");
    const { query } = await import("@/lib/db");
    const ai = await createEpisode({ topic: "보습", outline: "" });
    await expect(
      saveMusicTrack(ai.id, { audioUrl: `${BLOB}/music/${ai.id}/a.mp3`, fileName: "a.mp3", durationSeconds: 60 }),
    ).rejects.toThrow("음악형 쇼츠가 아닙니다");
    const music = await createEpisode({ topic: "랩", outline: "", route: "music", channel: "music" });
    await query("update episodes set status = 'approved' where id = $1", [music.id]);
    await expect(
      saveMusicTrack(music.id, { audioUrl: `${BLOB}/music/${music.id}/a.mp3`, fileName: "a.mp3", durationSeconds: 60 }),
    ).rejects.toThrow("바꿀 수 없습니다");
  });

  it("대본·내레이션은 시작하지 않는다", async () => {
    const { createEpisode } = await import("@/pipeline/episodes");
    const { runnableStep, triggerStep } = await import("@/pipeline/trigger");
    const episode = await createEpisode({ topic: "랩", outline: "", route: "music", channel: "music" });
    const dispatch = vi.fn(async () => {});
    expect(runnableStep(episode)).toBeNull();
    await expect(triggerStep(episode.id, "script", dispatch)).rejects.toThrow("음원으로 만듭니다");
    await expect(triggerStep(episode.id, "voice", dispatch)).rejects.toThrow("음원으로 만듭니다");
    expect(dispatch).not.toHaveBeenCalled();
  });
});
