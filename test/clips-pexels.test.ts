import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createPexelsAdapter, pickFiles, titleFromUrl, type PexelsResponse } from "@/pipeline/clips/sources/pexels";

// fixture 는 공식 JS 라이브러리(pexels@1.4.0) 타입 정의에 맞춘 예시다(실제 응답은 첫 수집에서 확인).
const fixture = JSON.parse(readFileSync(path.join("test", "fixtures", "clips", "pexels-videos.json"), "utf8")) as PexelsResponse;

function fakeFetch(body: unknown = fixture) {
  return vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status: 200 }));
}

describe("Pexels 어댑터", () => {
  it("키가 없으면 꺼지고 이유를 알려 준다", async () => {
    const adapter = createPexelsAdapter({});
    expect(adapter.availability()).toEqual({ ok: false, reason: expect.stringContaining("PEXELS_API_KEY") });
    await expect(adapter.search("ocean", { limit: 20 })).rejects.toThrow("PEXELS_API_KEY");
  });

  it("키는 Authorization 헤더로, 세로 영상만 요청한다", async () => {
    const fetchImpl = fakeFetch({ total_results: 0, videos: [] });
    await createPexelsAdapter({ PEXELS_API_KEY: "secret" }).search("ocean waves", { limit: 500, fetchImpl });
    const [input, init] = fetchImpl.mock.calls[0];
    const url = new URL(String(input));
    expect(url.origin + url.pathname).toBe("https://api.pexels.com/videos/search");
    expect(Object.fromEntries(url.searchParams)).toEqual({ query: "ocean waves", orientation: "portrait", per_page: "80" });
    expect(String(url)).not.toContain("secret");
    expect((init?.headers as Record<string, string>).authorization).toBe("secret");
  });

  it("1080p 이하에서 가장 큰 mp4 를 받고, 받을 파일이 없는 항목(HLS 뿐)은 버린다", async () => {
    const clips = await createPexelsAdapter({ PEXELS_API_KEY: "k" }).search("ocean", { limit: 20, fetchImpl: fakeFetch() });
    expect(clips).toHaveLength(1);
    expect(clips[0]).toMatchObject({
      source: "pexels",
      sourceId: "1093662",
      title: "waves crashing on the shore",
      pageUrl: "https://www.pexels.com/video/waves-crashing-on-the-shore-1093662/",
      downloadUrl: "https://videos.pexels.com/video-files/1093662/1093662-hd_1080_1920_25fps.mp4",
      previewUrl: "https://videos.pexels.com/video-files/1093662/1093662-sd_360_640_25fps.mp4",
      width: 1080,
      height: 1920,
      durationSec: 14,
      author: "Pressmaster",
      authorUrl: "https://www.pexels.com/@pressmaster",
      license: { code: "pexels", name: "Pexels License", url: "https://www.pexels.com/license/" },
    });
  });

  it("1080p 이하가 없으면 가장 작은 것을 받는다", () => {
    const uhd = { id: 1, quality: "uhd", file_type: "video/mp4", width: 2160, height: 3840, link: "a" };
    expect(pickFiles([uhd])?.download.link).toBe("a");
    expect(pickFiles([])).toBeNull();
  });

  it("페이지 주소에서 제목을 만든다", () => {
    expect(titleFromUrl("https://www.pexels.com/video/ocean-waves-crashing-1234/")).toBe("ocean waves crashing");
    expect(titleFromUrl("https://www.pexels.com/video/1234/")).toBeNull();
  });
});
