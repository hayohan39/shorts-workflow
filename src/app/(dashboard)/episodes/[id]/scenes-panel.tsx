import Image from "next/image";
import type { Asset } from "@/pipeline/assets";
import type { Scene } from "@/pipeline/script/schema";

/** 장면별 생성 결과(영상·이미지). 아직 없는 장면은 "생성 전" 으로 보인다. */
export function ScenesPanel({ scenes, done }: { scenes: Scene[]; done: Map<number, Asset> }) {
  return (
    <section>
      <h2>장면</h2>
      <ol className="scenes">
        {scenes.map((scene) => {
          const asset = done.get(scene.no);
          return (
            <li key={scene.no}>
              <div className="small muted">
                {scene.no}번 · {scene.kind === "video" ? "AI 영상" : "AI 이미지"} · {scene.seconds}초
                {asset ? ` · ${asset.credits}크레딧` : " · 생성 전"}
              </div>
              {asset?.url ? (
                scene.kind === "video" ? (
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
            </li>
          );
        })}
      </ol>
    </section>
  );
}
