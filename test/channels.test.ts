import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createMigratedSchema, testDatabaseUrl } from "./helpers/db";
import { validSubmission } from "./helpers/script";

describe.skipIf(!testDatabaseUrl)("채널 (실제 DB)", () => {
  let drop: () => Promise<void>;

  beforeAll(async () => {
    const schema = await createMigratedSchema("channels");
    drop = schema.drop;
    process.env.DATABASE_URL = schema.url;
  });

  afterAll(async () => {
    const { getPool } = await import("@/lib/db");
    await getPool().end();
    await drop();
  });

  it("라쿤씨(생성형)·새새 열매(편집형) 두 채널로 시작하고, 기존 에피소드는 라쿤씨 것이다", async () => {
    const { listChannels, channelLabel } = await import("@/pipeline/channels");
    const { createEpisode } = await import("@/pipeline/episodes");
    const channels = await listChannels();
    expect(
      channels.map(({ slug, route, youtubeTokenSecret, youtubeChannelId }) => ({
        slug,
        route,
        youtubeTokenSecret,
        youtubeChannelId,
      })),
    ).toEqual([
      { slug: "raccoon", route: "ai", youtubeTokenSecret: "YOUTUBE_REFRESH_TOKEN", youtubeChannelId: null },
      { slug: "saesae", route: "clips", youtubeTokenSecret: "YOUTUBE_REFRESH_TOKEN_SAESAE", youtubeChannelId: null },
    ]);
    expect(channels.map(channelLabel)).toEqual(["🦝 피부건강 라쿤씨", "🐦 새새 열매"]);
    expect(channels.map((channel) => channel.defaultSeconds)).toEqual([30, 30]);
    expect(await createEpisode({ topic: "기본 채널", outline: "" })).toMatchObject({ channel: "raccoon", targetSeconds: 35 });
    expect((await createEpisode({ topic: "30초", outline: "", targetSeconds: 30 })).targetSeconds).toBe(30);
    await expect(createEpisode({ topic: "1분", outline: "", targetSeconds: 60 })).rejects.toThrow("영상 길이는");
  });

  it("채널 설정: 이름·아이콘·기본 길이·유튜브 채널 ID 를 바꾸고(제작 방식은 그대로), 잘못된 값은 이유와 함께 거절한다", async () => {
    const { updateChannel, getChannel } = await import("@/pipeline/channels");
    const base = { name: "새새 열매", emoji: "🐦", defaultSeconds: 30, youtubeChannelId: "" };
    await expect(updateChannel("saesae", { ...base, name: "  " })).rejects.toThrow("채널 이름을 입력하세요");
    await expect(updateChannel("saesae", { ...base, youtubeChannelId: "my-channel" })).rejects.toThrow("UC 로 시작하는 24자");
    await expect(updateChannel("saesae", { ...base, defaultSeconds: 60 })).rejects.toThrow(
      "기본 길이는 20·25·30·35·40·45·50·55초 중에서",
    );
    await expect(updateChannel("nope", base)).rejects.toThrow("채널을 찾을 수 없습니다");

    const id = "UC" + "a".repeat(22);
    expect(await updateChannel("saesae", { ...base, name: " 새새 열매 🍒 ", youtubeChannelId: ` ${id} ` })).toMatchObject({
      name: "새새 열매 🍒",
      route: "clips",
      youtubeChannelId: id,
    });
    // 비우면 연결을 끊는다(자동 업로드를 하지 않는다)
    await updateChannel("saesae", base);
    expect(await getChannel("saesae")).toMatchObject({
      name: "새새 열매",
      route: "clips",
      defaultSeconds: 30,
      youtubeChannelId: null,
    });
  });

  it("에피소드는 채널에 속하고, 목록과 최근 대본(훅 겹침 방지)은 채널별로 본다", async () => {
    const { createEpisode, listEpisodes } = await import("@/pipeline/episodes");
    const { saveScript, recentScripts } = await import("@/pipeline/scripts");
    const { toDraft } = await import("@/pipeline/script/schema");
    const bird = await createEpisode({ topic: "참새의 모래 목욕", outline: "", route: "clips", channel: "saesae" });
    const skin = await createEpisode({ topic: "세라마이드", outline: "", channel: "raccoon" });
    await expect(createEpisode({ topic: "x", outline: "", channel: "nope" })).rejects.toThrow();

    expect((await listEpisodes({ channel: "saesae" })).map((episode) => episode.id)).toEqual([bird.id]);
    expect((await listEpisodes({ channel: "raccoon" })).map((episode) => episode.id)).toContain(skin.id);
    expect((await listEpisodes()).map((episode) => episode.id)).toEqual(expect.arrayContaining([bird.id, skin.id]));

    const meta = { source: "generated" as const, warnings: [], model: null, usage: null };
    await saveScript(bird.id, toDraft(validSubmission()), meta);
    await saveScript(skin.id, toDraft(validSubmission()), meta);
    const next = await createEpisode({ topic: "까치의 장난", outline: "", route: "clips", channel: "saesae" });
    expect((await recentScripts(next)).map((script) => script.episodeId)).toEqual([bird.id]);
  });

  it("유튜브 채널 ID 가 없는 채널이면 영상을 받거나 올리기 전에 멈춘다", async () => {
    const { query } = await import("@/lib/db");
    const { createEpisode, getEpisode } = await import("@/pipeline/episodes");
    const { saveScript } = await import("@/pipeline/scripts");
    const { toDraft } = await import("@/pipeline/script/schema");
    const { saveAsset } = await import("@/pipeline/assets");
    const { runUploadStep } = await import("@/pipeline/steps/upload");
    const episode = await createEpisode({ topic: "올릴 채널 없음", outline: "", channel: "saesae" });
    await saveScript(episode.id, toDraft(validSubmission()), { source: "generated", warnings: [], model: null, usage: null });
    await saveAsset({
      episodeId: episode.id,
      kind: "final",
      model: null,
      credits: 0,
      url: "https://blob.test/final.mp4",
      meta: { scriptVersion: 1 },
    });
    await query("update episodes set status = 'ready', upload_privacy = 'public' where id = $1", [episode.id]);

    const fetchImpl = vi.fn<typeof fetch>();
    await expect(runUploadStep((await getEpisode(episode.id))!, { deps: { fetchImpl } })).rejects.toThrow(
      '"새새 열매" 채널 설정에 유튜브 채널 ID 가 없습니다',
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
