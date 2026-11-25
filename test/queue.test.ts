import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getVideoStatus, updatePublishAt } from "@/pipeline/providers/youtube";
import { createMigratedSchema, testDatabaseUrl } from "./helpers/db";
import { validSubmission } from "./helpers/script";

const credentials = {
  clientId: "cid",
  clientSecret: "cs",
  refreshToken: "rt",
  tokenSecret: "YOUTUBE_REFRESH_TOKEN_RACCOON",
  channelId: "UCmine",
};

/** 토큰·채널·영상 조회·영상 수정을 흉내 내는 가짜 YouTube. */
function youtube(status: Record<string, unknown>) {
  const updates: { id: string; status: Record<string, unknown> }[] = [];
  const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (url.startsWith("https://oauth2.googleapis.com/token")) return Response.json({ access_token: "at" });
    if (url.includes("/youtube/v3/channels")) return Response.json({ items: [{ id: "UCmine", snippet: { title: "라쿤씨" } }] });
    if (url.includes("/youtube/v3/videos") && init?.method === "PUT") {
      const body = JSON.parse(String(init.body)) as { id: string; status: Record<string, unknown> };
      updates.push(body);
      return Response.json({ id: body.id, status: body.status });
    }
    if (url.includes("/youtube/v3/videos?part=status&id=")) return Response.json({ items: [{ status }] });
    throw new Error(`예상하지 못한 요청 ${url}`);
  });
  return { fetchImpl, updates };
}

describe("YouTube 예약 시각 바꾸기 API", () => {
  it("지금 status 의 쓸 수 있는 필드를 그대로 두고 비공개 + 새 publishAt 으로 보낸다", async () => {
    const { fetchImpl, updates } = youtube({
      uploadStatus: "processed",
      privacyStatus: "private",
      publishAt: "2026-12-01T09:00:00Z",
      selfDeclaredMadeForKids: false,
      containsSyntheticMedia: true,
      license: "youtube",
    });
    const current = await getVideoStatus("at", "VID", fetchImpl);
    expect(current).toEqual({
      privacyStatus: "private",
      publishAt: "2026-12-01T09:00:00Z",
      selfDeclaredMadeForKids: false,
      containsSyntheticMedia: true,
      license: "youtube",
    });
    const at = new Date("2026-12-02T09:00:00Z");
    expect(await updatePublishAt({ accessToken: "at", videoId: "VID", current, publishAt: at, fetchImpl })).toMatchObject({
      publishAt: at.toISOString(),
    });
    expect(updates).toEqual([{ id: "VID", status: { ...current, publishAt: at.toISOString() } }]);

    const missing = vi.fn<typeof fetch>(async () => Response.json({ items: [] }));
    await expect(getVideoStatus("at", "GONE", missing)).rejects.toThrow("영상 GONE 을 찾을 수 없습니다");
  });
});

