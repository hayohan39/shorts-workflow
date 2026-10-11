import type { ScriptSubmission } from "@/pipeline/script/schema";

/** 규칙을 지키는 대본 제출 예시 (내레이션 공백 제외 150~170자). */
export function validSubmission(overrides: Partial<ScriptSubmission> = {}): ScriptSubmission {
  return {
    research: [
      {
        claim: "당뇨발 궤양 RCT 에서 완치율 37% 대 19%",
        evidence: "strong",
        sources: [{ title: "Squadrito 2014", url: "https://pubmed.ncbi.nlm.nih.gov/24685532/" }],
      },
      { claim: "바르는 PDRN 의 임상 근거", evidence: "none", sources: [] },
    ],
    scenes: [
      { no: 1, kind: "video", seconds: 5, narration: "연어에서 뽑은 DNA를 얼굴에 바르면 정말 효과가 있을까요?", prompt: "salmon swimming upstream, cinematic", realistic_person: false },
      { no: 2, kind: "image", seconds: 5, narration: "PDRN은 연어 정소에서 추출한 DNA 조각으로 원래 의약품 연구에서 시작된 성분입니다.", prompt: "macro DNA strands, soft light", realistic_person: false },
      { no: 3, kind: "video", seconds: 5, narration: "2014년 당뇨발 궤양 임상에서는 완치율이 37%로 대조군 19%보다 높게 보고됐습니다.", prompt: "abstract cells moving, blue tones", realistic_person: false },
      { no: 4, kind: "image", seconds: 5, narration: "하지만 바르는 화장품 형태의 효과는 아직 사람 대상 임상 근거가 부족하니 성분 함량과 표기를 꼼꼼히 확인하세요.", prompt: "cosmetic bottles on a shelf, no text", realistic_person: false },
    ],
    title: "연어 DNA 화장품, 진짜 효과 있을까?",
    summary: "PDRN 의 연구 근거와 한계를 정리했습니다.",
    tags: ["PDRN", "#피부과학", "화장품성분"],
    ...overrides,
  };
}
