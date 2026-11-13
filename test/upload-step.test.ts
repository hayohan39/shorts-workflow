import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Asset } from "@/pipeline/assets";
import {
  getAccessToken,
  readYoutubeCredentials,
  uploadVideo,
  type VideoMetadata,
} from "@/pipeline/providers/youtube";
import { apiTags, buildMetadata, latestFinal } from "@/pipeline/steps/upload";
import { createMigratedSchema, testDatabaseUrl } from "./helpers/db";
import { validSubmission } from "./helpers/script";

const credentials = { clientId: "cid", clientSecret: "csecret", refreshToken: "rtoken" };
const metadata: VideoMetadata = {
  snippet: { title: "t", description: "d", tags: [], categoryId: "27", defaultLanguage: "ko" },
  status: { privacyStatus: "private", selfDeclaredMadeForKids: false, containsSyntheticMedia: false },
};

/** 토큰 → 업로드 시작 → 파일 PUT 을 흉내 내는 가짜 fetch. */
function youtubeFetch(overrides: { token?: Response; start?: Response; put?: Response; video?: Response } = {}) {
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      return overrides.token ?? Response.json({ access_token: "atoken", expires_in: 3599 });
    }
    if (url.startsWith("https://www.googleapis.com/upload/youtube/v3/videos")) {
      return overrides.start ?? new Response(null, { status: 200, headers: { location: "https://upload.test/session-1" } });
    }
    if (url === "https://upload.test/session-1" && init?.method === "PUT") {
      return overrides.put ?? Response.json({ id: "VIDEO123" });
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
    expect(await uploadVideo({ accessToken: "atoken", metadata, video, fetchImpl })).toBe("VIDEO123");

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
  const script = {
    title: "연어 DNA <화장품>, 진짜 효과 있을까?",
    description: "요약\n\n출처\n- a: https://a.test",
    tags: ["#shorts", "#PDRN", "#피부과학"],
    needsAiDisclosure: false,
  };

  it("제목·설명·태그를 YouTube 규칙에 맞추고 비공개·아동용 아님으로 올린다", () => {
    const meta = buildMetadata(script, [], false);
    expect(meta.snippet).toMatchObject({
      title: "연어 DNA 화장품, 진짜 효과 있을까?",
      tags: ["shorts", "PDRN", "피부과학"],
      categoryId: "27",
      defaultLanguage: "ko",
    });
    expect(meta.snippet.description).toBe("요약\n\n출처\n- a: https://a.test\n\n#shorts #PDRN #피부과학");
    expect(meta.status).toEqual({ privacyStatus: "private", selfDeclaredMadeForKids: false, containsSyntheticMedia: false });
  });

  it("AI 장면이 있거나 실사 인물이 나오면 합성 콘텐츠로 표시한다", () => {
    expect(buildMetadata(script, [], true).status.containsSyntheticMedia).toBe(true);
    expect(buildMetadata({ ...script, needsAiDisclosure: true }, [], false).status.containsSyntheticMedia).toBe(true);
  });

  it("제목 100자, 설명 5,000바이트, 태그 합계 500자를 넘기지 않는다", () => {
    const long = buildMetadata({ ...script, title: "가".repeat(150), description: "나".repeat(3000) }, [], false);
    expect([...long.snippet.title]).toHaveLength(100);
    expect(new TextEncoder().encode(long.snippet.description).length).toBeLessThanOrEqual(5000);
    expect(long.snippet.description.endsWith("…")).toBe(true);
    const tags = apiTags(Array.from({ length: 40 }, (_, i) => `#tag number ${i}`));
    expect(tags.reduce((sum, tag) => sum + tag.length + 2, 0) + tags.length - 1).toBeLessThanOrEqual(500);
    expect(apiTags(["#a", "a", " #b "])).toEqual(["a", "b"]);
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

  it("업로드 대기 → 비공개 업로드 → 업로드 완료, 영상 ID 와 기록을 남기고 두 번 올리지 않는다", async () => {
    const { query } = await import("@/lib/db");
    const { createEpisode, getEpisode } = await import("@/pipeline/episodes");
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

    // 완성 영상이 없으면 실패하고, 다시 시도할 수 있다.
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
      privacyStatus: "private",
      selfDeclaredMadeForKids: false,
      containsSyntheticMedia: true, // AI 장면이 있다
    });
    const uploads = await query<{ privacy: string; youtube_url: string }>("select privacy, youtube_url from uploads where episode_id = $1", [episode.id]);
    expect(uploads).toEqual([{ privacy: "private", youtube_url: "https://youtu.be/VIDEO123" }]);

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

    const save = vi.fn<(id: number, videoId: string, privacy: string) => Promise<void>>(async () => {
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
    ).resolves.toEqual({ videoId: "VIDEO123" });
    expect(save).toHaveBeenCalledTimes(2);
  });
});
