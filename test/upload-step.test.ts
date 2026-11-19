import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Asset } from "@/pipeline/assets";
import {
  checkChannel,
  getAccessToken,
  readYoutubeCredentials,
  uploadVideo,
  type VideoMetadata,
} from "@/pipeline/providers/youtube";
import { buildMetadata, latestFinal } from "@/pipeline/steps/upload";
import { createMigratedSchema, testDatabaseUrl } from "./helpers/db";
import { validSubmission } from "./helpers/script";

const credentials = { clientId: "cid", clientSecret: "csecret", refreshToken: "rtoken" };
const metadata: VideoMetadata = {
  snippet: { title: "t", description: "d", tags: [], categoryId: "27", defaultLanguage: "ko" },
  status: { privacyStatus: "private", selfDeclaredMadeForKids: false, containsSyntheticMedia: false },
};

/** 토큰 → 업로드 시작 → 파일 PUT 을 흉내 내는 가짜 fetch. */
function youtubeFetch(
  overrides: { token?: Response; start?: Response; put?: Response; video?: Response; channel?: Response } = {},
) {
  let started: RequestInit | undefined;
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      return overrides.token ?? Response.json({ access_token: "atoken", expires_in: 3599 });
    }
    if (url.startsWith("https://www.googleapis.com/youtube/v3/channels")) {
      return overrides.channel ?? Response.json({ items: [{ id: "UCmine", snippet: { title: "내 채널" } }] });
    }
    if (url.startsWith("https://www.googleapis.com/upload/youtube/v3/videos")) {
      started = init;
      return overrides.start ?? new Response(null, { status: 200, headers: { location: "https://upload.test/session-1" } });
    }
    if (url === "https://upload.test/session-1" && init?.method === "PUT") {
      return overrides.put ?? Response.json({ id: "VIDEO123", status: JSON.parse(String(started?.body)).status });
    }
    return overrides.video ?? new Response(new Uint8Array([1, 2, 3, 4]));
  });
}

