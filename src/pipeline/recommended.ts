import type { ModelCatalog, ModelOption } from "@/pipeline/catalog";
import type { Settings } from "@/pipeline/settings";

// 설정을 비워 두었을 때 쓰는 추천 모델(가성비 기준). 기획서 5장의 크레딧표를 따른다:
//   영상 Kling 3.0 Standard (초당 21 → 5초 105) · 이미지 Seedream 4.5 (장당 23) · 음성 ElevenLabs v3 (1회 75)
// ManyMotions 목록의 ID 는 바뀔 수 있어서 이름으로 찾는다. 앞의 패턴일수록 우선한다.
// 못 찾으면 세로 9:16(영상은 5초도)을 지원하는 첫 모델을 쓴다.

const PATTERNS: Record<"video" | "image" | "audio", RegExp[]> = {
  video: [/kling.*3(\.0)?.*(std|standard)/i, /kling.*3/i],
  image: [/seedream.*4\.?5/i, /seedream/i],
  audio: [/eleven.*v3/i, /eleven/i],
};

function usable(option: ModelOption): boolean {
  return option.vertical !== false && option.fiveSeconds !== false;
}

export function recommendedOption(kind: keyof typeof PATTERNS, options: ModelOption[]): ModelOption | null {
  const candidates = options.filter(usable);
  for (const pattern of PATTERNS[kind]) {
    const found = candidates.find((option) => pattern.test(option.label) || pattern.test(option.id));
    if (found) return found;
  }
  return candidates[0] ?? null;
}

export interface RecommendedModels {
  video: string | null;
  image: string | null;
  voice: string | null;
}

export function recommendedModels(catalog: ModelCatalog): RecommendedModels {
  return {
    video: recommendedOption("video", catalog.video)?.id ?? null,
    image: recommendedOption("image", catalog.image)?.id ?? null,
    voice: recommendedOption("audio", catalog.audio)?.id ?? null,
  };
}

/** 실제로 쓸 모델: 설정에 저장된 값, 없으면 추천 모델. */
export function effectiveModels(settings: Settings, catalog: ModelCatalog): RecommendedModels {
  const recommended = recommendedModels(catalog);
  return {
    video: settings.videoModel ?? recommended.video,
    image: settings.imageModel ?? recommended.image,
    voice: settings.voiceModel ?? recommended.voice,
  };
}
