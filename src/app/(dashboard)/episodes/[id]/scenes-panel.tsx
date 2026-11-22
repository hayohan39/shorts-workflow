import Image from "next/image";
import Link from "next/link";
import type { Asset } from "@/pipeline/assets";
import { CLIP_MODEL } from "@/pipeline/clips/episode";
import { clipSegment } from "@/pipeline/clips/select";
import type { StoredClip } from "@/pipeline/clips/store";
import { SOURCE_LABELS } from "@/pipeline/clips/types";
import type { Scene } from "@/pipeline/script/schema";
import { ClipMedia } from "../../clips/clip-card";
import { FillSceneButton, RemoveSceneClipButton } from "../../clips/clip-forms";

/**
 * 장면별 결과(AI 영상·이미지 또는 무료 클립). 아직 없는 장면은 "생성 전" 으로 보인다.
 * 바꿀 수 있을 때(canFill)는 장면마다 채택한 무료 클립으로 채울 수 있다(크레딧 없음).
 */
export function ScenesPanel({
  episodeId,
  scenes,
  done,
  adopted,
  canFill,
}: {
  episodeId: number;
  scenes: Scene[];
  done: Map<number, Asset>;
  adopted: StoredClip[];
  canFill: boolean;
}) {
  return (
    <section>
      <h2>장면</h2>
      {canFill ? (
        <p className="muted small">
          장면을 <Link href="/clips">클립 보관함</Link>에서 채택한 무료 클립으로 채우면 그 장면은 크레딧 없이 건너뜁니다. 이미 합성했으면
          다시 합성하세요.
        </p>
      ) : null}
      <ol className="scenes">
        {scenes.map((scene) => {
          const asset = done.get(scene.no);
          const isClip = asset?.model === CLIP_MODEL;
          const label = isClip ? "무료 클립" : scene.kind === "video" ? "AI 영상" : "AI 이미지";
          return (
            <li key={scene.no}>
              <div className="small muted">
                {scene.no}번 · {label} · {scene.seconds}초
                {asset ? ` · ${asset.credits}크레딧` : " · 생성 전"}
                {isClip ? ` · ${String(asset.meta.title ?? "")}` : ""}
              </div>
              {asset?.url ? (
                asset.kind === "video" ? (
                  <video className="scene-media" controls playsInline preload="metadata" src={asset.url} />
                ) : (
                  // 검토용이라 Blob 의 원본을 그대로 보여 준다(이미지 최적화 비용 없음).
                  <Image
                    className="scene-media"
                    src={asset.url}
                    alt={`${scene.no}번 장면`}
                    width={720}
                    height={1280}
                    unoptimized
                  />
                )
              ) : null}
              <p className="line">{scene.narration}</p>
              {canFill && isClip ? <RemoveSceneClipButton id={episodeId} asset={asset.id} /> : null}
              {canFill && adopted.length > 0 ? (
                <details>
                  <summary>무료 클립으로 {asset ? "바꾸기" : "채우기"}</summary>
                  <ul className="scenes">
                    {adopted.map((clip) => (
                      <li key={clip.id}>
                        <div className="small">
                          {clip.title}
                          <span className="muted">
                            {" "}
                            · {clip.media === "image" ? "사진" : clip.durationSec === null ? "" : `${clipSegment(clip.durationSec).length}초`} ·{" "}
                            {SOURCE_LABELS[clip.source]} · {clip.license.name}
                          </span>
                        </div>
                        <ClipMedia clip={clip} />
                        <FillSceneButton id={episodeId} scene={scene.no} clip={clip.id} />
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </li>
          );
        })}
      </ol>
      {canFill && adopted.length === 0 ? (
        <p className="muted small">
          채택한 무료 클립이 없습니다. <Link href="/clips">클립 보관함</Link>에서 채택하면 여기서 장면에 넣을 수 있습니다.
        </p>
      ) : null}
    </section>
  );
}
