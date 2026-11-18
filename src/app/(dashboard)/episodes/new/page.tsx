import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { dispatchAvailability } from "@/lib/github";
import { TOPIC_MAX as CLIP_TOPIC_MAX } from "@/pipeline/clips/store";
import { OUTLINE_MAX, TOPIC_MAX, type Route } from "@/pipeline/episodes";
import { ROUTE_LABELS, ROUTE_STAGES, STAGE_LABELS } from "@/pipeline/workflow";
import { ClipsEpisodeForm } from "./clips-episode-form";
import { NewEpisodeForm } from "./new-episode-form";

export const dynamic = "force-dynamic";

const ROUTE_HINTS: Record<Route, string> = {
  ai: "주제와 목차로 대본을 쓰고, 장면은 AI 로 만듭니다(장면 크레딧 사용).",
  clips: "무료 영상을 먼저 찾아 4개를 고르고, 그 화면에 맞춰 대본을 씁니다(장면 크레딧 없음).",
};

export default async function NewEpisodePage({ searchParams }: PageProps<"/episodes/new">) {
  await requireSession();
  const availability = dispatchAvailability();
  const route: Route = (await searchParams).route === "clips" ? "clips" : "ai";
  return (
    <>
      <h1>새 에피소드</h1>
      <nav className="route-picker" aria-label="만드는 방법">
        {(["ai", "clips"] as const).map((item) => (
          <Link
            key={item}
            href={item === "ai" ? "/episodes/new" : "/episodes/new?route=clips"}
            scroll={false}
            className={item === route ? "route-option route-active" : "route-option"}
            aria-current={item === route ? "page" : undefined}
          >
            <strong>
              {item === "ai" ? "✍️" : "🎬"} {ROUTE_LABELS[item]}
            </strong>
            <span className="small muted">{ROUTE_HINTS[item]}</span>
            <span className="route-steps small">{ROUTE_STAGES[item].map((stage) => STAGE_LABELS[stage]).join(" → ")}</span>
          </Link>
        ))}
      </nav>

      <section>
        {!availability.ok ? (
          <p className="warn small">
            이 화면에서는 에피소드만 만들어지고 {route === "ai" ? "대본 생성" : "영상 찾기"}는 시작되지 않습니다.{" "}
            {availability.reason}
          </p>
        ) : null}
        {route === "ai" ? (
          <>
            <p className="muted small">만들면 바로 대본 생성이 시작됩니다. 대본은 검토 후 승인해야 다음 단계로 넘어갑니다.</p>
            <NewEpisodeForm topicMax={TOPIC_MAX} outlineMax={OUTLINE_MAX} startsRun={availability.ok} />
          </>
        ) : (
          <>
            <p className="muted small">
              만들면 바로 무료 영상 찾기가 시작됩니다(보통 1분). 찾은 영상에서 장면 4개를 고르고 컨셉·목차를 적으면 대본을
              만듭니다.
            </p>
            <ClipsEpisodeForm maxLength={CLIP_TOPIC_MAX} startsRun={availability.ok} />
          </>
        )}
      </section>
    </>
  );
}
