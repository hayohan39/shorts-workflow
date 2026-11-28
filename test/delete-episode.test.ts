import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createMigratedSchema, testDatabaseUrl } from "./helpers/db";

const blob = vi.hoisted(() => ({
  list: vi.fn(),
  del: vi.fn(async () => {}),
}));
vi.mock("@vercel/blob", () => ({ list: blob.list, del: blob.del, put: vi.fn() }));

describe("쇼츠 삭제 규칙", () => {
  it("예약 공개로 올려 두었고 공개 시각이 남았을 때만 '예약 진행' 으로 본다", async () => {
    const { isScheduledAhead } = await import("@/pipeline/episodes");
    const now = Date.parse("2026-11-28T00:00:00Z");
    const later = new Date(now + 3_600_000);
    const base = { youtubeVideoId: "vid", uploadPrivacy: "private" as const, scheduledAt: later };
    expect(isScheduledAhead(base, now)).toBe(true);
    expect(isScheduledAhead({ ...base, scheduledAt: new Date(now - 1) }, now)).toBe(false);
    expect(isScheduledAhead({ ...base, uploadPrivacy: "public" }, now)).toBe(false);
    expect(isScheduledAhead({ ...base, youtubeVideoId: null }, now)).toBe(false);
  });

  it("Blob 폴더는 페이지를 넘겨 가며 모두 지우고, 이상한 폴더 이름은 거절한다", async () => {
    const { deleteBlobFolder } = await import("@/pipeline/providers/blob");
    const { episodeBlobFolders } = await import("@/pipeline/episodes");
    blob.list
      .mockResolvedValueOnce({
        blobs: [{ url: "https://b/episodes/7/a.mp3" }, { url: "https://b/episodes/7/final.mp4" }],
        hasMore: true,
        cursor: "c1",
      })
      .mockResolvedValueOnce({ blobs: [{ url: "https://b/episodes/7/scene-1.jpg" }], hasMore: false });
    expect(await deleteBlobFolder("episodes/7/", "tok")).toBe(3);
    expect(blob.list.mock.calls.map(([options]) => options)).toEqual([
      { prefix: "episodes/7/", cursor: undefined, token: "tok", limit: 1000 },
      { prefix: "episodes/7/", cursor: "c1", token: "tok", limit: 1000 },
    ]);
    expect(blob.del).toHaveBeenCalledTimes(2);
    // 채택한 무료 클립(clips/…)은 다른 쇼츠와 같이 쓰므로 지우지 않는다.
    expect(episodeBlobFolders(7)).toEqual(["episodes/7/", "music/7/"]);
    for (const bad of ["episodes/7", "episodes/", "", "clips/../", "episodes/1/../2/"]) {
      await expect(deleteBlobFolder(bad, "tok")).rejects.toThrow("올바르지 않습니다");
    }
  });
});

describe.skipIf(!testDatabaseUrl)("쇼츠 삭제 (실제 DB)", () => {
  let drop: () => Promise<void>;

  beforeAll(async () => {
    const schema = await createMigratedSchema("delete");
    drop = schema.drop;
    process.env.DATABASE_URL = schema.url;
  });

  afterAll(async () => {
    const { getPool } = await import("@/lib/db");
    await getPool().end();
    await drop();
  });

  it("대본·생성물·음원은 함께 지우고, 소재 찾기·기획안은 연결만 끊는다", async () => {
    const { createEpisode, deleteEpisode, getEpisode } = await import("@/pipeline/episodes");
    const { saveAsset } = await import("@/pipeline/assets");
    const { createSearchCollection } = await import("@/pipeline/clips/store");
    const { saveMusicTrack } = await import("@/pipeline/music/track");
    const { query } = await import("@/lib/db");

    const episode = await createEpisode({ topic: "지울 쇼츠", outline: "", route: "clips" });
    await saveAsset({ episodeId: episode.id, kind: "final", model: null, credits: 0, url: "https://b/f.mp4", meta: {} });
    const collection = await createSearchCollection("지울 쇼츠", { episodeId: episode.id });
    const [idea] = await query<{ id: number }>(
      `insert into ideas (channel, title, hook, outline, target_seconds, status, episode_id)
        values ('raccoon', '기획', '훅?', '목차', 30, 'used', $1) returning id`,
      [episode.id],
    );
    const music = await createEpisode({ topic: "곡", outline: "", route: "music", channel: "music" });
    await saveMusicTrack(music.id, {
      audioUrl: `https://x.public.blob.vercel-storage.com/music/${music.id}/a.mp3`,
      fileName: "a.mp3",
      durationSeconds: 60,
    });

    expect(await deleteEpisode(episode.id)).toEqual({ channel: "raccoon" });
    expect(await getEpisode(episode.id)).toBeNull();
    expect(await query("select 1 from assets where episode_id = $1", [episode.id])).toHaveLength(0);
    expect(
      (await query<{ episode_id: number | null }>("select episode_id from clip_collections where id = $1", [collection.id]))[0],
    ).toEqual({ episode_id: null });
    expect((await query<{ episode_id: number | null }>("select episode_id from ideas where id = $1", [idea.id]))[0]).toEqual({
      episode_id: null,
    });

    await deleteEpisode(music.id);
    expect(await query("select 1 from music_tracks where episode_id = $1", [music.id])).toHaveLength(0);
    await expect(deleteEpisode(music.id)).rejects.toThrow("쇼츠를 찾을 수 없습니다");
  });

  it("도는 작업이 있으면 지우지 않지만, 응답 없이 멈춘 작업은 기다리지 않는다", async () => {
    const { createEpisode, deleteEpisode, getEpisode } = await import("@/pipeline/episodes");
    const { query } = await import("@/lib/db");
    const episode = await createEpisode({ topic: "도는 중", outline: "" });
    await query("update episodes set step = 'script', step_state = 'running', updated_at = now() where id = $1", [episode.id]);
    await expect(deleteEpisode(episode.id)).rejects.toThrow("진행 중인 단계가 끝난 뒤에");
    expect(await getEpisode(episode.id)).not.toBeNull();

    await query("update episodes set step_state = 'pending', updated_at = now() - interval '11 minutes' where id = $1", [
      episode.id,
    ]);
    await deleteEpisode(episode.id);
    expect(await getEpisode(episode.id)).toBeNull();
  });
});
