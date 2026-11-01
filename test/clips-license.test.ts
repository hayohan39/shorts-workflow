import { describe, expect, it } from "vitest";
import { classifyCreativeCommons, classifyKogl } from "@/pipeline/clips/license";

const cc = (name: string | null, url: string | null = null) => classifyCreativeCommons({ name, url }, {});

describe("라이선스 판정", () => {
  it("CC 주소로 허용 라이선스를 판정하고 버전을 붙인다", () => {
    expect(cc(null, "https://creativecommons.org/licenses/by/4.0/")).toMatchObject({ code: "cc-by", name: "CC BY 4.0" });
    expect(cc(null, "http://creativecommons.org/licenses/by-sa/3.0/deed.ko")).toMatchObject({
      code: "cc-by-sa",
      name: "CC BY-SA 3.0",
    });
    expect(cc(null, "https://creativecommons.org/publicdomain/zero/1.0/")).toMatchObject({ code: "cc0" });
    expect(cc(null, "http://creativecommons.org/publicdomain/mark/1.0/")).toMatchObject({ code: "pd" });
    expect(cc(null, "http://creativecommons.org/licenses/publicdomain/")).toMatchObject({ code: "pd" });
  });

  it("비영리·변경금지는 제외한다", () => {
    expect(cc(null, "https://creativecommons.org/licenses/by-nc/4.0/")).toBeNull();
    expect(cc(null, "https://creativecommons.org/licenses/by-nc-sa/4.0/")).toBeNull();
    expect(cc(null, "https://creativecommons.org/licenses/by-nd/4.0/")).toBeNull();
    expect(cc("CC BY-NC-SA 4.0")).toBeNull();
    expect(cc("CC BY-ND 2.0")).toBeNull();
  });

  it("이름(Wikimedia LicenseShortName)으로도 판정한다", () => {
    expect(cc("CC BY-SA 4.0")).toMatchObject({ code: "cc-by-sa", name: "CC BY-SA 4.0" });
    expect(cc("CC BY 2.0")).toMatchObject({ code: "cc-by", name: "CC BY 2.0" });
    expect(cc("CC0")).toMatchObject({ code: "cc0" });
    expect(cc("Public domain")).toMatchObject({ code: "pd" });
  });

  it("판단할 수 없으면 제외한다", () => {
    expect(cc(null, null)).toBeNull();
    expect(cc("GFDL")).toBeNull();
    expect(cc("All rights reserved")).toBeNull();
    expect(cc(null, "https://example.com/licenses/by/4.0/")).toBeNull();
  });

  it("주소가 이름보다 우선하고, 원문을 그대로 남긴다", () => {
    const raw = { LicenseShortName: "CC BY 4.0" };
    const license = classifyCreativeCommons({ name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by-sa/4.0/" }, raw);
    expect(license).toEqual({ code: "cc-by-sa", name: "CC BY-SA 4.0", url: "https://creativecommons.org/licenses/by-sa/4.0/", raw });
  });

  it("공공누리는 제1유형만 허용한다", () => {
    expect(classifyKogl("공공누리 제1유형: 출처표시", null, {})).toMatchObject({ code: "kogl-1" });
    expect(classifyKogl("KOGL Type 1", null, {})).toMatchObject({ code: "kogl-1" });
    expect(classifyKogl("공공누리 제2유형: 출처표시+상업적 이용금지", null, {})).toBeNull();
    expect(classifyKogl("제4유형", null, {})).toBeNull();
    expect(classifyKogl(null, null, {})).toBeNull();
  });
});
