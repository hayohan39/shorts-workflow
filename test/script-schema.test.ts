import { describe, expect, it } from "vitest";
import { checkGuardrails, findForbidden } from "@/pipeline/script/guardrails";
import { countChars, DISCLAIMER, toDraft, validateScript } from "@/pipeline/script/schema";
import { validSubmission } from "./helpers/script";

describe("대본 형식", () => {
  it("예시 대본은 규칙을 지킨다", () => {
    const draft = toDraft(validSubmission());
    expect(countChars(draft.narration)).toBeGreaterThanOrEqual(150);
    expect(countChars(draft.narration)).toBeLessThanOrEqual(170);
    expect(validateScript(draft)).toEqual({ errors: [], warnings: [] });
  });

  it("저장 형태: 내레이션은 장면을 이어 붙이고, #shorts 를 맨 앞에, 설명란에 출처와 고지", () => {
    const draft = toDraft(validSubmission({ tags: ["PDRN", "#PDRN", " 피부 과학 ", "a", "b", "c"] }));
    expect(draft.narration.startsWith("연어에서 뽑은 DNA")).toBe(true);
    expect(draft.tags).toEqual(["#shorts", "#PDRN", "#피부과학", "#a", "#b"]);
    expect(draft.description).toContain("출처\n- Squadrito 2014: https://pubmed.ncbi.nlm.nih.gov/24685532/");
    expect(draft.description.endsWith(DISCLAIMER)).toBe(true);
    expect(draft.needsAiDisclosure).toBe(false);
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
    const { errors } = validateScript(toDraft(submission));
    expect(errors.map((e) => e.message)).toEqual([
      "영상 2개 + 이미지 2개여야 합니다(현재 영상 1, 이미지 3).",
      "1번 장면(훅)은 영상이어야 합니다.",
      "3번 장면은 5초여야 합니다.",
    ]);
    expect(validateScript(toDraft(validSubmission({ scenes: validSubmission().scenes.slice(0, 3) }))).errors[0].message).toContain(
      "정확히 4개",
    );
  });

  it("길이·훅·제목·출처 문제는 경고", () => {
    const submission = validSubmission({ title: "가".repeat(41), research: [{ claim: "x", evidence: "none", sources: [] }] });
    submission.scenes[0].narration = "짧은 훅.";
    const fields = validateScript(toDraft(submission)).warnings.map((w) => w.field);
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
