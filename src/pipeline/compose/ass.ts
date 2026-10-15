import { countChars } from "@/pipeline/script/schema";
import type { Timeline } from "@/pipeline/compose/timeline";

// 자막(ASS). 대본에서 직접 만든다(음성 인식 없음). 장면 안에서는 문장·줄 단위로 나누고
// 글자 수 비율로 시간을 나눈다. 숫자·연도는 노란색으로 강조하고, 하단에 고지를 계속 띄운다.

export const FONT_NAME = "Noto Sans CJK KR";
export const NOTICE = "※ 의학적 조언이 아닙니다";
/** 한 줄 최대 글자 수(공백 포함). 1080px 폭에서 72px 글씨 기준. */
export const LINE_MAX = 16;

const YELLOW = "&H0000FFFF&";

/** 0:00:01.23 형식(ASS 는 1/100초). */
export function assTime(seconds: number): string {
  const cs = Math.max(0, Math.round(seconds * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
}

/** ASS 제어 문자({ } \)가 자막 글자로 보이게 바꾼다. */
function escapeText(text: string): string {
  return text.replace(/\\/g, "＼").replace(/\{/g, "｛").replace(/\}/g, "｝");
}

/** 숫자·연도·퍼센트를 노란색으로. */
export function highlightNumbers(text: string): string {
  return escapeText(text).replace(/\d[\d,.]*\s?(?:%|퍼센트|년|배|명|개|mg|ml)?/g, (match) => `{\\c${YELLOW}}${match}{\\r}`);
}

/** 문장 단위로 자른 뒤 줄 길이에 맞춰 공백에서 나눈다. */
export function splitLines(text: string, max = LINE_MAX): string[] {
  const lines: string[] = [];
  for (const sentence of text.split(/(?<=[.?!。？！])\s+/).filter(Boolean)) {
    let line = "";
    for (const word of sentence.split(/\s+/)) {
      if (line && [...`${line} ${word}`].length > max) {
        lines.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

export interface Cue {
  start: number;
  end: number;
  lines: string[];
}

/** 장면마다 두 줄씩 묶어 자막 하나로. 시간은 그 장면의 말하는 시간을 글자 수 비율로 나눈다. */
export function buildCues(timeline: Timeline): Cue[] {
  const cues: Cue[] = [];
  for (const scene of timeline.scenes) {
    const lines = splitLines(scene.narration);
    const groups: string[][] = [];
    for (let i = 0; i < lines.length; i += 2) groups.push(lines.slice(i, i + 2));
    const weights = groups.map((group) => Math.max(countChars(group.join("")), 1));
    const sum = weights.reduce((a, b) => a + b, 0);
    let start = scene.start;
    groups.forEach((group, index) => {
      const length = (scene.speech * weights[index]) / sum;
      // 마지막 묶음은 장면 끝까지 남긴다(다음 장면 자막과 겹치지 않게 장면 길이 안에서).
      const end = index === groups.length - 1 ? scene.start + scene.duration : start + length;
      cues.push({ start, end, lines: group });
      start += length;
    });
  }
  return cues;
}

export function buildAss(timeline: Timeline): string {
  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    "PlayResX: 1080",
    "PlayResY: 1920",
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    // 본문 자막: 흰 글씨 + 두꺼운 검은 테두리, 하단 중앙(유튜브 쇼츠 하단 UI 위).
    `Style: Caption,${FONT_NAME},72,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,6,0,2,80,80,520,1`,
    // 고지: 작은 글씨 + 반투명 상자, 맨 아래.
    `Style: Notice,${FONT_NAME},36,&H00FFFFFF,&H000000FF,&H80000000,&H80000000,0,0,0,0,100,100,0,0,3,8,0,2,80,80,150,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const events = [
    `Dialogue: 1,${assTime(0)},${assTime(timeline.total)},Notice,,0,0,0,,${escapeText(NOTICE)}`,
    ...buildCues(timeline).map(
      (cue) =>
        `Dialogue: 0,${assTime(cue.start)},${assTime(cue.end)},Caption,,0,0,0,,${cue.lines.map(highlightNumbers).join("\\N")}`,
    ),
  ];
  return [...header, ...events, ""].join("\n");
}
