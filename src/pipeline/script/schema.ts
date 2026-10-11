// 대본 형식 (docs/plan.md 2장 "쇼츠 포맷 규격").
// Claude 는 submit_script 도구로 이 형식을 제출하고(strict 스키마), 길이·개수처럼 스키마로
// 표현할 수 없는 규칙은 validateScript 가 검사한다.

export type EvidenceLevel = "strong" | "limited" | "none";
export type SceneKind = "video" | "image";

export interface ResearchItem {
  claim: string;
  evidence: EvidenceLevel;
  sources: { title: string; url: string }[];
}

export interface Scene {
  no: number;
  kind: SceneKind;
  seconds: number;
  /** 이 장면에서 읽는 내레이션(= 자막). */
  narration: string;
  /** 영상·이미지 생성 프롬프트. 글자를 넣지 않는다. */
  prompt: string;
  /** 실사풍 사람이 나오는가 → AI 합성 콘텐츠 공개 표시. */
  realistic_person: boolean;
}

/** Claude 가 제출하는 형태. */
export interface ScriptSubmission {
  research: ResearchItem[];
  scenes: Scene[];
  title: string;
  summary: string;
  tags: string[];
}

/** DB 에 저장하는 형태. */
export interface ScriptDraft {
  research: ResearchItem[];
  scenes: Scene[];
  narration: string;
  title: string;
  description: string;
  tags: string[];
  needsAiDisclosure: boolean;
}

export interface Problem {
  field: string;
  message: string;
}

export const RULES = {
  scenes: 4,
  videoScenes: 2,
  imageScenes: 2,
  sceneSeconds: 5,
  narrationMin: 150,
  narrationMax: 170,
  titleMax: 40,
  tagsMin: 3,
  tagsMax: 5,
} as const;

export const DISCLAIMER = "※ 이 영상은 정보 제공용이며 의학적 조언이 아닙니다. 피부·건강 문제는 전문의와 상담하세요.";

/** submit_script 도구의 입력 스키마 (strict: 모든 객체에 additionalProperties: false). */
export const SUBMISSION_SCHEMA = {
  type: "object",
  properties: {
    research: {
      type: "array",
      description: "목차 항목별 근거. 근거가 없으면 evidence 를 none 으로 두고 sources 는 빈 배열.",
      items: {
        type: "object",
        properties: {
          claim: { type: "string", description: "대본에서 말하는 주장 한 문장" },
          evidence: { type: "string", enum: ["strong", "limited", "none"] },
          sources: {
            type: "array",
            items: {
              type: "object",
              properties: { title: { type: "string" }, url: { type: "string" } },
              required: ["title", "url"],
              additionalProperties: false,
            },
          },
        },
        required: ["claim", "evidence", "sources"],
        additionalProperties: false,
      },
    },
    scenes: {
      type: "array",
      description: "정확히 4개. 1번은 질문형 훅 영상. 영상 2개 + 이미지 2개, 각 5초.",
      items: {
        type: "object",
        properties: {
          no: { type: "integer" },
          kind: { type: "string", enum: ["video", "image"] },
          seconds: { type: "integer" },
          narration: { type: "string", description: "이 장면의 내레이션(자막으로도 그대로 쓰임)" },
          prompt: { type: "string", description: "영상·이미지 생성 프롬프트(영어 가능). 화면에 글자·숫자·로고 금지" },
          realistic_person: { type: "boolean", description: "실사풍 사람이 등장하면 true" },
        },
        required: ["no", "kind", "seconds", "narration", "prompt", "realistic_person"],
        additionalProperties: false,
      },
    },
    title: { type: "string", description: "유튜브 제목, 40자 이내" },
    summary: { type: "string", description: "설명란 요약 2~3문장 (출처·고지는 시스템이 덧붙임)" },
    tags: { type: "array", items: { type: "string" }, description: "#shorts 를 뺀 해시태그 2~4개" },
  },
  required: ["research", "scenes", "title", "summary", "tags"],
  additionalProperties: false,
} as const;

const compact = (text: string) => text.replace(/\s+/g, " ").trim();

/** 공백을 뺀 글자 수 (내레이션 길이 기준). */
export function countChars(text: string): number {
  return [...text.replace(/\s/g, "")].length;
}

