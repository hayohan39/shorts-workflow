import { describe, expect, it } from "vitest";
import { checkGuardrails, findForbidden } from "@/pipeline/script/guardrails";
import { countChars, DISCLAIMER, lengthRules, NARRATION_HARD_MAX, TARGET_SECONDS, toDraft, validateScript } from "@/pipeline/script/schema";
import { validSubmission } from "./helpers/script";

/** 예시 대본(장면 4개, 152자)은 35초 분량이다. */
const rules35 = lengthRules(35);

describe("영상 길이별 분량", () => {
  it("길이에서 장면 수(영상·이미지)와 내레이션 글자 수가 나온다", () => {
    const table = TARGET_SECONDS.map((seconds) => {
      const rules = lengthRules(seconds);
      return `${seconds}:${rules.videoScenes}+${rules.imageScenes}:${rules.narrationMin}-${rules.narrationMax}`;
    });
    expect(table).toEqual([
      "20:2+2:73-86",
      "25:2+2:92-108",
      "30:2+2:111-130",
      "35:2+2:129-152",
      "40:3+2:148-174",
      "45:3+2:167-196",
      "50:3+3:185-218",
      "55:3+3:204-240",
    ]);
    // 가장 긴 분량도 1분 상한 글자 수 안이다
    expect(lengthRules(55).narrationMax).toBeLessThan(NARRATION_HARD_MAX);
  });
});

describe("대본 형식", () => {
  it("예시 대본은 규칙을 지킨다", () => {
    const draft = toDraft(validSubmission());
    expect(countChars(draft.narration)).toBe(152);
    expect(validateScript(draft, rules35)).toEqual({ errors: [], warnings: [] });
  });

  it("길이마다 장면 수가 다르고, 1분을 넘길 내레이션은 오류로 막는다", () => {
    const draft = toDraft(validSubmission());
    expect(validateScript(draft, lengthRules(50)).errors.map((e) => e.message)).toEqual([
      "50초 영상은 장면이 정확히 6개여야 합니다(현재 4개).",
      "영상 3개 + 이미지 3개여야 합니다(현재 영상 2, 이미지 2).",
    ]);
    // 30초면 152자는 길다(경고)
    expect(validateScript(draft, lengthRules(30)).warnings[0].message).toBe("내레이션 152자 (30초 기준 111~130자, 공백 제외)");

    const long = validSubmission();
    long.scenes[3].narration = "가".repeat(NARRATION_HARD_MAX);
    const { errors, warnings } = validateScript(toDraft(long), rules35);
    expect(errors.map((e) => e.message).join()).toContain("영상이 1분을 넘습니다");
    expect(warnings.map((w) => w.field)).not.toContain("narration");
  });

  it("저장 형태: 내레이션은 장면을 이어 붙이고, #shorts 를 맨 앞에, 설명란에 출처와 고지", () => {
    const draft = toDraft(validSubmission({ tags: ["PDRN", "#PDRN", " 피부 과학 ", "a", "b", "c"] }));
    expect(draft.narration.startsWith("연어에서 뽑은 DNA")).toBe(true);
    expect(draft.tags).toEqual(["#shorts", "#PDRN", "#피부과학", "#a", "#b"]);
    expect(draft.description).toContain("출처\n- Squadrito 2014: https://pubmed.ncbi.nlm.nih.gov/24685532/");
    expect(draft.description.endsWith(DISCLAIMER)).toBe(true);
    expect(draft.needsAiDisclosure).toBe(false);
  });

  it("출처는 http(s) 링크만 남긴다", () => {
    const draft = toDraft(
      validSubmission({
        research: [
          {
            claim: "x",
            evidence: "limited",
            sources: [
              { title: "악성", url: "javascript:alert(1)" },
              { title: "데이터", url: "data:text/html,hi" },
              { title: "논문", url: " https://example.org/paper " },
            ],
          },
        ],
      }),
    );
    expect(draft.research[0].sources).toEqual([{ title: "논문", url: "https://example.org/paper" }]);
    expect(draft.description).not.toContain("javascript:");
  });

  it("실사풍 인물이 있으면 AI 합성 공개 표시", () => {
    const submission = validSubmission();
    submission.scenes[1].realistic_person = true;
    expect(toDraft(submission).needsAiDisclosure).toBe(true);
  });

  it("장면 구성이 틀리면 오류", () => {
    const submission = validSubmission();
    submission.scenes[0].kind = "image";
    submission.scenes[2].seconds = 6;
    const { errors } = validateScript(toDraft(submission), rules35);
    expect(errors.map((e) => e.message)).toEqual([
      "영상 2개 + 이미지 2개여야 합니다(현재 영상 1, 이미지 3).",
      "1번 장면(훅)은 영상이어야 합니다.",
      "3번 장면은 5초여야 합니다.",
    ]);
    expect(
      validateScript(toDraft(validSubmission({ scenes: validSubmission().scenes.slice(0, 3) })), rules35).errors[0].message,
    ).toContain("정확히 4개");
  });

  it("길이·훅·제목·출처 문제는 경고", () => {
    const submission = validSubmission({ title: "가".repeat(41), research: [{ claim: "x", evidence: "none", sources: [] }] });
    submission.scenes[0].narration = "짧은 훅.";
    submission.scenes[1].narration = "짧다.";
    const fields = validateScript(toDraft(submission), rules35).warnings.map((w) => w.field);
    expect(fields).toEqual(["narration", "scenes.1", "title", "research"]);
  });
});

describe("금지 표현 검사", () => {
  it("의약품 오인·과장·권위 차용 표현을 찾는다", () => {
    expect(findForbidden("피부 재생 효과로 여드름을 없애 줍니다").map((f) => f.match)).toEqual(["피부 재생", "여드름을 없애"]);
    expect(findForbidden("100% 효과, 부작용이 전혀 없어요").map((f) => f.reason)).toEqual([
      "효능 단정·과장",
      "안전성 단정(부작용 없음)",
    ]);
    expect(findForbidden("피부과 전문가가 추천한 성분")).toHaveLength(1);
  });

  it("고지 문구와 평범한 설명은 걸리지 않는다", () => {
    expect(findForbidden(DISCLAIMER)).toEqual([]);
    expect(findForbidden("바르는 형태는 임상 근거가 부족합니다")).toEqual([]);
  });

  it("내레이션·제목·설명란·태그 위치를 알려 준다", () => {
    const submission = validSubmission({ title: "주름 제거 끝판왕" });
    submission.scenes[2].narration = "상처 치료 연구에서 시작됐습니다.";
    const fields = checkGuardrails(toDraft(submission)).map((p) => p.field);
    expect(fields).toEqual(["scenes.3", "title"]);
  });
});
