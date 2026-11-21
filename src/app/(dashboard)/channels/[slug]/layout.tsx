import Link from "next/link";
import { notFound } from "next/navigation";
import { ChannelTabs } from "@/components/channel-tabs";
import { requireSession } from "@/lib/auth";
import { channelLabel, getChannel } from "@/pipeline/channels";
import { countReadyToUpload } from "@/pipeline/episodes";
import { countNewIdeas, listCategories } from "@/pipeline/ideas/store";
import { ROUTE_ICONS, ROUTE_LABELS } from "@/pipeline/workflow";

/** 채널 화면 공통: 채널 이름·기본 제작 방식·유튜브 연결 상태와 하위 탭. */
export default async function ChannelLayout({ children, params }: LayoutProps<"/channels/[slug]">) {
  await requireSession();
  const channel = await getChannel((await params).slug);
  if (!channel) notFound();
  const [categories, newIdeas, ready] = await Promise.all([
    listCategories(channel.slug),
    countNewIdeas(channel.slug),
    countReadyToUpload(channel.slug),
  ]);
  return (
    <>
      <div className="row between channel-head">
        <h1>{channelLabel(channel)}</h1>
        <span className="badge">
          {ROUTE_ICONS[channel.route]} {ROUTE_LABELS[channel.route]}
        </span>
      </div>
      <p className="muted small channel-youtube">
        {channel.youtubeChannelId ? (
          <>유튜브 {channel.youtubeChannelId} 에 올립니다.</>
        ) : (
          <>
            유튜브 채널 ID 가 없어 자동 업로드가 꺼져 있습니다. <Link href={`/channels/${channel.slug}/settings`}>채널 설정</Link>
          </>
        )}
      </p>
      <ChannelTabs slug={channel.slug} ideas={categories.length ? newIdeas : null} ready={ready} />
      {children}
    </>
  );
}
