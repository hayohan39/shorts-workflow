import { query } from "@/lib/db";
import type { Route } from "@/pipeline/episodes";
import { isTargetSeconds, TARGET_SECONDS } from "@/pipeline/script/schema";

/** 유튜브 채널. 에피소드는 하나의 채널에 속한다(migrations/…_add-channels.sql). */
export interface Channel {
  slug: string;
  name: string;
  emoji: string;
  /** 기본 제작 방식(생성형 = ai, 편집형 = clips). 새 에피소드의 기본값이다. */
  route: Route;
  /** 새 에피소드의 기본 영상 길이(초). */
  defaultSeconds: number;
  /** 올릴 유튜브 채널 ID(UC…). 없으면 자동 업로드를 하지 않는다. */
  youtubeChannelId: string | null;
  /** 이 채널의 리프레시 토큰이 든 GitHub Secret 이름. */
  youtubeTokenSecret: string;
}

interface ChannelRow {
  slug: string;
  name: string;
  emoji: string;
  route: Route;
  default_seconds: number;
  youtube_channel_id: string | null;
  youtube_token_secret: string;
}

const COLUMNS = "slug, name, emoji, route, default_seconds, youtube_channel_id, youtube_token_secret";

export const CHANNEL_NAME_MAX = 40;
export const YOUTUBE_CHANNEL_ID_PATTERN = /^UC[A-Za-z0-9_-]{22}$/;

function toChannel(row: ChannelRow): Channel {
  return {
    slug: row.slug,
    name: row.name,
    emoji: row.emoji,
    route: row.route,
    defaultSeconds: row.default_seconds,
    youtubeChannelId: row.youtube_channel_id,
    youtubeTokenSecret: row.youtube_token_secret,
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

/** 채널 설정 화면에서 바꾸는 값. 잘못된 값이면 RangeError(화면에 그대로 보여 준다). */
export async function updateChannel(
  slug: string,
  input: { name: string; emoji: string; route: Route; defaultSeconds: number; youtubeChannelId: string },
): Promise<Channel> {
  const name = input.name.trim();
  const emoji = input.emoji.trim();
  const youtubeChannelId = input.youtubeChannelId.trim();
  if (!name) throw new RangeError("채널 이름을 입력하세요.");
  if (name.length > CHANNEL_NAME_MAX) throw new RangeError(`채널 이름은 ${CHANNEL_NAME_MAX}자 이내로 입력하세요.`);
  if ([...emoji].length > 8) throw new RangeError("아이콘은 이모지 하나만 넣으세요.");
  if (!isTargetSeconds(input.defaultSeconds)) throw new RangeError(`기본 길이는 ${TARGET_SECONDS.join("·")}초 중에서 고르세요.`);
  if (youtubeChannelId && !YOUTUBE_CHANNEL_ID_PATTERN.test(youtubeChannelId)) {
    throw new RangeError("유튜브 채널 ID 는 UC 로 시작하는 24자입니다(YouTube Studio → 설정 → 채널 → 고급 설정).");
  }
  const [row] = await query<ChannelRow>(
    `update channels set name = $2, emoji = $3, route = $4, default_seconds = $5, youtube_channel_id = $6, updated_at = now()
      where slug = $1 returning ${COLUMNS}`,
    [slug, name, emoji, input.route, input.defaultSeconds, youtubeChannelId || null],
  );
  if (!row) throw new RangeError("채널을 찾을 수 없습니다.");
  return toChannel(row);
}
