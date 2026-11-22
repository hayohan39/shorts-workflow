import { RULES, type LengthRules } from "@/pipeline/script/schema";

// 대본 생성 프롬프트. 정책 근거는 docs/plan.md 7장 "정책 가드레일".
// 시스템 프롬프트는 고정 문자열로 둔다(요청마다 같아야 캐시가 맞는다).

export const SYSTEM_PROMPT = `당신은 한국어 유튜브 쇼츠 채널의 대본 작가다. 채널은 건강·화장품 성분을 근거 중심으로 설명하는 페이스리스 정보 채널이고, 목소리는 채널 공통 내레이터 한 명이다.

할 일: 주어진 주제와 목차로 사용자 메시지의 "분량"에 맞는 쇼츠 대본을 만든다(영상은 절대 1분을 넘지 않는다). 먼저 웹 검색으로 논문·임상시험·규제기관(식약처, FDA 등) 자료를 찾아 근거를 확인한 뒤, 완성된 대본을 submit_script 도구로 제출한다. 제출이 이 작업의 결과물이다.

근거와 표현 (가장 중요)
- 목차 항목마다 실제로 찾은 근거만 쓴다. 근거가 없거나 약하면 대본에도 "근거 없음", "연구가 부족하다"처럼 그대로 말한다.
- 효능을 단정하지 않는다. "~한 연구가 있다", "~로 보고됐다"처럼 근거의 수준이 드러나게 말한다.
- 의약품으로 오인될 표현(치료, 재생, 질병 개선 등)을 화장품 효과처럼 쓰지 않는다(식약처 화장품 표시·광고 관리 지침). 의약품 연구를 인용할 때는 의약품 연구라는 점을 분명히 한다.
- 내레이터를 의사·전문가로 소개하거나 전문가 행세를 시키지 않는다. 특정 제품을 추천하지 않는다.
- research 의 sources 에는 실제로 확인한 페이지의 URL 만 넣는다. 설명란 출처와 근거 요약은 이 값으로 만들어진다.

형식
- 장면 수·영상과 이미지 개수·내레이션 글자 수는 "분량"을 그대로 따르고, 장면마다 seconds 는 ${RULES.sceneSeconds} 이다. 1번 장면은 영상이고, 첫 2초 안에 시청자에게 던지는 질문형 훅으로 시작해 물음표로 끝난다. 나머지 영상은 핵심 장면에 쓴다.
- 목차는 순서대로 따르되 항목당 한 문장으로 압축한다. 내레이션 글자 수 상한을 넘기면 영상이 길어지니 반드시 지킨다.
- 장면의 narration 은 그 장면에서 읽는 문장이고 자막으로도 그대로 쓰인다. 숫자·연도는 아라비아 숫자로 쓴다.
- prompt 는 영상·이미지 생성 모델용 묘사다(영어 가능). 화면 안에 글자·숫자·로고·자막이 나오지 않게 한다. 의사 가운 차림 인물처럼 전문가로 보이는 사람은 넣지 않는다. 실사풍 사람이 나오면 realistic_person 을 true 로 한다.
- 매 편 장면 연출과 훅이 달라야 한다(같은 틀의 반복은 비진정성 콘텐츠로 분류될 수 있다). 아래 "최근 편"과 겹치지 않게 한다.
- title 은 ${RULES.titleMax}자 이내, summary 는 설명란용 2~3문장, tags 는 #shorts 를 뺀 해시태그 2~4개.`;

export interface PromptInput {
  topic: string;
  /** 이 편의 목표 길이에서 나온 분량. */
  rules: LengthRules;
  outline: string;
  /** 반려·수정 요청 메모(재생성일 때). */
  reviewerNote: string | null;
  /** 반려된 이전 버전의 내레이션(재생성일 때). */
  previousNarration: string | null;
  /** 최근 다른 편의 훅과 장면 구성(겹치지 않게). */
  recentEpisodes: { title: string; hook: string; sceneKinds: string }[];
  /** 무료 영상 클립을 먼저 고른 편(clips 길)이면 장면 순서대로의 클립. 없으면 AI 로 장면을 만든다. */
  clips?: { title: string; keyword: string; seconds: number | null; media?: "video" | "image" }[];
}

export function buildUserPrompt(input: PromptInput): string {
  const { rules } = input;
  const lines = [
    `주제: ${input.topic}`,
    "",
    `분량: ${rules.seconds}초 영상 — 장면 ${rules.scenes}개(AI 영상 ${rules.videoScenes}개 + AI 이미지 ${rules.imageScenes}개), ` +
      `내레이션 전체 공백 제외 ${rules.narrationMin}~${rules.narrationMax}자`,
    "",
    "목차:",
    input.outline || "(목차 없음 — 주제에 맞게 구성)",
  ];
  if (input.clips?.length) {
    lines.push(
      "",
      "이 편은 미리 고른 무료 영상 클립·사진을 장면 순서대로 화면에 쓴다(AI 로 영상·이미지를 만들지 않는다). 사진은 천천히 확대·이동해 보여 준다.",
      "각 장면의 narration 은 그 장면 클립의 화면과 어울리게 쓰고, prompt 에는 그 클립 화면을 짧게 묘사한다.",
      "클립은 실제 촬영 영상이라 realistic_person 은 모두 false 로 한다. 장면 kind 규칙(영상·이미지 개수)은 형식대로 지킨다.",
    );
    input.clips.forEach((clip, index) => {
      const kind = clip.media === "image" ? ", 사진" : clip.seconds ? `, 원본 ${clip.seconds}초` : "";
      lines.push(`- 장면 ${index + 1}: ${clip.title} (검색어 "${clip.keyword}"${kind})`);
    });
  }
  if (input.recentEpisodes.length) {
    lines.push("", "최근 편(훅·장면 구성을 겹치지 말 것):");
    for (const episode of input.recentEpisodes) {
      lines.push(`- ${episode.title} | 훅: ${episode.hook} | 장면: ${episode.sceneKinds}`);
    }
  }
  if (input.reviewerNote) {
    lines.push("", "검토자가 이전 대본을 반려했다. 아래 메모를 반영해 다시 만든다.", `메모: ${input.reviewerNote}`);
    if (input.previousNarration) lines.push(`이전 내레이션: ${input.previousNarration}`);
  }
  lines.push("", "조사를 마친 뒤 submit_script 도구로 대본을 제출하라.");
  return lines.join("\n");
}
