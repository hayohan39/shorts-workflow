import { orientationOf, type ClipCandidate, type Orientation } from "@/pipeline/clips/types";

// 후보에서 쇼츠 한 편 분량을 고른다.
//   - 클립 하나는 3~30초, 합계는 60~120초(90초 근처에서 멈춘다)
//   - 세로 > 정사각 > 가로, 같으면 해상도가 높은 것
//   - 같은 클립(소스·ID 또는 제목·길이가 같은 것)은 하나만
//   - 소스를 번갈아 골라 한 소스에 몰리지 않게
// 길이를 모르는 후보와 링크만 있는 후보(받을 파일 없음)는 고르지 않는다(교체 후보로는 남는다).

const SELECT_RULES = { minClipSec: 3, maxClipSec: 30, minTotalSec: 60, targetTotalSec: 90, maxTotalSec: 120 };

const ORIENTATION_SCORE: Record<Orientation, number> = { vertical: 3, square: 2, horizontal: 1 };

export interface Selection {
  /** 고른 순서대로 */
  selected: ClipCandidate[];
  /** 나머지(점수 순). 화면의 [교체] 후보 */
  alternates: ClipCandidate[];
  totalSec: number;
  /** 60초에 못 미치면 이유 */
  shortfall: string | null;
}

function clipScore(clip: ClipCandidate): number {
  const orientation = orientationOf(clip.width, clip.height);
  const shortSide = Math.min(clip.width ?? 0, clip.height ?? 0);
  const resolution = shortSide >= 1080 ? 0.5 : shortSide >= 720 ? 0.25 : 0;
  return (orientation ? ORIENTATION_SCORE[orientation] : 0) + resolution;
}

function isSelectable(clip: ClipCandidate): boolean {
  const seconds = clip.durationSec;
  return (
    clip.downloadUrl !== null &&
    seconds !== null &&
    seconds >= SELECT_RULES.minClipSec &&
    seconds <= SELECT_RULES.maxClipSec
  );
}

/** 같은 클립을 하나만 남긴다(먼저 나온 것 유지). */
export function dedupeClips(clips: ClipCandidate[]): ClipCandidate[] {
  const seen = new Set<string>();
  return clips.filter((clip) => {
    const keys = [`${clip.source}:${clip.sourceId}`];
    const title = clip.title.toLowerCase().replace(/\.[a-z0-9]{2,4}$/, "").replace(/[^\p{L}\p{N}]+/gu, "");
    if (title && clip.durationSec !== null) keys.push(`${title}:${Math.round(clip.durationSec)}`);
    if (keys.some((key) => seen.has(key))) return false;
    keys.forEach((key) => seen.add(key));
    return true;
  });
}

export function selectClips(candidates: ClipCandidate[]): Selection {
  const ranked = dedupeClips(candidates).sort((a, b) => clipScore(b) - clipScore(a));

  // 소스별 대기열(점수 순)을 돌아가며 하나씩 꺼낸다.
  const queues = new Map<string, ClipCandidate[]>();
  for (const clip of ranked.filter(isSelectable)) {
    queues.set(clip.source, [...(queues.get(clip.source) ?? []), clip]);
  }
  const selected: ClipCandidate[] = [];
  let totalSec = 0;
  while (totalSec < SELECT_RULES.targetTotalSec && [...queues.values()].some((queue) => queue.length > 0)) {
    for (const queue of queues.values()) {
      const index = queue.findIndex((clip) => totalSec + clip.durationSec! <= SELECT_RULES.maxTotalSec);
      if (index < 0) {
        queue.length = 0;
        continue;
      }
      const [clip] = queue.splice(index, 1);
      selected.push(clip);
      totalSec += clip.durationSec!;
      if (totalSec >= SELECT_RULES.targetTotalSec) break;
    }
  }

  const picked = new Set(selected);
  return {
    selected,
    alternates: ranked.filter((clip) => !picked.has(clip)),
    totalSec,
    shortfall: shortfallReason(ranked, totalSec),
  };
}

function shortfallReason(ranked: ClipCandidate[], totalSec: number): string | null {
  if (totalSec >= SELECT_RULES.minTotalSec) return null;
  const usable = ranked.filter(isSelectable).length;
  if (ranked.length === 0) return "허용 라이선스의 검색 결과가 없습니다.";
  if (usable === 0) return `후보 ${ranked.length}개가 모두 길이 조건(3~30초)에 맞지 않거나 받을 수 없는 클립입니다.`;
  return `조건에 맞는 클립이 ${usable}개뿐이라 합계 ${Math.round(totalSec)}초입니다(목표 60초 이상).`;
}
