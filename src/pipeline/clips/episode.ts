import { deleteAsset, saveAsset, type Asset } from "@/pipeline/assets";
import { attributionText } from "@/pipeline/clips/attribution";
import { isCommercialUse } from "@/pipeline/clips/license";
import { getClips, type StoredClip } from "@/pipeline/clips/store";
import type { Episode } from "@/pipeline/episodes";
import { latestScript } from "@/pipeline/scripts";
import { isBusy, type Status } from "@/pipeline/status";

// 에피소드 연동: 채택한 무료 클립·사진으로 장면을 채운다.
// 소재는 그 장면의 생성물(assets, kind=video|image, model=clip, 크레딧 0)로 기록한다. 그러면
//   - 장면 생성(render)은 이미 있는 장면이라 건너뛴다(크레딧을 쓰지 않는다)
//   - 합성(compose)은 생성물의 종류를 보고 영상은 영상으로, 사진은 천천히 확대·이동하는 장면으로 넣는다(대본의 종류와 관계없이)
//   - 같은 장면에 나중에 넣은 것이 앞선다. 클립을 빼면 그 전 생성물(있으면)이 다시 쓰인다
// 출처 표기는 지금 장면에 쓰인 클립에서 만든다(영상 검토 화면·업로드 설명란).

export const CLIP_MODEL = "clip";

/** 대본이 승인된 뒤, 진행 중인 단계가 없을 때만 장면을 바꿀 수 있다. */
const FILLABLE: readonly Status[] = ["approved", "rendering", "video_review"];

export function canFillScenes(episode: Pick<Episode, "status" | "step" | "stepState">): boolean {
  if (isBusy(episode)) return false;
  if (FILLABLE.includes(episode.status)) return true;
  return episode.status === "failed" && (episode.step === "voice" || episode.step === "render" || episode.step === "compose");
}

/** 장면에 클립을 넣는다. 대본의 장면 번호와 채택된(Blob 에 있는) 클립이어야 한다. 아니면 RangeError. */
export async function fillSceneWithClip(episode: Episode, sceneNo: number, clipId: number): Promise<Asset> {
  if (!canFillScenes(episode)) throw new RangeError("대본 승인 뒤, 진행 중인 단계가 없을 때만 장면을 바꿀 수 있습니다.");
  const script = await latestScript(episode.id);
  if (!script?.scenes.some((scene) => scene.no === sceneNo)) throw new RangeError("없는 장면입니다.");
  const [clip] = await getClips([clipId]);
  if (!clip?.blobUrl) throw new RangeError("채택한 클립만 넣을 수 있습니다. 클립 보관함에서 먼저 채택하세요.");
  if (!isCommercialUse(clip)) throw new RangeError("상업적 이용이 허용되지 않는 라이선스의 소재는 쓸 수 없습니다.");
  return saveAsset({
    episodeId: episode.id,
    kind: clip.media,
    sceneNo,
    model: CLIP_MODEL,
    credits: 0,
    url: clip.blobUrl,
    meta: { scriptVersion: script.version, clipId: clip.id, collectionId: clip.collectionId, title: clip.title },
  });
}

/** 장면에서 클립을 뺀다. */
export async function removeSceneClip(episode: Episode, assetId: number): Promise<void> {
  if (!canFillScenes(episode)) throw new RangeError("진행 중인 단계가 끝난 뒤에 바꿀 수 있습니다.");
  if (!(await deleteAsset(episode.id, assetId, CLIP_MODEL))) throw new RangeError("이미 빠졌거나 없는 클립입니다.");
}

/** 지금 장면(장면 번호 → 생성물)에 쓰인 클립(장면 순서대로). */
export async function sceneClips(done: Map<number, Asset>): Promise<StoredClip[]> {
  const ids = [...done.entries()]
    .sort(([a], [b]) => a - b)
    .flatMap(([, asset]) => (asset.model === CLIP_MODEL && typeof asset.meta.clipId === "number" ? [asset.meta.clipId] : []));
  return getClips([...new Set(ids)]);
}

/** 업로드 설명란: 대본의 설명 뒤에 출처 표기를 붙인다(클립이 없으면 설명 그대로). */
export function descriptionWithCredits(description: string, clips: StoredClip[]): string {
  const credits = attributionText(clips);
  return credits ? `${description.trimEnd()}\n\n${credits}` : description;
}
