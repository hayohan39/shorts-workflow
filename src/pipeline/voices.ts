// 내레이션 목소리. ManyMotions 영상 편집 에이전트가 쓰는 ElevenLabs 한국어 목소리 목록(2026-10-14 조회).
// 목록 조회도 에이전트 지시라 크레딧(약 20)이 들어서 매번 가져오지 않고 여기에 둔다. 목록이 바뀌면 여기를 고친다.
// API 로는 미리 듣기 주소가 없다(조회 결과 preview_url 이 모두 null). 목소리는 ManyMotions·ElevenLabs 웹에서 들어 보고 고른다.

export interface Voice {
  id: string;
  name: string;
  gender: "여성" | "남성";
  age: "젊음" | "중년" | "노년";
  tone: string;
}

export const VOICES: readonly Voice[] = [
  { id: "5n5gqmaQi9Ewevrz7bOS", name: "Sian", gender: "여성", age: "젊음", tone: "부드럽고 선명, 내레이션" },
  { id: "F9mMsBUFaCLedtYXXjLD", name: "Leejin", gender: "여성", age: "젊음", tone: "따뜻하고 전문적, 광고·오디오북" },
  { id: "5I7B1di44aCL15NkP0jn", name: "Kanna", gender: "여성", age: "젊음", tone: "친구 같은 친근한 톤" },
  { id: "hWXqitL3DEOLD49pgNWR", name: "Ruach", gender: "여성", age: "중년", tone: "감성적이고 따뜻함, 오디오북" },
  { id: "nbrxrAz3eYm9NgojrmFK", name: "Min-joon", gender: "남성", age: "젊음", tone: "중립적, 유튜브 스토리텔링" },
  { id: "v1jVu1Ky28piIPEJqRrm", name: "David", gender: "남성", age: "젊음", tone: "따뜻하고 절제된 내레이션" },
  { id: "sQ3a15DhENXU8pKTHlcc", name: "Mr. K", gender: "남성", age: "젊음", tone: "차분하고 권위 있는 중저음" },
  { id: "hjCvGtSCRPyjYwe2lDf1", name: "Juan", gender: "남성", age: "중년", tone: "깊고 전문적, 교육·뉴스" },
  { id: "pb3lVZVjdFWbkhPKlelB", name: "Harry Kim", gender: "남성", age: "중년", tone: "차분한 대화체, 팟캐스트" },
  { id: "H9ihk5yaEtJLXjhBgRaF", name: "Jay Lee", gender: "남성", age: "중년", tone: "다큐·튜토리얼 (multilingual_v2 권장)" },
  { id: "wzMVIc8FAFmgMxFpN0uM", name: "Deokpal", gender: "남성", age: "중년", tone: "거칠고 남성적" },
  { id: "UmYoqGlufKxhJ6NCx5Mv", name: "Jang Ho", gender: "남성", age: "노년", tone: "허스키, 캐릭터용" },
];

export const VOICE_MODELS = [
  { id: "eleven_v3", label: "ElevenLabs v3 (감정 표현, 기본)" },
  { id: "eleven_multilingual_v2", label: "ElevenLabs Multilingual v2 (발음 안정)" },
] as const;
export type VoiceModel = (typeof VOICE_MODELS)[number]["id"];

export const DEFAULT_VOICE_ID = VOICES[0].id;
export const DEFAULT_VOICE_MODEL: VoiceModel = "eleven_v3";

/** 내레이션 1회 예상 크레딧: 에이전트 지시 5 + ElevenLabs 생성 75 (2026-10-14 실측 80). */
export const NARRATION_CREDITS = 80;

export function findVoice(id: string | null | undefined): Voice | null {
  return VOICES.find((voice) => voice.id === id) ?? null;
}

export function isVoiceModel(value: unknown): value is VoiceModel {
  return VOICE_MODELS.some((model) => model.id === value);
}

export function voiceLabel(voice: Voice): string {
  return `${voice.name} · ${voice.gender}·${voice.age} · ${voice.tone}`;
}
