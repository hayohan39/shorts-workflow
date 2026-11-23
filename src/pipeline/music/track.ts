import type { PoolClient } from "pg";
import { query, transaction } from "@/lib/db";
import type { Episode } from "@/pipeline/episodes";
import { canEditMusic, isMusicBlobUrl, MUSIC_MAX_SECONDS, MUSIC_MIN_SECONDS } from "@/pipeline/music/rules";

// 음악형 에피소드의 음원 저장(migrations/…_add-music-channel.sql). 음원은 사용자가 대시보드에서 Vercel Blob 에 직접 올린다
// (api/music/upload). 규칙은 music/rules.ts.

const FILE_NAME_MAX = 200;

export interface MusicTrack {
  episodeId: number;
  audioUrl: string;
  fileName: string;
  durationSeconds: number;
  startSeconds: number;
  updatedAt: Date;
}

interface TrackRow {
  episode_id: number;
  audio_url: string;
  file_name: string;
  duration_seconds: string;
  start_seconds: string;
  updated_at: Date;
}

const COLUMNS = "episode_id, audio_url, file_name, duration_seconds, start_seconds, updated_at";

function toTrack(row: TrackRow): MusicTrack {
  return {
    episodeId: row.episode_id,
    audioUrl: row.audio_url,
    fileName: row.file_name,
    durationSeconds: Number(row.duration_seconds),
    startSeconds: Number(row.start_seconds),
    updatedAt: row.updated_at,
  };
}

export async function getMusicTrack(episodeId: number): Promise<MusicTrack | null> {
  const [row] = await query<TrackRow>(`select ${COLUMNS} from music_tracks where episode_id = $1`, [episodeId]);
  return row ? toTrack(row) : null;
}

/** 에피소드 행을 잠그고 음원을 고칠 수 있는지 본다. 안 되면 RangeError(화면에 그대로 보여 준다). */
async function lockEditable(client: PoolClient, episodeId: number): Promise<{ targetSeconds: number }> {
  const { rows } = await client.query<Pick<Episode, "route" | "status" | "step" | "stepState"> & { targetSeconds: number }>(
    `select route, status, step, step_state as "stepState", target_seconds as "targetSeconds"
      from episodes where id = $1 for update`,
    [episodeId],
  );
  if (!rows[0]) throw new RangeError("에피소드를 찾을 수 없습니다.");
  if (rows[0].route !== "music") throw new RangeError("음악형 에피소드가 아닙니다.");
  if (!canEditMusic(rows[0])) throw new RangeError("지금은 음원을 바꿀 수 없습니다.");
  return { targetSeconds: rows[0].targetSeconds };
}

/** 올린 음원을 저장한다(바꾸면 구간은 처음부터). 길이는 브라우저가 읽은 값이고, 합성할 때 파일에서 다시 잰다. */
export async function saveMusicTrack(
  episodeId: number,
  input: { audioUrl: string; fileName: string; durationSeconds: number },
): Promise<MusicTrack> {
  const fileName = input.fileName.trim().slice(0, FILE_NAME_MAX) || "음원";
  const duration = Math.round(input.durationSeconds * 100) / 100;
  if (!isMusicBlobUrl(input.audioUrl, episodeId)) throw new RangeError("음원 주소가 올바르지 않습니다. 다시 올리세요.");
  if (!Number.isFinite(duration) || duration < MUSIC_MIN_SECONDS) {
    throw new RangeError(`음원이 너무 짧습니다(${MUSIC_MIN_SECONDS}초 이상).`);
  }
  if (duration > MUSIC_MAX_SECONDS) throw new RangeError(`음원은 ${MUSIC_MAX_SECONDS / 60}분 이내만 올릴 수 있습니다.`);
  return transaction(async (client) => {
    await lockEditable(client, episodeId);
    const { rows } = await client.query<TrackRow>(
      `insert into music_tracks (episode_id, audio_url, file_name, duration_seconds, start_seconds) values ($1, $2, $3, $4, 0)
        on conflict (episode_id) do update set audio_url = excluded.audio_url, file_name = excluded.file_name,
          duration_seconds = excluded.duration_seconds, start_seconds = 0, updated_at = now()
        returning ${COLUMNS}`,
      [episodeId, input.audioUrl, fileName, duration],
    );
    return toTrack(rows[0]);
  });
}

/** 영상에 쓸 구간의 시작 시각(초)을 정한다. 구간이 곡 끝을 넘으면 RangeError. */
export async function setMusicStart(episodeId: number, startSeconds: number): Promise<MusicTrack> {
  const start = Math.round(startSeconds * 10) / 10;
  if (!Number.isFinite(start) || start < 0) throw new RangeError("시작 시각이 올바르지 않습니다.");
  return transaction(async (client) => {
    const { targetSeconds } = await lockEditable(client, episodeId);
    const { rows } = await client.query<TrackRow>(`select ${COLUMNS} from music_tracks where episode_id = $1`, [episodeId]);
    if (!rows[0]) throw new RangeError("음원을 먼저 올리세요.");
    const track = toTrack(rows[0]);
    const seconds = Math.min(targetSeconds, track.durationSeconds);
    if (start + seconds > track.durationSeconds + 0.05) {
      throw new RangeError(
        `곡이 ${track.durationSeconds.toFixed(1)}초라 ${start.toFixed(1)}초부터는 ${seconds}초를 쓸 수 없습니다.`,
      );
    }
    const { rows: updated } = await client.query<TrackRow>(
      `update music_tracks set start_seconds = $2, updated_at = now() where episode_id = $1 returning ${COLUMNS}`,
      [episodeId, start],
    );
    return toTrack(updated[0]);
  });
}
