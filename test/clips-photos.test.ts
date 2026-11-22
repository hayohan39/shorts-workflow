import { writeFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { isCommercialUse } from "@/pipeline/clips/license";
import { isSelectable, selectClips, totalSeconds, IMAGE_SECONDS } from "@/pipeline/clips/select";
import { createINaturalistAdapter, type INaturalistResponse } from "@/pipeline/clips/sources/inaturalist";
import { createWikimediaAdapter } from "@/pipeline/clips/sources/wikimedia";
import { buildImageArgs } from "@/pipeline/clips/adopt";
import { clip } from "./helpers/clips";
import { createMigratedSchema, testDatabaseUrl } from "./helpers/db";
import { validSubmission } from "./helpers/script";

function jsonFetch(route: (url: URL) => unknown) {
  return vi.fn<typeof fetch>(async (input) => new Response(JSON.stringify(route(new URL(String(input))))));
}

const photo = (id: number, license_code: string | null) => ({
  id,
  license_code,
  url: `https://inaturalist-open-data.s3.amazonaws.com/photos/${id}/square.jpg`,
  attribution: `(c) birder, some rights reserved (${license_code ?? "all rights reserved"})`,
  original_dimensions: { width: 3000, height: 2000 },
});

const observation = (id: number, photos: ReturnType<typeof photo>[]) => ({
  id,
  uri: `https://www.inaturalist.org/observations/${id}`,
  taxon: { name: "Passer montanus", preferred_common_name: "Eurasian Tree Sparrow", iconic_taxon_name: "Aves" },
  user: { login: "birder", name: "Bird Er" },
  photos,
});

describe("iNaturalist: 상업적 이용이 되는 사진만", () => {
  const response: INaturalistResponse = {
    total_results: 5,
    results: [
      observation(1, [photo(11, "cc-by-nc"), photo(12, "cc-by")]), // 비영리 사진은 건너뛰고 CC BY 를 쓴다
      observation(2, [photo(21, "cc-by-nc-sa"), photo(22, null)]), // 쓸 수 있는 사진이 없다
      observation(3, [photo(31, "cc-by-nd")]), // 변경금지
      observation(4, [photo(41, "CC0")]),
      observation(5, [photo(51, "cc-by-sa")]),
    ],
  };

  it("요청에서 CC0·CC BY·CC BY-SA 로 거르고, 응답의 사진마다 다시 확인한다", async () => {
    const fetchImpl = jsonFetch(() => response);
    const clips = await createINaturalistAdapter().search("sparrow", { limit: 20, fetchImpl });
    const url = new URL(String(fetchImpl.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe("https://api.inaturalist.org/v1/observations");
    expect(url.searchParams.get("photo_license")).toBe("cc0,cc-by,cc-by-sa");
    expect(url.searchParams.get("quality_grade")).toBe("research");

    expect(clips.map((c) => [c.sourceId, c.license.code])).toEqual([
      ["1-12", "cc-by"],
      ["4-41", "cc0"],
      ["5-51", "cc-by-sa"],
    ]);
    expect(clips[0]).toMatchObject({
      source: "inaturalist",
      media: "image",
      title: "Eurasian Tree Sparrow (Passer montanus)",
      pageUrl: "https://www.inaturalist.org/photos/12",
      downloadUrl: "https://inaturalist-open-data.s3.amazonaws.com/photos/12/original.jpg",
      thumbnailUrl: "https://inaturalist-open-data.s3.amazonaws.com/photos/12/small.jpg",
      width: 2048,
      height: 1365,
      author: "Bird Er",
      license: { name: "CC BY 4.0", raw: { license_code: "cc-by", iconic_taxon_name: "Aves" } },
    });
    expect(clips.every(isCommercialUse)).toBe(true);
  });

  it("이중 차단: 저장·채택 전에 라이선스를 다시 본다(비영리·변경금지·저작권 보유·판단 불가는 거절)", () => {
    const inat = (code: string | null, licenseCode: "cc-by" | "cc0" = "cc-by") =>
      clip({
        source: "inaturalist",
        media: "image",
        license: { code: licenseCode, name: "CC BY 4.0", url: null, raw: { license_code: code } },
      });
    expect(isCommercialUse(inat("cc-by"))).toBe(true);
    expect(isCommercialUse(inat("cc-by-nc"))).toBe(false);
    expect(isCommercialUse(inat(null))).toBe(false);
    expect(isCommercialUse(clip({ license: { code: "cc-by", name: "CC BY-NC 4.0", url: null, raw: {} } }))).toBe(false);
    expect(isCommercialUse(clip({ license: { code: "cc-by", name: "All rights reserved", url: null, raw: {} } }))).toBe(false);
    expect(isCommercialUse(clip({ license: { code: "cc-by-nc" as "cc-by", name: "CC BY-NC", url: null, raw: {} } }))).toBe(false);
    expect(isCommercialUse(clip())).toBe(true); // Pixabay
  });
});

describe("Wikimedia 사진", () => {
  it("filetype:bitmap 으로 찾고, 원본이 크면 1440px 축소본을 받는다. 비영리 사진은 뺀다", async () => {
    const meta = (license: string) => ({
      LicenseShortName: { value: license },
      LicenseUrl: { value: license === "CC BY-SA 4.0" ? "https://creativecommons.org/licenses/by-sa/4.0" : "" },
      Artist: { value: "<a href='x'>Birder</a>" },
      ObjectName: { value: "Sparrow" },
    });
    const fetchImpl = jsonFetch((url) =>
      url.searchParams.get("prop") === "imageinfo"
        ? {
            query: {
              pages: [
                {
                  title: "File:Sparrow.jpg",
                  pageid: 9,
                  index: 1,
                  imageinfo: [
                    {
                      width: 4000,
                      height: 3000,
                      thumburl: "https://upload.wikimedia.org/thumb/Sparrow.jpg/1440px-Sparrow.jpg?utm=x",
                      thumbwidth: 1440,
                      thumbheight: 1080,
                      url: "https://upload.wikimedia.org/Sparrow.jpg",
                      descriptionurl: "https://commons.wikimedia.org/wiki/File:Sparrow.jpg",
                      mediatype: "BITMAP",
                      extmetadata: meta("CC BY-SA 4.0"),
                    },
                  ],
                },
                {
                  title: "File:NC.jpg",
                  pageid: 10,
                  index: 2,
                  imageinfo: [
                    {
                      width: 800,
                      height: 800,
                      url: "https://upload.wikimedia.org/NC.jpg",
                      descriptionurl: "https://commons.wikimedia.org/wiki/File:NC.jpg",
                      mediatype: "BITMAP",
                      extmetadata: meta("CC BY-NC 4.0"),
                    },
                  ],
                },
              ],
            },
          }
        : { query: { pages: [] } },
    );
    const clips = await createWikimediaAdapter().search("sparrow", { limit: 20, fetchImpl });
    const imageRequest = fetchImpl.mock.calls
      .map(([u]) => new URL(String(u)))
      .find((u) => u.searchParams.get("prop") === "imageinfo")!;
    expect(imageRequest.searchParams.get("gsrsearch")).toBe("sparrow filetype:bitmap");
    expect(clips).toEqual([
      expect.objectContaining({
        media: "image",
        sourceId: "9",
        title: "Sparrow",
        downloadUrl: "https://upload.wikimedia.org/thumb/Sparrow.jpg/1440px-Sparrow.jpg",
        width: 1440,
        height: 1080,
        author: "Birder",
        license: expect.objectContaining({ code: "cc-by-sa" }),
      }),
    ]);
  });
});

describe("사진 선별·채택", () => {
  it("사진은 짧은 변 600px 이상만, 한 장을 5초로 센다", () => {
    const big = clip({ media: "image", durationSec: null, width: 1440, height: 1080 });
    const small = clip({ media: "image", durationSec: null, width: 640, height: 427 });
    expect(isSelectable(big)).toBe(true);
    expect(isSelectable(small)).toBe(false);
    expect(totalSeconds([big, clip({ durationSec: 10 })])).toBe(IMAGE_SECONDS + 10);
    const selection = selectClips(
      Array.from({ length: 30 }, () => clip({ media: "image", durationSec: null, width: 1080, height: 1350 })),
    );
    expect(selection.totalSec).toBe(90);
    expect(selection.selected).toHaveLength(18);
  });

  it("사진은 JPEG 한 장으로 바꾼다(긴 폭 2160px 까지, 연락처 User-Agent)", () => {
    const args = buildImageArgs("https://example.org/a.jpg", "/tmp/x/1.jpg");
    expect(args).toEqual(expect.arrayContaining(["-frames:v", "1", "-vf", "scale='min(2160,iw)':-2", "/tmp/x/1.jpg"]));
    expect(args[args.indexOf("-user_agent") + 1]).toContain("shorts-workflow");
  });
});

describe.skipIf(!testDatabaseUrl)("사진 소재 (실제 DB)", () => {
  let drop: () => Promise<void>;

  beforeAll(async () => {
    const schema = await createMigratedSchema("photos");
    drop = schema.drop;
    process.env.DATABASE_URL = schema.url;
  });

  afterAll(async () => {
    const { getPool } = await import("@/lib/db");
    await getPool().end();
    await drop();
  });

  it("DB 가 비영리 라이선스 저장을 막고, 사진은 JPEG 로 채택해 이미지 장면으로 넣는다", async () => {
    const { query } = await import("@/lib/db");
    const store = await import("@/pipeline/clips/store");
    const { adoptClips } = await import("@/pipeline/clips/adopt");
    const { fillSceneWithClip } = await import("@/pipeline/clips/episode");
    const { createEpisode, getEpisode } = await import("@/pipeline/episodes");
    const { saveScript } = await import("@/pipeline/scripts");
    const { toDraft } = await import("@/pipeline/script/schema");

    const collection = await store.createSearchCollection("참새");
    await store.startCollection(collection.id, null);
    const bird = clip({
      source: "inaturalist",
      media: "image",
      durationSec: null,
      width: 2048,
      height: 1365,
      downloadUrl: "https://example.org/12/original.jpg",
      license: { code: "cc-by", name: "CC BY 4.0", url: null, raw: { license_code: "cc-by" } },
    });
    await store.finishCollection(collection.id, {
      keywords: ["sparrow"],
      keywordCostUsd: null,
      sourceResults: {},
      selection: selectClips([bird, clip({ durationSec: 8 })]),
      fetchedAt: new Map(),
    });
    // 마지막 방어선: 비영리 라이선스는 DB 가 받지 않는다
    await expect(
      query(
        `insert into clip_candidates (collection_id, source, source_id, keyword, title, page_url, license_code, license_name)
          values ($1, 'inaturalist', 'nc', 'x', 'x', 'x', 'cc-by-nc', 'CC BY-NC')`,
        [collection.id],
      ),
    ).rejects.toThrow(/clip_candidates_license_check/);

    const put = vi.fn(async (pathname: string, _body: Buffer, contentType: string) => ({
      url: `https://blob.test/${pathname}?${contentType}`,
    }));
    const convert = vi.fn(async (_source: unknown, output: string) => writeFile(output, "mp4"));
    const convertImage = vi.fn(async (_url: string, output: string) => writeFile(output, "jpg"));
    expect(await adoptClips(collection.id, { put, convert, convertImage })).toBe(2);
    expect(convertImage).toHaveBeenCalledWith("https://example.org/12/original.jpg", expect.stringMatching(/\.jpg$/));
    expect(put.mock.calls.map(([pathname, , type]) => [pathname.split(".").pop(), type]).sort()).toEqual([
      ["jpg", "image/jpeg"],
      ["mp4", "video/mp4"],
    ]);

    const photo = (await store.listClips(collection.id)).find((c) => c.media === "image")!;
    expect(photo.blobUrl).toContain(".jpg");
    const episode = await createEpisode({ topic: "참새", outline: "" });
    await saveScript(episode.id, toDraft(validSubmission()), { source: "generated", warnings: [], model: null, usage: null });
    await query("update episodes set status = 'approved' where id = $1", [episode.id]);
    const asset = await fillSceneWithClip((await getEpisode(episode.id))!, 1, photo.id);
    expect(asset).toMatchObject({ kind: "image", model: "clip", credits: 0, meta: { clipId: photo.id } });
  });
});