function normalizeTag(tag: string): string {
  const bare = tag.trim().replace(/^#+/, "").replace(/\s+/g, "");
  return bare ? `#${bare}` : "";
}

/** 출처 목록과 고지를 붙인 설명란. */
export function buildDescription(summary: string, research: ResearchItem[]): string {
  const seen = new Set<string>();
  const sources: string[] = [];
  for (const item of research) {
    for (const source of item.sources) {
      if (!isWebUrl(source.url) || seen.has(source.url)) continue;
      seen.add(source.url);
      sources.push(`- ${compact(source.title)}: ${source.url}`);
    }
  }
  return [compact(summary), "", "출처", ...(sources.length ? sources : ["- (확인된 출처 없음)"]), "", DISCLAIMER].join("\n");
}

const isWebUrl = (url: string) => /^https?:\/\//i.test(url.trim());

/**
 * 제출된 대본을 저장 형태로 바꾼다. 해시태그는 #shorts 를 맨 앞에 두고 최대 5개.
 * 출처는 http(s) 링크만 남긴다(웹 조사 중 들어온 javascript: 같은 링크가 화면에 노출되지 않게).
 */
export function toDraft(submission: ScriptSubmission): ScriptDraft {
  const research = submission.research.map((item) => ({
    ...item,
    sources: item.sources.filter((source) => isWebUrl(source.url)).map((source) => ({ ...source, url: source.url.trim() })),
  }));
  const scenes = [...submission.scenes]
    .sort((a, b) => a.no - b.no)
    .map((scene, index) => ({
      ...scene,
      no: index + 1,
      narration: compact(scene.narration),
      prompt: compact(scene.prompt),
    }));
  const tags = ["#shorts", ...submission.tags.map(normalizeTag)].filter(
    (tag, index, all) => tag && all.indexOf(tag) === index,
  );
  return {
    research,
    scenes,
    narration: scenes.map((scene) => scene.narration).join(" "),
    title: compact(submission.title),
    description: buildDescription(submission.summary, research),
    tags: tags.slice(0, RULES.tagsMax),
    needsAiDisclosure: scenes.some((scene) => scene.realistic_person),
  };
}

/**
 * 규칙 검사.
 * errors: 다음 단계(장면 생성)가 깨지는 문제 → Claude 에게 고치게 하거나 저장을 막는다.
 * warnings: 사람이 보고 판단할 문제 → 검토 화면에 표시.
 */
export function validateScript(draft: ScriptDraft): { errors: Problem[]; warnings: Problem[] } {
  const errors: Problem[] = [];
  const warnings: Problem[] = [];
  const { scenes } = draft;

  if (scenes.length !== RULES.scenes) {
    errors.push({ field: "scenes", message: `장면은 정확히 ${RULES.scenes}개여야 합니다(현재 ${scenes.length}개).` });
  }
  const videos = scenes.filter((scene) => scene.kind === "video").length;
  const images = scenes.filter((scene) => scene.kind === "image").length;
  if (videos !== RULES.videoScenes || images !== RULES.imageScenes) {
    errors.push({ field: "scenes", message: `영상 ${RULES.videoScenes}개 + 이미지 ${RULES.imageScenes}개여야 합니다(현재 영상 ${videos}, 이미지 ${images}).` });
  }
  if (scenes[0] && scenes[0].kind !== "video") {
    errors.push({ field: "scenes", message: "1번 장면(훅)은 영상이어야 합니다." });
  }
  scenes.forEach((scene) => {
    if (scene.seconds !== RULES.sceneSeconds) {
      errors.push({ field: `scenes.${scene.no}`, message: `${scene.no}번 장면은 ${RULES.sceneSeconds}초여야 합니다.` });
    }
    if (!scene.narration) errors.push({ field: `scenes.${scene.no}`, message: `${scene.no}번 장면에 내레이션이 없습니다.` });
    if (!scene.prompt) errors.push({ field: `scenes.${scene.no}`, message: `${scene.no}번 장면에 생성 프롬프트가 없습니다.` });
  });
  if (!draft.title) errors.push({ field: "title", message: "제목이 없습니다." });

  const length = countChars(draft.narration);
  if (length < RULES.narrationMin || length > RULES.narrationMax) {
    warnings.push({ field: "narration", message: `내레이션 ${length}자 (기준 ${RULES.narrationMin}~${RULES.narrationMax}자, 공백 제외)` });
  }
  if (scenes[0] && !/[?？]\s*$/.test(scenes[0].narration)) {
    warnings.push({ field: "scenes.1", message: "첫 장면이 질문형 훅이 아닙니다." });
  }
  if ([...draft.title].length > RULES.titleMax) {
    warnings.push({ field: "title", message: `제목 ${[...draft.title].length}자 (기준 ${RULES.titleMax}자 이내)` });
  }
  if (draft.tags.length < RULES.tagsMin) {
    warnings.push({ field: "tags", message: `해시태그 ${draft.tags.length}개 (기준 ${RULES.tagsMin}~${RULES.tagsMax}개)` });
  }
  if (!draft.research.some((item) => item.sources.length > 0)) {
    warnings.push({ field: "research", message: "출처 링크가 하나도 없습니다(설명란 출처 필수)." });
  }
  return { errors, warnings };
}
