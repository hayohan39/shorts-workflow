import { query } from "@/lib/db";

export interface Settings {
  voice: string | null;
  scriptModel: string | null;
  videoModel: string | null;
  imageModel: string | null;
  voiceModel: string | null;
  uploadDays: number[];
  monthlyCreditLimit: number;
  updatedAt: Date;
}

interface SettingsRow {
  voice: string | null;
  script_model: string | null;
  video_model: string | null;
  image_model: string | null;
  voice_model: string | null;
  upload_days: number[];
  monthly_credit_limit: number;
  updated_at: Date;
}

const COLUMNS = "voice, script_model, video_model, image_model, voice_model, upload_days, monthly_credit_limit, updated_at";
const TEXT_MAX = 200;
export const CREDIT_LIMIT_MAX = 100_000;

function toSettings(row: SettingsRow): Settings {
  return {
    voice: row.voice,
    scriptModel: row.script_model,
    videoModel: row.video_model,
    imageModel: row.image_model,
    voiceModel: row.voice_model,
    uploadDays: row.upload_days,
    monthlyCreditLimit: row.monthly_credit_limit,
    updatedAt: row.updated_at,
  };
}

export async function getSettings(): Promise<Settings> {
  const [row] = await query<SettingsRow>(`select ${COLUMNS} from settings`);
  if (!row) throw new Error("settings 행이 없습니다. 마이그레이션을 확인하세요.");
  return toSettings(row);
}

export interface SettingsInput {
  videoModel: string;
  imageModel: string;
  voiceModel: string;
  voice: string;
  monthlyCreditLimit: string;
}

/** 화면에서 받은 값을 검증해 저장한다. 빈 값은 "미설정"(null). 잘못된 값은 RangeError. */
export async function updateSettings(input: SettingsInput): Promise<Settings> {
  const text = (value: string, label: string) => {
    const trimmed = value.trim();
    if (trimmed.length > TEXT_MAX) throw new RangeError(`${label}은(는) ${TEXT_MAX}자 이내로 입력하세요.`);
    return trimmed || null;
  };
  const limit = Number(input.monthlyCreditLimit);
  if (!Number.isInteger(limit) || limit <= 0 || limit > CREDIT_LIMIT_MAX) {
    throw new RangeError(`월 크레딧 한도는 1 ~ ${CREDIT_LIMIT_MAX.toLocaleString("ko-KR")} 사이의 정수로 입력하세요.`);
  }
  const [row] = await query<SettingsRow>(
    `update settings set video_model = $1, image_model = $2, voice_model = $3, voice = $4,
        monthly_credit_limit = $5, updated_at = now()
      returning ${COLUMNS}`,
    [
      text(input.videoModel, "영상 모델"),
      text(input.imageModel, "이미지 모델"),
      text(input.voiceModel, "음성 모델"),
      text(input.voice, "목소리"),
      limit,
    ],
  );
  return toSettings(row);
}
