import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/auto-refresh";
import { EpisodeCards } from "@/components/episode-cards";
import { requireSession } from "@/lib/auth";
import { getChannel } from "@/pipeline/channels";
import { listEpisodes } from "@/pipeline/episodes";
import { isBusy } from "@/pipeline/status";
import { ROUTE_LABELS, ROUTE_STAGES, stageLabel } from "@/pipeline/workflow";

export const dynamic = "force-dynamic";

/** 채널의 에피소드 목록. */
export default async function ChannelPage({ params }: PageProps<"/channels/[slug]">) {
  await requireSession();
  const channel = await getChannel((await params).slug);
  if (!channel) notFound();
  const episodes = await listEpisodes({ channel: channel.slug });
  const newHref = `/episodes/new?channel=${channel.slug}`;

  return (
    <>
      <AutoRefresh active={episodes.some(isBusy)} />
      <div className="row between page-head">
        <span className="muted small">에피소드 {episodes.length}개</span>
        <Link href={newHref} className="button">
          + 새 에피소드
        </Link>
      </div>
      {episodes.length === 0 ? (
        <div className="empty">
          <p>아직 에피소드가 없습니다.</p>
          <p className="muted small">
            {ROUTE_LABELS[channel.route]}: {ROUTE_STAGES[channel.route].map((stage) => stageLabel(channel.route, stage)).join(" → ")}
          </p>
          <Link href={newHref} className="button">
            첫 에피소드 만들기
          </Link>
        </div>
      ) : (
        <EpisodeCards episodes={episodes} />
      )}
    </>
  );
}
