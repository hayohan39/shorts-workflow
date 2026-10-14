import { query } from "@/lib/db";

// 생성물(장면 영상·이미지·내레이션·최종 영상). 파일은 Vercel Blob 에 두고 주소만 저장한다.

export type AssetKind = "video" | "image" | "voice" | "final";

export interface Asset {
  id: number;
  episodeId: number;
  sceneNo: number | null;
  kind: AssetKind;
  model: string | null;
  mmJobId: string | null;
  credits: number;
  url: string | null;
  status: "pending" | "running" | "done" | "failed";
  error: string | null;
  meta: Record<string, unknown>;
  createdAt: Date;
}

interface AssetRow {
  id: number;
  episode_id: number;
  scene_no: number | null;
  kind: AssetKind;
  model: string | null;
  mm_job_id: string | null;
  credits: number;
  url: string | null;
  status: Asset["status"];
  error: string | null;
  meta: Record<string, unknown>;
  created_at: Date;
}

const COLUMNS = "id, episode_id, scene_no, kind, model, mm_job_id, credits, url, status, error, meta, created_at";

function toAsset(row: AssetRow): Asset {
  return {
    id: row.id,
    episodeId: row.episode_id,
    sceneNo: row.scene_no,
    kind: row.kind,
    model: row.model,
    mmJobId: row.mm_job_id,
    credits: row.credits,
    url: row.url,
    status: row.status,
    error: row.error,
    meta: row.meta,
    createdAt: row.created_at,
  };
}

export async function saveAsset(input: {
  episodeId: number;
  kind: AssetKind;
  model: string | null;
  mmJobId?: string | null;
  credits: number;
  url: string;
  meta?: Record<string, unknown>;
}): Promise<Asset> {
  const [row] = await query<AssetRow>(
    `insert into assets (episode_id, kind, model, mm_job_id, credits, url, status, meta)
     values ($1, $2, $3, $4, $5, $6, 'done', $7) returning ${COLUMNS}`,
    [
      input.episodeId,
      input.kind,
      input.model,
      input.mmJobId ?? null,
      input.credits,
      input.url,
      JSON.stringify(input.meta ?? {}),
    ],
  );
  return toAsset(row);
}

/** 에피소드의 생성물(최신순). kind 를 주면 그 종류만. */
export async function listAssets(episodeId: number, kind?: AssetKind): Promise<Asset[]> {
  const rows = await query<AssetRow>(
    `select ${COLUMNS} from assets where episode_id = $1 and ($2::text is null or kind = $2)
      order by created_at desc, id desc`,
    [episodeId, kind ?? null],
  );
  return rows.map(toAsset);
}
