import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createPixabayAdapter, type PixabayResponse } from "@/pipeline/clips/sources/pixabay";

const fixture = JSON.parse(readFileSync(path.join("test", "fixtures", "clips", "pixabay-videos.json"), "utf8")) as PixabayResponse;

function fakeFetch(body: unknown = fixture) {
  return vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status: 200 }));
}

describe("Pixabay 어댑터", () => {
  it("키가 없으면 꺼지고 이유를 알려 준다", async () => {
    const adapter = createPixabayAdapter({});
    expect(adapter.availability()).toEqual({ ok: false, reason: expect.stringContaining("PIXABAY_API_KEY") });
    await expect(adapter.search("ocean", { limit: 20 })).rejects.toThrow("PIXABAY_API_KEY");
    expect(createPixabayAdapter({ PIXABAY_API_KEY: "k" }).availability()).toEqual({ ok: true });
  });

  it("검색어·개수·세이프서치로 요청한다", async () => {
    const fetchImpl = fakeFetch({ total: 0, totalHits: 0, hits: [] });
    await createPixabayAdapter({ PIXABAY_API_KEY: "secret" }).search("ocean waves", { limit: 500, fetchImpl });
    const url = new URL(String(fetchImpl.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe("https://pixabay.com/api/videos/");
    expect(Object.fromEntries(url.searchParams)).toEqual({ key: "secret", q: "ocean waves", safesearch: "true", per_page: "200" });
  });

  it("응답을 후보로 바꾼다: 가장 큰 파일·가장 작은 미리보기·작성자·라이선스", async () => {
    const clips = await createPixabayAdapter({ PIXABAY_API_KEY: "k" }).search("flowers", { limit: 20, fetchImpl: fakeFetch() });
    expect(clips).toHaveLength(2);
    expect(clips[0]).toEqual({
      source: "pixabay",
      sourceId: "125",
      keyword: "flowers",
      title: "flowers, yellow, blossom",
      pageUrl: "https://pixabay.com/videos/id-125/",
      thumbnailUrl: "https://cdn.pixabay.com/video/2015/08/08/125-135736646_large.jpg",
      previewUrl: "https://cdn.pixabay.com/video/2015/08/08/125-135736646_tiny.mp4",
      downloadUrl: "https://cdn.pixabay.com/video/2015/08/08/125-135736646_large.mp4",
      width: 1920,
      height: 1080,
      durationSec: 12,
      author: "Coverr-Free-Footage",
      authorUrl: "https://pixabay.com/users/Coverr-Free-Footage-1281706/",
      license: {
        code: "pixabay",
        name: "Pixabay Content License",
        url: "https://pixabay.com/service/license-summary/",
        raw: { license: "Pixabay Content License", pageURL: "https://pixabay.com/videos/id-125/", user: "Coverr-Free-Footage", user_id: 1281706 },
      },
    });
  });

  it("large 가 비어 있으면 다음 크기를 받고, 받을 파일이 없는 항목은 버린다", async () => {
    const clips = await createPixabayAdapter({ PIXABAY_API_KEY: "k" }).search("ocean", { limit: 20, fetchImpl: fakeFetch() });
    expect(clips[1]).toMatchObject({
      sourceId: "31377",
      downloadUrl: "https://cdn.pixabay.com/video/2020/01/05/31377-383991325_medium.mp4",
      width: 1080,
      height: 1920,
    });
    expect(clips.map((clip) => clip.sourceId)).not.toContain("99");
  });

  it("실패 응답에 키를 드러내지 않는다", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("[ERROR 400] Invalid or missing API key", { status: 400 }));
    const error = await createPixabayAdapter({ PIXABAY_API_KEY: "secret-key" })
      .search("ocean", { limit: 20, fetchImpl })
      .catch((e: Error) => e);
    expect(String(error)).toContain("HTTP 400");
    expect(String(error)).not.toContain("secret-key");
  });
});
