import { describe, expect, it } from "vitest";
import { dedupeClips, selectClips } from "@/pipeline/clips/select";
import { clip } from "./helpers/clips";

const seconds = (clips: { durationSec: number | null }[]) => clips.reduce((sum, c) => sum + (c.durationSec ?? 0), 0);

describe("클립 선별", () => {
  it("합계 90초에 닿으면 멈추고 120초를 넘기지 않는다", () => {
    const result = selectClips(Array.from({ length: 20 }, () => clip({ durationSec: 20 })));
    expect(result.totalSec).toBe(100);
    expect(result.selected).toHaveLength(5);
    expect(result.alternates).toHaveLength(15);
    expect(result.shortfall).toBeNull();
  });

  it("넘치는 클립은 건너뛰고 들어가는 것을 고른다", () => {
    const result = selectClips([clip({ durationSec: 30 }), clip({ durationSec: 30 }), clip({ durationSec: 29 }), clip({ durationSec: 30 }), clip({ durationSec: 5 })]);
    expect(result.totalSec).toBeLessThanOrEqual(120);
    expect(result.totalSec).toBeGreaterThanOrEqual(90);
  });

  it("3~30초 밖, 길이를 모르는 것, 받을 파일이 없는 것은 고르지 않고 교체 후보로 남긴다", () => {
    const outside = [
      clip({ durationSec: 2 }),
      clip({ durationSec: 31 }),
      clip({ durationSec: null }),
      clip({ source: "gongu", downloadUrl: null }),
    ];
    const result = selectClips([...outside, clip({ durationSec: 10 })]);
    expect(result.selected).toHaveLength(1);
    expect(result.alternates).toHaveLength(4);
  });

  it("세로 > 정사각 > 가로 순으로 고른다", () => {
    const horizontal = clip({ width: 1920, height: 1080, durationSec: 30 });
    const square = clip({ width: 1080, height: 1080, durationSec: 30 });
    const vertical = clip({ width: 1080, height: 1920, durationSec: 30 });
    const result = selectClips([horizontal, square, vertical, clip({ width: 1920, height: 1080, durationSec: 30 })]);
    expect(result.selected.slice(0, 3)).toEqual([vertical, square, horizontal]);
  });

  it("소스를 번갈아 고른다", () => {
    const pixabay = Array.from({ length: 6 }, () => clip({ source: "pixabay", durationSec: 15 }));
    const nasa = Array.from({ length: 6 }, () => clip({ source: "nasa", durationSec: 15 }));
    const result = selectClips([...pixabay, ...nasa]);
    expect(result.selected.map((c) => c.source)).toEqual(["pixabay", "nasa", "pixabay", "nasa", "pixabay", "nasa"]);
  });

  it("60초에 못 미치면 이유를 남긴다", () => {
    expect(selectClips([]).shortfall).toContain("검색 결과가 없습니다");
    expect(selectClips([clip({ durationSec: 60 })]).shortfall).toContain("길이 조건");
    const short = selectClips([clip({ durationSec: 10 }), clip({ durationSec: 12 })]);
    expect(seconds(short.selected)).toBe(22);
    expect(short.shortfall).toContain("2개뿐이라 합계 22초");
  });

  it("같은 클립은 하나만 남긴다(소스·ID, 또는 제목·길이)", () => {
    const a = clip({ sourceId: "x", title: "Ocean Waves.webm", durationSec: 12.2 });
    const sameId = clip({ sourceId: "x", title: "other" });
    const sameTitle = clip({ source: "archive", sourceId: "y", title: "ocean waves", durationSec: 12.4 });
    const different = clip({ title: "ocean waves", durationSec: 20 });
    expect(dedupeClips([a, sameId, sameTitle, different])).toEqual([a, different]);
  });
});
