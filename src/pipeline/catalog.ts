// ManyMotions list_models 응답을 기능별 선택지로 나눈다.
//
// 응답 형태(2026-10 조회 결과 기준):
//   { list_models: { note, image: [{ id, name, category, aspect_ratios, requires_image, ... }],
//                    video: [{ name, t2v_id, i2v_id, durations, aspect_ratios, ... }], ... } }
// 영상 모델은 텍스트→영상 ID(t2v_id)와 이미지→영상 ID(i2v_id)가 따로 있다. 생성 때는 반드시 이 ID 를 그대로 쓴다.
// 형태가 조금 달라도 깨지지 않게, 모르는 배열은 "기타" 로 모은다.

export interface ModelOption {
  /** 생성 요청에 그대로 넘기는 ID. */
  id: string;
  label: string;
  /** 9:16 세로 화면을 지원하는가(모르면 null). */
  vertical: boolean | null;
  /** 5초 길이를 지원하는가(영상만, 모르면 null). */
  fiveSeconds: boolean | null;
  /** 짧은 부가 정보(카테고리·길이 등). */
  detail: string;
}

export interface ModelCatalog {
  /** 텍스트→영상 (장면 영상). */
  video: ModelOption[];
  /** 텍스트→이미지 (장면 이미지). */
  image: ModelOption[];
  /** 음성·오디오 (내레이션). */
  audio: ModelOption[];
  /** 위에 들지 않는 목록 {응답 키: 선택지}. */
  other: Record<string, ModelOption[]>;
}

type Entry = Record<string, unknown>;

const str = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

function vertical(entry: Entry): boolean | null {
  const ratios = list(entry.aspect_ratios ?? entry.aspectRatios ?? entry.ratios);
  return ratios.length ? ratios.map(String).includes("9:16") : null;
}

function fiveSeconds(entry: Entry): boolean | null {
  const durations = list(entry.durations);
  return durations.length ? durations.some((d) => parseFloat(String(d)) === 5) : null;
}

function base(entry: Entry, id: string, detail: string[]): ModelOption {
  return {
    id,
    label: str(entry.name) ?? str(entry.display_name) ?? id,
    vertical: vertical(entry),
    fiveSeconds: null,
    detail: detail.filter(Boolean).join(" · "),
  };
}

function videoOptions(entries: unknown[]): ModelOption[] {
  const options: ModelOption[] = [];
  for (const raw of entries) {
    const entry = (raw ?? {}) as Entry;
    // 텍스트→영상 ID. 플래그만 있고 별도 ID 가 없으면 id 를 쓴다.
    const id = str(entry.t2v_id) ?? (entry.text_to_video === true ? str(entry.id) : null);
    if (!id) continue;
    const durations = list(entry.durations)
      .map((d) => parseFloat(String(d)))
      .filter(Number.isFinite)
      .join("/");
    options.push({
      ...base(entry, id, [durations && `${durations}초`, str(entry.i2v_id) ? "이미지→영상 가능" : ""]),
      fiveSeconds: fiveSeconds(entry),
    });
  }
  return options;
}

function imageOptions(entries: unknown[]): ModelOption[] {
  const options: ModelOption[] = [];
  for (const raw of entries) {
    const entry = (raw ?? {}) as Entry;
    const id = str(entry.id);
    // 편집 모델처럼 입력 이미지가 꼭 필요한 것은 장면 이미지 생성에 쓸 수 없다.
    if (!id || entry.requires_image === true || (str(entry.category) && entry.category !== "generate")) continue;
    options.push(base(entry, id, [list(entry.resolutions).map(String).join("/")]));
  }
  return options;
}

function genericOptions(entries: unknown[]): ModelOption[] {
  const options: ModelOption[] = [];
  for (const raw of entries) {
    const entry = (raw ?? {}) as Entry;
    const id = str(entry.id) ?? str(entry.model_id) ?? str(entry.voice_id) ?? str(entry.t2v_id);
    if (id) options.push(base(entry, id, [str(entry.category) ?? str(entry.type) ?? ""]));
  }
  return options;
}

const AUDIO_KEY = /audio|voice|speech|tts|music|sound/i;

export function parseModelCatalog(listings: Record<string, unknown> | null): ModelCatalog {
  const catalog: ModelCatalog = { video: [], image: [], audio: [], other: {} };
  const root = (listings?.list_models ?? {}) as Entry;
  for (const [key, value] of Object.entries(root)) {
    if (!Array.isArray(value)) continue;
    if (/^video/i.test(key)) catalog.video.push(...videoOptions(value));
    else if (/^image/i.test(key)) catalog.image.push(...imageOptions(value));
    else if (AUDIO_KEY.test(key)) catalog.audio.push(...genericOptions(value));
    else catalog.other[key] = genericOptions(value);
  }
  return catalog;
}

/** 저장된 값이 목록에 있는가. */
export function hasOption(options: ModelOption[], id: string | null): boolean {
  return !!id && options.some((option) => option.id === id);
}

export function countOptions(catalog: ModelCatalog): number {
  return (
    catalog.video.length +
    catalog.image.length +
    catalog.audio.length +
    Object.values(catalog.other).reduce((sum, options) => sum + options.length, 0)
  );
}