describe.skipIf(!testDatabaseUrl)("업로드 큐 (실제 DB, 가짜 YouTube)", () => {
  let drop: () => Promise<void>;

  beforeAll(async () => {
    const schema = await createMigratedSchema("queue");
    drop = schema.drop;
    process.env.DATABASE_URL = schema.url;
  });

  afterAll(async () => {
    const { getPool } = await import("@/lib/db");
    await getPool().end();
    await drop();
  });

  /** 영상 승인까지 끝난(업로드 대기) 에피소드. */
  async function readyEpisode(topic: string) {
    const { query } = await import("@/lib/db");
    const { createEpisode } = await import("@/pipeline/episodes");
    const { saveScript } = await import("@/pipeline/scripts");
    const { toDraft } = await import("@/pipeline/script/schema");
    const { saveAsset } = await import("@/pipeline/assets");
    const episode = await createEpisode({ topic, outline: "", channel: "raccoon", targetSeconds: 30 });
    await saveScript(episode.id, toDraft(validSubmission()), { source: "generated", warnings: [], model: null, usage: null });
    await saveAsset({
      episodeId: episode.id,
      kind: "final",
      model: null,
      credits: 0,
      url: "https://blob.test/f.mp4",
      meta: { scriptVersion: 1, seconds: 31.4 },
    });
    await query("update episodes set status = 'ready' where id = $1", [episode.id]);
    return episode;
  }

  it("날짜 미정 → 예약 업로드 → 예약됨, 큐에서 나눠 보이고 카테고리와 길이가 붙는다", async () => {
    const { query } = await import("@/lib/db");
    const { listUploadQueue, saveUpload } = await import("@/pipeline/episodes");
    const { claimIdea } = await import("@/pipeline/ideas/store");
    const waiting = await readyEpisode("날짜 미정");
    const later = await readyEpisode("예약됨");
    const old = await readyEpisode("지난달");
    const [idea] = await query<{ id: number }>(
      `insert into ideas (channel, category_id, title, hook, outline, target_seconds)
        select 'raccoon', id, '기획', '?', '-', 30 from channel_categories where name = '피부 과학' returning id`,
    );
    await claimIdea(idea.id, async () => later.id);
    const at = new Date(Date.now() + 2 * 86_400_000);
    await saveUpload(later.id, "VID1", "private", at);
    await query("update episodes set status = 'uploaded' where id = $1", [later.id]);
    await saveUpload(old.id, "VID0", "public", new Date(Date.now() - 30 * 86_400_000));
    await query("update episodes set status = 'uploaded' where id = $1", [old.id]);

    const queue = await listUploadQueue("raccoon");
    expect(queue.map((entry) => entry.episode.topic)).toEqual(["날짜 미정", "예약됨"]);
    expect(queue[0]).toMatchObject({ upload: null, category: null, seconds: 31.4 });
    expect(queue[1]).toMatchObject({ category: "피부 과학", upload: { privacy: "private", publishedAt: at } });
    expect(await listUploadQueue("saesae")).toEqual([]);
    expect(waiting.id).toBeLessThan(later.id);
  });

  it("예약 시각 바꾸기: 30분 뒤 이후만, 올린 영상만. 바꾼 시각을 기록하고 상태는 그대로. 이미 공개됐으면 건드리지 않는다", async () => {
    const { query } = await import("@/lib/db");
    const { getEpisode, setReschedule, latestUpload, saveUpload } = await import("@/pipeline/episodes");
    const { runStep } = await import("@/pipeline/runner");
    const { runRescheduleStep } = await import("@/pipeline/steps/upload");
    const episode = await readyEpisode("시각 바꾸기");
    const now = Date.now();
    await expect(setReschedule(episode.id, new Date(now + 3_600_000), now)).rejects.toThrow("유튜브에 올린 영상만");
    await saveUpload(episode.id, "VID2", "private", new Date(now + 86_400_000));
    await query("update episodes set status = 'uploaded' where id = $1", [episode.id]);
    await expect(setReschedule(episode.id, new Date(now + 60_000), now)).rejects.toThrow("30분 뒤");

    const next = new Date(now + 3 * 86_400_000);
    await setReschedule(episode.id, next, now);
    const scheduled = youtube({
      privacyStatus: "private",
      publishAt: new Date(now + 86_400_000).toISOString(),
      selfDeclaredMadeForKids: false,
    });
    const handlers = {
      reschedule: (ep: Parameters<typeof runRescheduleStep>[0]) =>
        runRescheduleStep(ep, { deps: { credentials, fetchImpl: scheduled.fetchImpl } }).then(() => {}),
    };
    const done = await runStep(episode.id, "reschedule", { handlers, runUrl: null });
    expect(done).toMatchObject({ ok: true, episode: { status: "uploaded" } });
    expect(scheduled.updates[0].status).toMatchObject({ privacyStatus: "private", publishAt: next.toISOString() });
    expect(await latestUpload(episode.id)).toMatchObject({ privacy: "private", publishedAt: next });

    // 이미 공개된 영상이면 바꾸지 않고 실패로 남긴다(다시 시도할 수 있다)
    await setReschedule(episode.id, new Date(now + 4 * 86_400_000), now);
    const published = youtube({ privacyStatus: "public" });
    const failed = await runStep(episode.id, "reschedule", {
      handlers: {
        reschedule: (ep) => runRescheduleStep(ep, { deps: { credentials, fetchImpl: published.fetchImpl } }).then(() => {}),
      },
      runUrl: null,
    });
    expect(failed).toMatchObject({ ok: false, error: expect.stringContaining("이미 공개됐거나") });
    expect(published.updates).toEqual([]);
    expect(await getEpisode(episode.id)).toMatchObject({ status: "failed", step: "reschedule", youtubeVideoId: "VID2" });
  });
});
