import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createArchiveAdapter, pickVideoFile } from "@/pipeline/clips/sources/archive";
import { createAdapters } from "@/pipeline/clips/sources";
import { createNasaAdapter, hasExternalCredit, https, parseNasaDuration } from "@/pipeline/clips/sources/nasa";
import { createWikimediaAdapter } from "@/pipeline/clips/sources/wikimedia";

// fixture 는 2026-11-01 실제 응답을 줄인 것이다.
const fixture = (name: string) => JSON.parse(readFileSync(path.join("test", "fixtures", "clips", name), "utf8"));

/** 주소별로 응답을 정해 둔 가짜 fetch. 없는 주소는 404. */
function routeFetch(routes: (url: URL) => unknown) {
  return vi.fn<typeof fetch>(async (input) => {
    const body = routes(new URL(String(input)));
    return body === undefined ? new Response("not found", { status: 404 }) : new Response(JSON.stringify(body));
  });
}

describe("소스 목록", () => {
  it("Pixabay·NASA·Wikimedia·Internet Archive 를 쓴다", () => {
    expect(createAdapters({}).map((adapter) => adapter.id)).toEqual(["pixabay", "nasa", "wikimedia", "archive"]);
  });
});

describe("NASA 어댑터", () => {
  const search = fixture("nasa-search.json");
  const assets = fixture("nasa-assets.json") as Record<string, { collection: string[]; metadata: object }>;
  const fetchImpl = routeFetch((url) => {
    if (url.hostname === "images-api.nasa.gov") return search;
    const id = url.pathname.split("/")[2];
    if (url.pathname.endsWith("collection.json")) return assets[id]?.collection;
    if (url.pathname.endsWith("metadata.json")) return assets[id]?.metadata;
  });

  it("길이·해상도는 metadata.json, 파일은 collection.json 에서, 외부 촬영자 항목은 뺀다", async () => {
    const clips = await createNasaAdapter().search("ocean waves", { limit: 20, fetchImpl });
    // Rocket Lab 촬영 2건은 빠지고 NASA 제작 1건만.
    expect(clips).toHaveLength(1);
    expect(clips[0]).toMatchObject({
      source: "nasa",
      sourceId: "GSFC_20161212_Tidal_m12450_Magnetic",
      title: "Ocean Tides and Magnetic Fields",
      pageUrl: "https://images.nasa.gov/details/GSFC_20161212_Tidal_m12450_Magnetic",
      downloadUrl:
        "https://images-assets.nasa.gov/video/GSFC_20161212_Tidal_m12450_Magnetic/GSFC_20161212_Tidal_m12450_Magnetic~large.mp4",
      previewUrl: expect.stringMatching(/~preview\.mp4$/),
      width: 1920,
      height: 1080,
      durationSec: 53,
      license: { code: "nasa", raw: { center: "GSFC" } },
    });
    expect(clips[0].author).toMatch(/^NASA \(Matthew R\. Radcliff/);
    // 빠지는 항목은 파일 목록을 받으러 가지 않는다(검색 1번 + 1건 × 2번).
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("길이 표기·외부 촬영자 판정·주소 정리", () => {
    expect(parseNasaDuration("0:00:53")).toBe(53);
    expect(parseNasaDuration("1:02:03.5")).toBe(3723.5);
    expect(parseNasaDuration("12.5 s")).toBe(12.5);
    expect(parseNasaDuration(undefined)).toBeNull();
    expect(hasExternalCredit("Rocket Lab")).toBe(true);
    expect(hasExternalCredit("NASA/Michelle Stone")).toBe(false);
    expect(hasExternalCredit("")).toBe(false);
    expect(https("http://images-assets.nasa.gov/video/Earth Views/Earth Views~large.mp4")).toBe(
      "https://images-assets.nasa.gov/video/Earth%20Views/Earth%20Views~large.mp4",
    );
  });
});

describe("Wikimedia Commons 어댑터", () => {
  const response = fixture("wikimedia-search.json");

  it("검색어에 filetype:video 를 붙이고 maxlag 를 지킨다", async () => {
    const fetchImpl = routeFetch(() => ({ query: { pages: [] } }));
    await createWikimediaAdapter().search("ocean waves", { limit: 20, fetchImpl });
    const url = new URL(String(fetchImpl.mock.calls[0][0]));
    expect(url.searchParams.get("gsrsearch")).toBe("ocean waves filetype:video");
    expect(url.searchParams.get("maxlag")).toBe("5");
    expect(url.searchParams.get("prop")).toBe("videoinfo");
  });

  it("검색 순서대로, 라이선스·작성자·길이를 붙이고 추적 쿼리를 뗀다", async () => {
    const clips = await createWikimediaAdapter().search("ocean waves", { limit: 20, fetchImpl: routeFetch(() => response) });
    expect(clips.map((clip) => clip.title)).toEqual(["Ocean surface waves 09", "Ocean surface waves 06", "Ocean surface waves 08"]);
    expect(clips[0]).toMatchObject({
      source: "wikimedia",
      pageUrl: "https://commons.wikimedia.org/wiki/File:Ocean_surface_waves_09.ogv",
      downloadUrl: "https://upload.wikimedia.org/wikipedia/commons/e/ee/Ocean_surface_waves_09.ogv",
      previewUrl: expect.stringMatching(/240p\.vp9\.webm$/),
      width: 1920,
      height: 1080,
      durationSec: 11,
      author: "Mostafameraji",
      license: { code: "cc0", name: "CC0 1.0" },
    });
  });

  it("NC 라이선스·제한(Restrictions) 있는 파일은 빼고, 원본이 크면 가장 큰 변환본을 받는다", async () => {
    const pages = structuredClone(response.query.pages);
    pages[0].videoinfo[0].extmetadata.LicenseShortName.value = "CC BY-NC-SA 4.0";
    pages[0].videoinfo[0].extmetadata.LicenseUrl.value = "https://creativecommons.org/licenses/by-nc-sa/4.0/";
    pages[1].videoinfo[0].extmetadata.Restrictions.value = "personality";
    pages[2].videoinfo[0].size = 500 * 1024 * 1024;
    const clips = await createWikimediaAdapter().search("x", { limit: 20, fetchImpl: routeFetch(() => ({ query: { pages } })) });
    expect(clips).toHaveLength(1);
    expect(clips[0]).toMatchObject({ downloadUrl: expect.stringMatching(/480p\.vp9\.webm$/), width: 854, height: 480 });
  });

  it("API 오류(maxlag 등)는 에러로", async () => {
    const fetchImpl = routeFetch(() => ({ error: { code: "maxlag", info: "Waiting for a database server" } }));
    await expect(createWikimediaAdapter().search("x", { limit: 5, fetchImpl })).rejects.toThrow("maxlag");
  });
});

describe("Internet Archive 어댑터", () => {
  const search = fixture("archive-search.json");
  const metadata = fixture("archive-metadata.json") as Record<string, object>;
  const fetchImpl = routeFetch((url) =>
    url.pathname === "/advancedsearch.php" ? search : metadata[decodeURIComponent(url.pathname.split("/")[2])],
  );

  it("제목·주제어에서, 라이선스가 있고 NC·ND 가 아닌 영상만 요청한다", async () => {
    await createArchiveAdapter().search("ocean waves", { limit: 20, fetchImpl });
    const url = new URL(String(fetchImpl.mock.calls[0][0]));
    expect(url.searchParams.get("q")).toBe(
      "(title:(ocean waves) OR subject:(ocean waves)) AND mediatype:movies AND licenseurl:* AND NOT licenseurl:*nc* AND NOT licenseurl:*nd*",
    );
    expect(url.searchParams.getAll("fl[]")).toEqual(["identifier", "title", "creator", "licenseurl"]);
    expect(url.searchParams.get("rows")).toBe("8");
  });

  it("항목의 가장 큰 mp4 를 받고, licenseurl 로 판정한다(파일 정보를 못 받은 항목은 건너뛴다)", async () => {
    const clips = await createArchiveAdapter().search("ocean waves", { limit: 20, fetchImpl });
    // losing_myself_in_hawaii_2006 은 fixture 에 metadata 가 없다(404) → 그 항목만 빠진다.
    expect(clips.map((clip) => clip.sourceId)).toEqual(["CoastalTown1080", "vid-20690524-192720-000"]);
    expect(clips[0]).toMatchObject({
      title: "Coastal Town 1080",
      pageUrl: "https://archive.org/details/CoastalTown1080",
      downloadUrl: "https://archive.org/download/CoastalTown1080/CoastalTown-1080.mp4",
      width: 1920,
      height: 1080,
      durationSec: 198.9,
      author: "Mother Nature",
      license: { code: "cc-by", name: "CC BY 3.0" },
    });
    expect(clips[1]).toMatchObject({
      downloadUrl: "https://archive.org/download/vid-20690524-192720-000/Ocean%20Waves%20original%20animation%202020%20%231.ia.mp4",
      license: { code: "cc0" },
    });
  });

  it("길이·해상도를 아는 영상 파일만 고른다", () => {
    expect(
      pickVideoFile([
        { name: "a.gif", format: "Animated GIF" },
        { name: "a.ogv", format: "Ogg Video", length: "10", width: "534", height: "300" },
        { name: "a.mp4", format: "MPEG4", length: "10", width: "1280", height: "720" },
        { name: "b.mp4", format: "h.264", width: "1920", height: "1080" },
      ])?.name,
    ).toBe("a.mp4");
    expect(pickVideoFile([])).toBeNull();
  });
});
