import { query } from "@/lib/db";
import type { Route } from "@/pipeline/episodes";
import { isTargetSeconds, TARGET_SECONDS } from "@/pipeline/script/schema";

/** 유튜브 채널. 에피소드는 하나의 채널에 속한다(migrations/…_add-channels.sql). */
export interface Channel {
  slug: string;
  name: string;
  emoji: string;
  /** 제작 방식(생성형 = ai, 편집형 = clips). 채널 특성이라 화면에서 바꾸지 않는다. 새 에피소드의 기본값이다. */
  route: Route;
  /** 새 에피소드의 기본 영상 길이(초). */
  defaultSeconds: number;
  /** 자동 추천(매일 실행에서 주기마다). 돈이 드는 자동 실행이라 기본 꺼짐. */
  ideasAuto: boolean;
  /** 자동 추천 주기(일). */
  ideasEveryDays: number;
  /** 올릴 유튜브 채널 ID(UC…). 없으면 자동 업로드를 하지 않는다. */
  youtubeChannelId: string | null;
  /** 이 채널의 리프레시 토큰이 든 GitHub Secret 이름. */
  youtubeTokenSecret: string;
  /** 유튜브 설명란 끝에 붙이는 문구(고지). 비우면 붙이지 않는다. */
  descriptionFooter: string;
  /** 영상 위쪽에 계속 띄우는 짧은 고지. 비우면 띄우지 않는다. */
  videoNotice: string;
}

interface ChannelRow {
  slug: string;
  name: string;
  emoji: string;
  route: Route;
  default_seconds: number;
  ideas_auto: boolean;
  ideas_every_days: number;
  youtube_channel_id: string | null;
  youtube_token_secret: string;
  description_footer: string;
  video_notice: string;
}

const COLUMNS = `slug, name, emoji, route, default_seconds, ideas_auto, ideas_every_days, youtube_channel_id, youtube_token_secret,
  description_footer, video_notice`;

export const CHANNEL_NAME_MAX = 40;
export const DESCRIPTION_FOOTER_MAX = 300;
export const VIDEO_NOTICE_MAX = 30;
export const YOUTUBE_CHANNEL_ID_PATTERN = /^UC[A-Za-z0-9_-]{22}$/;

function toChannel(row: ChannelRow): Channel {
  return {
    slug: row.slug,
    name: row.name,
    emoji: row.emoji,
    route: row.route,
    defaultSeconds: row.default_seconds,
    ideasAuto: row.ideas_auto,
    ideasEveryDays: row.ideas_every_days,
    youtubeChannelId: row.youtube_channel_id,
    youtubeTokenSecret: row.youtube_token_secret,
    descriptionFooter: row.description_footer,
    videoNotice: row.video_notice,
  };
}

export function channelLabel(channel: Pick<Channel, "emoji" | "name">): string {
  return channel.emoji ? `${channel.emoji} ${channel.name}` : channel.name;
}

export async function listChannels(): Promise<Channel[]> {
  const rows = await query<ChannelRow>(`select ${COLUMNS} from channels order by position, slug`);
  return rows.map(toChannel);
}

export async function getChannel(slug: string): Promise<Channel | null> {
  const [row] = await query<ChannelRow>(`select ${COLUMNS} from channels where slug = $1`, [slug]);
  return row ? toChannel(row) : null;
}

/** 채널 설정 화면에서 바꾸는 값(제작 방식은 채널 특성이라 바꾸지 않는다). 잘못된 값이면 RangeError(화면에 그대로 보여 준다). */
export async function updateChannel(
  slug: string,
  input: {
    name: string;
    emoji: string;
    defaultSeconds: number;
    youtubeChannelId: string;
    descriptionFooter: string;
    videoNotice: string;
  },
): Promise<Channel> {
  const name = input.name.trim();
  const emoji = input.emoji.trim();
  const youtubeChannelId = input.youtubeChannelId.trim();
  const descriptionFooter = input.descriptionFooter.trim();
  const videoNotice = input.videoNotice.trim();
  if (!name) throw new RangeError("채널 이름을 입력하세요.");
  if (name.length > CHANNEL_NAME_MAX) throw new RangeError(`채널 이름은 ${CHANNEL_NAME_MAX}자 이내로 입력하세요.`);
  if ([...emoji].length > 8) throw new RangeError("아이콘은 이모지 하나만 넣으세요.");
  if (!isTargetSeconds(input.defaultSeconds)) throw new RangeError(`기본 길이는 ${TARGET_SECONDS.join("·")}초 중에서 고르세요.`);
  if (descriptionFooter.length > DESCRIPTION_FOOTER_MAX)
    throw new RangeError(`설명란 끝 문구는 ${DESCRIPTION_FOOTER_MAX}자 이내로 입력하세요.`);
  if (videoNotice.length > VIDEO_NOTICE_MAX) throw new RangeError(`영상 고지 문구는 ${VIDEO_NOTICE_MAX}자 이내로 입력하세요.`);
  if (youtubeChannelId && !YOUTUBE_CHANNEL_ID_PATTERN.test(youtubeChannelId)) {
    throw new RangeError("유튜브 채널 ID 는 UC 로 시작하는 24자입니다(YouTube Studio → 설정 → 채널 → 고급 설정).");
  }
  const [row] = await query<ChannelRow>(
    `update channels set name = $2, emoji = $3, default_seconds = $4, youtube_channel_id = $5, description_footer = $6,
        video_notice = $7, updated_at = now()
      where slug = $1 returning ${COLUMNS}`,
    [slug, name, emoji, input.defaultSeconds, youtubeChannelId || null, descriptionFooter, videoNotice],
  );
  if (!row) throw new RangeError("채널을 찾을 수 없습니다.");
  return toChannel(row);
}

export const IDEAS_EVERY_DAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/** 자동 추천 켜기·끄기와 주기. */
export async function updateIdeaSettings(slug: string, input: { auto: boolean; everyDays: number }): Promise<Channel> {
  if (!IDEAS_EVERY_DAYS.includes(input.everyDays as (typeof IDEAS_EVERY_DAYS)[number])) {
    throw new RangeError("추천 주기는 1~7일 중에서 고르세요.");
  }
  const [row] = await query<ChannelRow>(
    `update channels set ideas_auto = $2, ideas_every_days = $3, updated_at = now() where slug = $1 returning ${COLUMNS}`,
    [slug, input.auto, input.everyDays],
  );
  if (!row) throw new RangeError("채널을 찾을 수 없습니다.");
  return toChannel(row);
}
