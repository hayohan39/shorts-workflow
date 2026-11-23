import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { dispatchAvailability } from "@/lib/github";
import { channelLabel, listChannels } from "@/pipeline/channels";
import { TOPIC_MAX as CLIP_TOPIC_MAX } from "@/pipeline/clips/store";
import { OUTLINE_MAX, TOPIC_MAX, type Route } from "@/pipeline/episodes";
import { ROUTE_ICONS, ROUTE_LABELS, ROUTE_STAGES, stageLabel } from "@/pipeline/workflow";
import { ClipsEpisodeForm } from "./clips-episode-form";
import { MusicEpisodeForm } from "./music-episode-form";
import { NewEpisodeForm } from "./new-episode-form";

export const dynamic = "force-dynamic";

const ROUTE_HINTS: Record<Route, string> = {
  ai: "주제와 목차로 대본을 쓰고, 장면은 AI 로 만듭니다(장면 크레딧 사용).",
  clips: "무료 영상·사진을 먼저 찾아 장면 수만큼 고르고, 그 화면에 맞춰 대본을 씁니다(장면 크레딧 없음).",
  music: "직접 만든 음원을 올리고 가사 타이밍을 맞춘 뒤, 곡에 맞는 이미지로 영상을 만듭니다.",
};

/** 화면에서 고를 수 있는 방식. 음악형은 음악형 채널에서만 만든다. */
function isRoute(value: unknown): value is Exclude<Route, "music"> {
  return value === "ai" || value === "clips";
}

export default async function NewEpisodePage({ searchParams }: PageProps<"/episodes/new">) {
  await requireSession();
  const params = await searchParams;
  const channels = await listChannels();
  const requested = isRoute(params.route) ? params.route : null;
  // 채널을 고르지 않고 들어오면(예: 클립 보관함의 링크) 그 방식이 기본인 채널, 없으면 첫 채널.
  const channel = params.channel
    ? channels.find((item) => item.slug === params.channel)
    : (channels.find((item) => item.route === requested) ?? channels[0]);
  if (!channel) notFound();
  // 음악형 채널은 음악형만, 다른 채널은 생성형·편집형 중에서 고른다.
  const route: Route = channel.route === "music" ? "music" : (requested ?? channel.route);
  const availability = dispatchAvailability();

  return (
    <>
      <Link href={`/channels/${channel.slug}`} className="back">
        ← {channelLabel(channel)}
      </Link>
      <h1>새 에피소드</h1>
      {route === "music" ? (
        <section>
          <p className="muted small">
            {ROUTE_ICONS.music} {ROUTE_HINTS.music} ({ROUTE_STAGES.music.map((stage) => stageLabel("music", stage)).join(" → ")})
          </p>
          <MusicEpisodeForm
            channel={channel.slug}
            defaultSeconds={channel.defaultSeconds}
            topicMax={TOPIC_MAX}
            outlineMax={OUTLINE_MAX}
          />
        </section>
      ) : (
        <>
          <nav className="route-picker" aria-label="제작 방식">
            {(["ai", "clips"] as const).map((item) => (
              <Link
                key={item}
                href={`/episodes/new?channel=${channel.slug}&route=${item}`}
                scroll={false}
                className={item === route ? "route-option route-active" : "route-option"}
                aria-current={item === route ? "page" : undefined}
              >
                <strong>
                  {ROUTE_ICONS[item]} {ROUTE_LABELS[item]}
                  {item === channel.route ? <span className="muted small"> · 채널 기본</span> : null}
                </strong>
                <span className="small muted">{ROUTE_HINTS[item]}</span>
                <span className="route-steps small">
                  {ROUTE_STAGES[item].map((stage) => stageLabel(item, stage)).join(" → ")}
                </span>
              </Link>
            ))}
          </nav>

          <section>
            {!availability.ok ? (
              <p className="warn small">
                이 화면에서는 에피소드만 만들어지고 {route === "ai" ? "대본 생성" : "소재 찾기"}는 시작되지 않습니다.{" "}
                {availability.reason}
              </p>
            ) : null}
            {route === "ai" ? (
              <>
                <p className="muted small">만들면 바로 대본 생성이 시작됩니다. 대본은 검토 후 승인해야 다음 단계로 넘어갑니다.</p>
                <NewEpisodeForm
                  channel={channel.slug}
                  defaultSeconds={channel.defaultSeconds}
                  topicMax={TOPIC_MAX}
                  outlineMax={OUTLINE_MAX}
                  startsRun={availability.ok}
                />
              </>
            ) : (
              <>
                <p className="muted small">
                  만들면 바로 무료 영상·사진 찾기가 시작됩니다(보통 1분). 찾은 소재에서 장면마다 고르고 컨셉·목차를 적으면 대본을
                  만듭니다.
                </p>
                <ClipsEpisodeForm
                  channel={channel.slug}
                  defaultSeconds={channel.defaultSeconds}
                  maxLength={CLIP_TOPIC_MAX}
                  startsRun={availability.ok}
                />
              </>
            )}
          </section>
        </>
      )}
    </>
  );
}
