import type { Scene } from "@/pipeline/script/schema";
import { countChars, TAIL_SECONDS } from "@/pipeline/script/schema";

// 영상 타임라인: 내레이션 실제 길이를 장면별 내레이션 글자 수 비율로 나눈다(docs/plan.md 2장).
// 장면이 바뀌는 때와 그 장면의 자막이 같이 움직이게 하기 위해서다. 영상 장면이 원본보다 길어지면
// 마지막 프레임을 늘리고, 이미지 장면은 그 길이만큼 천천히 확대·이동한다.

export { TAIL_SECONDS };
/** 장면 하나의 최소 길이(초). 아주 짧은 문장이어도 화면이 번쩍 지나가지 않게. */
export const MIN_SCENE_SECONDS = 1.5;

export interface TimelineScene {
  no: number;
  kind: Scene["kind"];
  narration: string;
  start: number;
  /** 화면에 보이는 길이(마지막 장면은 여유 포함). */
  duration: number;
  /** 이 장면의 내레이션이 읽히는 길이(자막 타이밍용). */
  speech: number;
}

export interface Timeline {
  scenes: TimelineScene[];
  total: number;
}

const round = (seconds: number) => Math.round(seconds * 1000) / 1000;

export function planTimeline(scenes: Pick<Scene, "no" | "kind" | "narration">[], narrationSeconds: number): Timeline {
  if (!scenes.length) throw new Error("장면이 없습니다.");
  if (!(narrationSeconds > 0)) throw new Error("내레이션 길이를 알 수 없습니다.");
  const weights = scenes.map((scene) => Math.max(countChars(scene.narration), 1));
  const sum = weights.reduce((a, b) => a + b, 0);
  let start = 0;
  const planned = scenes.map((scene, index) => {
    const speech = round(Math.max((narrationSeconds * weights[index]) / sum, MIN_SCENE_SECONDS));
    const duration = round(index === scenes.length - 1 ? speech + TAIL_SECONDS : speech);
    const item = { no: scene.no, kind: scene.kind, narration: scene.narration, start: round(start), duration, speech };
    start += duration;
    return item;
  });
  return { scenes: planned, total: round(start) };
}
