import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Asset } from "@/pipeline/assets";
import { statusForDecision, TransitionError } from "@/pipeline/status";
import { parseVideoId, studioUrl, watchUrl } from "@/pipeline/youtube/links";
import { apiTags, buildUploadText, hasAiScenes } from "@/pipeline/youtube/metadata";
import { createMigratedSchema, testDatabaseUrl } from "./helpers/db";
import { validSubmission } from "./helpers/script";

const script = {
  title: "연어 DNA <화장품>, 진짜 효과 있을까?",
  description: "요약\n\n출처\n- a: https://a.test",
  tags: ["#shorts", "#PDRN", "#피부과학"],
  needsAiDisclosure: false,
};

describe("유튜브 제목·설명·태그", () => {
  it("YouTube 규칙에 맞춰 다듬고, 설명 끝에 해시태그를 붙인다", () => {
    const text = buildUploadText(script, [], false);
    expect(text).toEqual({
      title: "연어 DNA 화장품, 진짜 효과 있을까?",
      description: "요약\n\n출처\n- a: https://a.test\n\n#shorts #PDRN #피부과학",
      tags: ["shorts", "PDRN", "피부과학"],
      synthetic: false,
    });
  });

  it("AI 장면이 있거나 실사 인물이 나오면 합성 콘텐츠로 표시한다", () => {
    expect(buildUploadText(script, [], true).synthetic).toBe(true);
    expect(buildUploadText({ ...script, needsAiDisclosure: true }, [], false).synthetic).toBe(true);
    const scenes = (models: string[]) => new Map(models.map((model, i) => [i + 1, { model } as Asset]));
    expect(hasAiScenes(scenes(["clip", "clip"]))).toBe(false);
    expect(hasAiScenes(scenes(["clip", "kling"]))).toBe(true);
  });

  it("제목 100자, 설명 5,000바이트, 태그 합계 500자를 넘기지 않는다", () => {
    const long = buildUploadText({ ...script, title: "가".repeat(150), description: "나".repeat(3000) }, [], false);
    expect([...long.title]).toHaveLength(100);
    expect(new TextEncoder().encode(long.description).length).toBeLessThanOrEqual(5000);
    expect(long.description.endsWith("…")).toBe(true);
    const tags = apiTags(Array.from({ length: 40 }, (_, i) => `#tag number ${i}`));
    expect(tags.reduce((sum, tag) => sum + tag.length + 2, 0) + tags.length - 1).toBeLessThanOrEqual(500);
    expect(apiTags(["#a", "a", " #b "])).toEqual(["a", "b"]);
  });
});

describe("유튜브 링크", () => {
  it("여러 형태의 링크에서 영상 ID 를 뽑는다", () => {
    expect(parseVideoId("https://youtu.be/dQw4w9WgXcQ?si=abc")).toBe("dQw4w9WgXcQ");
    expect(parseVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1")).toBe("dQw4w9WgXcQ");
    expect(parseVideoId("https://youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(parseVideoId("https://m.youtube.com/shorts/dQw4w9WgXcQ?feature=share")).toBe("dQw4w9WgXcQ");
    expect(parseVideoId("https://studio.youtube.com/video/dQw4w9WgXcQ/edit")).toBe("dQw4w9WgXcQ");
    expect(parseVideoId("https://example.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(parseVideoId("dQw4w9WgXcQ")).toBeNull();
    expect(watchUrl("abc")).toBe("https://youtu.be/abc");
    expect(studioUrl("abc")).toBe("https://studio.youtube.com/video/abc/edit");
  });

  it("업로드 대기에서만 '올렸어요' 로 업로드 완료가 된다", () => {
    expect(statusForDecision({ status: "ready", step: "compose", stepState: "done" }, "mark-uploaded")).toBe("uploaded");
    expect(() => statusForDecision({ status: "video_review", step: "compose", stepState: "done" }, "mark-uploaded")).toThrow(
      TransitionError,
    );
  });
});

describe.skipIf(!testDatabaseUrl)("직접 올린 뒤 기록 (실제 DB)", () => {
  let drop: () => Promise<void>;

  beforeAll(async () => {
    const schema = await createMigratedSchema("ytmeta");
    drop = schema.drop;
    process.env.DATABASE_URL = schema.url;
  });

  afterAll(async () => {
    const { getPool } = await import("@/lib/db");
    await getPool().end();
    await drop();
  });

  it("업로드 완료로 바꾸고 영상 링크를 남긴다", async () => {
    const { query } = await import("@/lib/db");
    const { createEpisode, decide, getEpisode, saveUpload } = await import("@/pipeline/episodes");
    const { saveScript } = await import("@/pipeline/scripts");
    const { toDraft } = await import("@/pipeline/script/schema");

    const episode = await createEpisode({ topic: "직접 업로드", outline: "" });
    await saveScript(episode.id, toDraft(validSubmission()), { source: "generated", warnings: [], model: null, usage: null });
    await query("update episodes set status = 'ready' where id = $1", [episode.id]);

    await decide(episode.id, "mark-uploaded");
    await saveUpload(episode.id, "dQw4w9WgXcQ", "public");
    expect(await getEpisode(episode.id)).toMatchObject({ status: "uploaded", youtubeVideoId: "dQw4w9WgXcQ" });
    const uploads = await query("select privacy, youtube_url from uploads where episode_id = $1", [episode.id]);
    expect(uploads).toEqual([{ privacy: "public", youtube_url: "https://youtu.be/dQw4w9WgXcQ" }]);
    await expect(decide(episode.id, "mark-uploaded")).rejects.toThrow(TransitionError);
  });
});
