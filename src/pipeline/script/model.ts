// 대본 생성 모델. 설정 화면에서 바꿀 수 있고, 비워 두면 이 기본값을 쓴다.
// 기본은 가장 싼 Haiku 5.5 (입력 $0.10 / 출력 $0.50 per 1M 토큰). 품질이 부족하면 설정에서 Sonnet·Opus 로 올린다.
export const DEFAULT_SCRIPT_MODEL = "claude-haiku-5-5";

/** 모델마다 다른 요청 옵션. 설정에서 고른 모델에 맞춰 요청을 만든다. */
export interface ModelProfile {
  /** 웹 검색·읽기 도구 버전. 동적 필터링(_20260209)은 일부 모델에서만 된다. */
  webSearch: "web_search_20260209" | "web_search_20250305";
  webFetch: "web_fetch_20260209" | "web_fetch_20250910";
  /** output_config.effort 를 받는가(Haiku 4.5·Sonnet 4.5 이전은 400). */
  effort: boolean;
  /** 안전 분류기 거절 시 서버 측 대체 모델(fallbacks: "default")을 쓸 수 있는가. */
  fallbacks: boolean;
}

const DYNAMIC_FILTERING = /^claude-(opus-5|opus-4-[678]|sonnet-5|sonnet-4-6|fable-5|mythos-5)/;
const NO_EFFORT = /^claude-(haiku-4|sonnet-4-5|opus-4-[01]|3)/;
const SERVER_FALLBACKS = /^claude-(opus-5-5|opus-5$|sonnet-5-5|fable-5-1)/;

export function modelProfile(model: string): ModelProfile {
  const dynamic = DYNAMIC_FILTERING.test(model);
  return {
    webSearch: dynamic ? "web_search_20260209" : "web_search_20250305",
    webFetch: dynamic ? "web_fetch_20260209" : "web_fetch_20250910",
    effort: !NO_EFFORT.test(model),
    fallbacks: SERVER_FALLBACKS.test(model),
  };
}
