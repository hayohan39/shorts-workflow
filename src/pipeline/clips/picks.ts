import { transaction, query } from "@/lib/db";
import { listAssets } from "@/pipeline/assets";
import { CLIP_MODEL, canFillScenes, fillSceneWithClip } from "@/pipeline/clips/episode";
import { isSelectable } from "@/pipeline/clips/select";
import { episodeCollection, getClips, type StoredClip } from "@/pipeline/clips/store";
import type { Episode } from "@/pipeline/episodes";
import { RULES } from "@/pipeline/script/schema";
import { latestScript } from "@/pipeline/scripts";
import { isBusy } from "@/pipeline/status";
import { scenesDone } from "@/pipeline/steps/render";

// clips 길: 에피소드에서 찾은 클립 중 장면 수(4)만큼 골라 순서를 정한다.
//   고르기 → 그 클립만 채택(내려받아 Blob 에 저장) + 대본 생성(클립 설명을 함께 넘김)
//   대본 승인 → 고른 클립으로 장면을 채운다(채택이 늦게 끝나면 채택이 끝날 때 채운다)
// 장면 생성(AI)은 쓰지 않는다.

export const PICK_COUNT = RULES.scenes;

/** 고른 클립(장면 순서). */
export async function listPicks(episodeId: number): Promise<StoredClip[]> {
  const rows = await query<{ clip_id: number }>(
    "select clip_id from episode_clips where episode_id = $1 order by scene_no",
    [episodeId],
  );
  const clips = new Map((await getClips(rows.map((row) => row.clip_id))).map((clip) => [clip.id, clip]));
  return rows.flatMap((row) => clips.get(row.clip_id) ?? []);
}

/** 대본을 만들기 전(대본 대기, 진행 중인 단계 없음)에만 고를 수 있다. */
export function canPick(episode: Pick<Episode, "route" | "status" | "step" | "stepState">): boolean {
  return episode.route === "clips" && episode.status === "queued" && !isBusy(episode);
}

/**
 * 장면 순서대로 클립을 고른다(clipIds[0] 이 1번 장면). 이 에피소드에서 찾은 클립이어야 하고, 겹치면 안 된다.
 * 잘못된 선택은 RangeError.
 */
export async function savePicks(episode: Episode, clipIds: number[]): Promise<StoredClip[]> {
  if (!canPick(episode)) throw new RangeError("대본을 만들기 전에만 클립을 고를 수 있습니다.");
  if (clipIds.length !== PICK_COUNT) throw new RangeError(`장면 1~${PICK_COUNT}에 클립을 하나씩 고르세요.`);
  if (new Set(clipIds).size !== clipIds.length) throw new RangeError("같은 클립을 두 장면에 넣을 수 없습니다.");
  const collection = await episodeCollection(episode.id);
  const clips = new Map((await getClips(clipIds)).map((clip) => [clip.id, clip]));
  for (const id of clipIds) {
    const clip = clips.get(id);
    if (!clip || clip.collectionId !== collection?.id) throw new RangeError("이 에피소드에서 찾은 클립만 고를 수 있습니다.");
    if (!isSelectable(clip)) throw new RangeError(`"${clip.title}" 은(는) 내려받을 수 없는 클립입니다.`);
  }
  await transaction(async (client) => {
    await client.query("delete from episode_clips where episode_id = $1", [episode.id]);
    for (const [index, id] of clipIds.entries()) {
      await client.query("insert into episode_clips (episode_id, scene_no, clip_id) values ($1, $2, $3)", [
        episode.id,
        index + 1,
        id,
      ]);
    }
  });
  return clipIds.map((id) => clips.get(id)!);
}

/**
 * 고른 클립 중 채택이 끝난 것으로 장면을 채운다. 이미 그 클립이 들어 있는 장면은 건너뛴다.
 * 장면을 바꿀 수 없는 상태(대본 승인 전, 진행 중)면 아무것도 하지 않는다. 채운 장면 수를 돌려준다.
 */
export async function fillScenesFromPicks(episode: Episode): Promise<number> {
  if (episode.route !== "clips" || !canFillScenes(episode)) return 0;
  const script = await latestScript(episode.id);
  if (!script) return 0;
  const done = scenesDone(await listAssets(episode.id), script.version);
  const picks = await listPicks(episode.id);
  let filled = 0;
  for (const [index, clip] of picks.entries()) {
    const sceneNo = index + 1;
    const current = done.get(sceneNo);
    if (!clip.blobUrl || !script.scenes.some((scene) => scene.no === sceneNo)) continue;
    if (current?.model === CLIP_MODEL && current.meta.clipId === clip.id) continue;
    await fillSceneWithClip(episode, sceneNo, clip.id);
    filled += 1;
  }
  return filled;
}