describe("YouTube API", () => {
  it("키 3개가 없으면 무엇이 없는지 알려 준다", () => {
    expect(() => readYoutubeCredentials({ YOUTUBE_CLIENT_ID: "x" })).toThrow(
      "YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN 가 없습니다",
    );
    expect(
      readYoutubeCredentials({ YOUTUBE_CLIENT_ID: "a", YOUTUBE_CLIENT_SECRET: "b", YOUTUBE_REFRESH_TOKEN: "c" }),
    ).toEqual({ clientId: "a", clientSecret: "b", refreshToken: "c" });
  });

  it("리프레시 토큰으로 액세스 토큰을 받고, 만료되면 다시 발급하라고 알려 준다", async () => {
    const fetchImpl = youtubeFetch();
    expect(await getAccessToken(credentials, fetchImpl)).toBe("atoken");
    const body = new URLSearchParams(String(fetchImpl.mock.calls[0][1]?.body));
    expect(Object.fromEntries(body)).toEqual({
      grant_type: "refresh_token",
      client_id: "cid",
      client_secret: "csecret",
      refresh_token: "rtoken",
    });

    const expired = youtubeFetch({
      token: Response.json({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, { status: 400 }),
    });
    const error = await getAccessToken(credentials, expired).catch((e: Error) => e);
    expect(String(error)).toContain("invalid_grant");
    expect(String(error)).toContain("프로덕션");
    expect(String(error)).not.toContain("rtoken");
  });

  it("resumable 업로드: 메타데이터로 시작하고 받은 주소로 파일을 올린다", async () => {
    const fetchImpl = youtubeFetch();
    const video = Buffer.from("fake-mp4");
    // 응답의 실제 공개 상태를 돌려준다
    expect(await uploadVideo({ accessToken: "atoken", metadata, video, fetchImpl })).toEqual({
      id: "VIDEO123",
      privacyStatus: "private",
      publishAt: null,
    });

    const [startUrl, start] = fetchImpl.mock.calls[0];
    expect(String(startUrl)).toBe("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status");
    expect(start?.headers).toMatchObject({
      authorization: "Bearer atoken",
      "x-upload-content-type": "video/mp4",
      "x-upload-content-length": String(video.length),
    });
    expect(JSON.parse(String(start?.body))).toEqual(metadata);
    const [putUrl, put] = fetchImpl.mock.calls[1];
    expect(String(putUrl)).toBe("https://upload.test/session-1");
    expect(put?.method).toBe("PUT");
  });

  it("채널 확인: 설정한 채널 ID 가 없으면 건너뛰고, 같으면 통과, 다르면 올리지 않는다", async () => {
    expect(
      readYoutubeCredentials({ YOUTUBE_CLIENT_ID: "a", YOUTUBE_CLIENT_SECRET: "b", YOUTUBE_REFRESH_TOKEN: "c", YOUTUBE_CHANNEL_ID: " UCmine " }),
    ).toMatchObject({ channelId: "UCmine" });
    const fetchImpl = youtubeFetch();
    expect(await checkChannel(credentials, "atoken", fetchImpl)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();

    expect(await checkChannel({ ...credentials, channelId: "UCmine" }, "atoken", fetchImpl)).toEqual({ id: "UCmine", title: "내 채널" });
    expect(fetchImpl.mock.calls[0][1]?.headers).toEqual({ authorization: "Bearer atoken" });
    await expect(checkChannel({ ...credentials, channelId: "UCother" }, "atoken", fetchImpl)).rejects.toThrow(
      /올리지 않았습니다: 토큰은 "내 채널" 채널\(UCmine\)인데, 설정한 채널은 UCother/,
    );

    // 채널 조회 권한이 없는 토큰(업로드 범위만)
    const noScope = youtubeFetch({
      channel: Response.json(
        { error: { message: "Request had insufficient authentication scopes.", errors: [{ reason: "insufficientPermissions" }] } },
        { status: 403 },
      ),
    });
    await expect(checkChannel({ ...credentials, channelId: "UCmine" }, "atoken", noScope)).rejects.toThrow(/youtube\.readonly/);
    // 채널이 없는 계정
    const noChannel = youtubeFetch({ channel: Response.json({ items: [] }) });
    await expect(checkChannel({ ...credentials, channelId: "UCmine" }, "atoken", noChannel)).rejects.toThrow("채널이 없습니다");
  });

  it("한도 초과는 이유와 함께 알려 준다", async () => {
    const fetchImpl = youtubeFetch({
      start: Response.json(
        { error: { message: "The request cannot be completed because you have exceeded your quota.", errors: [{ reason: "quotaExceeded" }] } },
        { status: 403 },
      ),
    });
    await expect(uploadVideo({ accessToken: "a", metadata, video: Buffer.from("x"), fetchImpl })).rejects.toThrow(
      /quotaExceeded.*내일/,
    );
  });
});

describe("업로드 메타데이터", () => {
  const text = { title: "제목", description: "설명\n\n#shorts", tags: ["shorts"], synthetic: true };

  it("고른 공개 상태로, 아동용 아님·교육·한국어로 올린다", () => {
    expect(buildMetadata(text, { uploadPrivacy: "public", scheduledAt: null })).toEqual({
      snippet: { title: "제목", description: "설명\n\n#shorts", tags: ["shorts"], categoryId: "27", defaultLanguage: "ko" },
      status: { privacyStatus: "public", selfDeclaredMadeForKids: false, containsSyntheticMedia: true },
    });
  });

  it("예약 공개는 비공개 + publishAt", () => {
    const at = new Date("2026-12-01T09:00:00+09:00");
    expect(buildMetadata(text, { uploadPrivacy: "private", scheduledAt: at }).status).toMatchObject({
      privacyStatus: "private",
      publishAt: "2026-12-01T00:00:00.000Z",
    });
    // 공개를 고른 뒤 남은 예약 시각은 쓰지 않는다
    expect(buildMetadata(text, { uploadPrivacy: "public", scheduledAt: at }).status).not.toHaveProperty("publishAt");
  });

  it("이 대본 버전으로 합성한 최신 완성 영상을 고른다", () => {
    const asset = (id: number, version: number) => ({ id, kind: "final", url: `u${id}`, meta: { scriptVersion: version } }) as unknown as Asset;
    expect(latestFinal([asset(3, 1), asset(2, 2), asset(1, 2)], 2)?.id).toBe(2);
    expect(latestFinal([asset(3, 1)], 2)).toBeNull();
  });
});

describe.skipIf(!testDatabaseUrl)("유튜브 업로드 단계 (실제 DB, 가짜 YouTube)", () => {
  let drop: () => Promise<void>;

  beforeAll(async () => {
    const schema = await createMigratedSchema("upload");
    drop = schema.drop;
    process.env.DATABASE_URL = schema.url;
  });

  afterAll(async () => {
    const { getPool } = await import("@/lib/db");
    await getPool().end();
    await drop();
  });

  it("업로드 대기 → 고른 공개 상태로 업로드 → 업로드 완료, 실제 공개 상태를 기록하고 두 번 올리지 않는다", async () => {
    const { query } = await import("@/lib/db");
    const { createEpisode, getEpisode, setUploadPlan, latestUpload } = await import("@/pipeline/episodes");
    const { saveScript } = await import("@/pipeline/scripts");
    const { toDraft } = await import("@/pipeline/script/schema");
    const { saveAsset } = await import("@/pipeline/assets");
    const { runStep } = await import("@/pipeline/runner");
    const { runUploadStep } = await import("@/pipeline/steps/upload");

    const episode = await createEpisode({ topic: "업로드", outline: "" });
    await saveScript(episode.id, toDraft(validSubmission()), { source: "generated", warnings: [], model: null, usage: null });
    await query("update episodes set status = 'ready' where id = $1", [episode.id]);
    const fetchImpl = youtubeFetch();
    const handlers = { upload: (ep: Parameters<typeof runUploadStep>[0]) => runUploadStep(ep, { deps: { credentials, fetchImpl } }).then(() => {}) };

    // 공개 상태를 고르지 않았거나 완성 영상이 없으면 실패하고, 다시 시도할 수 있다.
    expect(await runStep(episode.id, "upload", { handlers, runUrl: null })).toMatchObject({
      ok: false,
      error: expect.stringContaining("공개 상태를 고르지 않았습니다"),
    });
    await setUploadPlan(episode.id, "public", null);
    const failed = await runStep(episode.id, "upload", { handlers, runUrl: null });
    expect(failed).toMatchObject({ ok: false, error: expect.stringContaining("완성 영상이 없습니다") });

    for (const scene of validSubmission().scenes) {
      await saveAsset({ episodeId: episode.id, kind: scene.kind, sceneNo: scene.no, model: "m", credits: 1, url: "https://blob.test/s", meta: { scriptVersion: 1 } });
    }
    await saveAsset({ episodeId: episode.id, kind: "final", model: null, credits: 0, url: "https://blob.test/final.mp4", meta: { scriptVersion: 1 } });

    const done = await runStep(episode.id, "upload", { handlers, runUrl: null });
    expect(done).toMatchObject({ ok: true, episode: { status: "uploaded", youtubeVideoId: "VIDEO123" } });
    const start = fetchImpl.mock.calls.find(([url]) => String(url).includes("uploadType=resumable"));
    expect(JSON.parse(String(start?.[1]?.body)).status).toEqual({
      privacyStatus: "public",
      selfDeclaredMadeForKids: false,
      containsSyntheticMedia: true, // AI 장면이 있다
    });
    expect(await latestUpload(episode.id)).toMatchObject({ privacy: "public", youtubeUrl: "https://youtu.be/VIDEO123" });

    await expect(runUploadStep((await getEpisode(episode.id))!, { deps: { credentials, fetchImpl } })).rejects.toThrow("이미 업로드한");
  });

  it("올린 뒤 기록이 계속 실패하면 영상 ID·Studio 링크를 남겨 다시 올리지 않게 알린다", async () => {
    const { query } = await import("@/lib/db");
    const { createEpisode, getEpisode } = await import("@/pipeline/episodes");
    const { saveScript } = await import("@/pipeline/scripts");
    const { toDraft } = await import("@/pipeline/script/schema");
    const { saveAsset } = await import("@/pipeline/assets");
    const { runUploadStep } = await import("@/pipeline/steps/upload");

    const episode = await createEpisode({ topic: "기록 실패", outline: "" });
    await saveScript(episode.id, toDraft(validSubmission()), { source: "generated", warnings: [], model: null, usage: null });
    await query("update episodes set status = 'ready' where id = $1", [episode.id]);
    await saveAsset({ episodeId: episode.id, kind: "final", model: null, credits: 0, url: "https://blob.test/final.mp4", meta: { scriptVersion: 1 } });
    await query("update episodes set upload_privacy = 'private' where id = $1", [episode.id]);

    const save = vi.fn<typeof import("@/pipeline/episodes").saveUpload>(async () => {
      throw new Error("connection terminated");
    });
    const sleep = vi.fn(async () => {});
    const error = await runUploadStep((await getEpisode(episode.id))!, {
      deps: { credentials, fetchImpl: youtubeFetch(), save, sleep },
    }).catch((e: Error) => e);
    expect(save).toHaveBeenCalledTimes(3);
    expect(String(error)).toContain("영상 ID VIDEO123");
    expect(String(error)).toContain("https://studio.youtube.com/video/VIDEO123/edit");
    expect(String(error)).toContain("connection terminated");

    // 두 번째에 성공하면 그대로 끝난다.
    save.mockReset();
    save.mockRejectedValueOnce(new Error("blip")).mockResolvedValueOnce(undefined);
    await expect(
      runUploadStep((await getEpisode(episode.id))!, { deps: { credentials, fetchImpl: youtubeFetch(), save, sleep } }),
    ).resolves.toEqual({ videoId: "VIDEO123", privacy: "private" });
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("예약 공개: 30분 뒤 이후만 고를 수 있고, 비공개로 올려 공개 예약 시각을 기록한다. YouTube 가 다르게 적용하면 그 값을 남긴다", async () => {
    const { query } = await import("@/lib/db");
    const { createEpisode, getEpisode, setUploadPlan, latestUpload } = await import("@/pipeline/episodes");
    const { saveScript } = await import("@/pipeline/scripts");
    const { toDraft } = await import("@/pipeline/script/schema");
    const { saveAsset } = await import("@/pipeline/assets");
    const { runUploadStep } = await import("@/pipeline/steps/upload");

    const episode = await createEpisode({ topic: "예약", outline: "" });
    await saveScript(episode.id, toDraft(validSubmission()), { source: "generated", warnings: [], model: null, usage: null });
    await saveAsset({ episodeId: episode.id, kind: "final", model: null, credits: 0, url: "https://blob.test/final.mp4", meta: { scriptVersion: 1 } });
    await expect(setUploadPlan(episode.id, "public", null)).rejects.toThrow("업로드 대기 중일 때만");
    await query("update episodes set status = 'ready' where id = $1", [episode.id]);

    const now = Date.parse("2026-12-01T00:00:00Z");
    await expect(setUploadPlan(episode.id, "private", new Date(now + 10 * 60_000), now)).rejects.toThrow("30분 뒤");
    await expect(setUploadPlan(episode.id, "public", new Date(now + 3_600_000), now)).rejects.toThrow("30분 뒤");
    const at = new Date(now + 3_600_000);
    await setUploadPlan(episode.id, "private", at, now);

    // 시각이 지난 뒤에 올리려 하면 막는다
    const late = await runUploadStep((await getEpisode(episode.id))!, {
      deps: { credentials, fetchImpl: youtubeFetch(), now: () => at.getTime() },
    }).catch((e: Error) => e);
    expect(String(late)).toContain("예약 공개 시각이 지났습니다");

    const fetchImpl = youtubeFetch();
    await runUploadStep((await getEpisode(episode.id))!, { deps: { credentials, fetchImpl, now: () => now } });
    const start = fetchImpl.mock.calls.find(([url]) => String(url).includes("uploadType=resumable"));
    expect(JSON.parse(String(start?.[1]?.body)).status).toMatchObject({ privacyStatus: "private", publishAt: at.toISOString() });
    expect(await latestUpload(episode.id)).toMatchObject({ privacy: "private", publishedAt: at });

    // 다른 채널 토큰이면 영상을 받거나 올리기 전에 멈추고, 업로드 기록도 남지 않는다
    const wrong = await createEpisode({ topic: "다른 채널", outline: "" });
    await saveScript(wrong.id, toDraft(validSubmission()), { source: "generated", warnings: [], model: null, usage: null });
    await saveAsset({ episodeId: wrong.id, kind: "final", model: null, credits: 0, url: "https://blob.test/final.mp4", meta: { scriptVersion: 1 } });
    await query("update episodes set status = 'ready', upload_privacy = 'public' where id = $1", [wrong.id]);
    const guarded = youtubeFetch();
    await expect(
      runUploadStep((await getEpisode(wrong.id))!, { deps: { credentials: { ...credentials, channelId: "UCother" }, fetchImpl: guarded } }),
    ).rejects.toThrow("올리지 않았습니다");
    expect(guarded.mock.calls.map(([url]) => String(url).split("?")[0])).toEqual([
      "https://oauth2.googleapis.com/token",
      "https://www.googleapis.com/youtube/v3/channels",
    ]);
    expect(await latestUpload(wrong.id)).toBeNull();

    // 공개를 요청했는데 YouTube 가 비공개로 적용하면 실제 값(비공개)을 남긴다
    const other = await createEpisode({ topic: "다르게 적용", outline: "" });
    await saveScript(other.id, toDraft(validSubmission()), { source: "generated", warnings: [], model: null, usage: null });
    await saveAsset({ episodeId: other.id, kind: "final", model: null, credits: 0, url: "https://blob.test/final.mp4", meta: { scriptVersion: 1 } });
    await query("update episodes set status = 'ready', upload_privacy = 'public' where id = $1", [other.id]);
    const locked = youtubeFetch({ put: Response.json({ id: "VID2", status: { privacyStatus: "private" } }) });
    await expect(runUploadStep((await getEpisode(other.id))!, { deps: { credentials, fetchImpl: locked } })).resolves.toEqual({
      videoId: "VID2",
      privacy: "private",
    });
    expect(await latestUpload(other.id)).toMatchObject({ privacy: "private" });
  });
});
