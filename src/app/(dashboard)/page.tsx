import Link from "next/link";
import { AutoRefresh } from "@/components/auto-refresh";
import { EpisodeCards } from "@/components/episode-cards";
import { requireSession } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { getManyMotionsAccount } from "@/pipeline/accounts";
import { channelLabel, listChannels } from "@/pipeline/channels";
import { monthlyActualCost, utcMonthStart } from "@/pipeline/costs";
import { monthlyCredits } from "@/pipeline/credits";
import { listEpisodes, uploadedCounts } from "@/pipeline/episodes";
import { formatUsd } from "@/pipeline/script/pricing";
import { scriptCostSince } from "@/pipeline/scripts";
import { isBusy } from "@/pipeline/status";
import { ROUTE_ICONS, ROUTE_LABELS, workflow } from "@/pipeline/workflow";

export const dynamic = "force-dynamic";

/** 첫 화면: 이번 달 사용량, 채널별 현황, 채널을 가리지 않고 지금 내가 볼 에피소드. */
export default async function HomePage() {
  await requireSession();
  const [channels, active, uploaded, credits, actual, calculated, account] = await Promise.all([
    listChannels(),
    listEpisodes({ active: true, limit: 200 }),
    uploadedCounts(),
    monthlyCredits(),
    monthlyActualCost(),
    scriptCostSince(utcMonthStart()),
    getManyMotionsAccount(),
  ]);
  const labels = new Map(channels.map((channel) => [channel.slug, channelLabel(channel)]));
  // 사람 차례(검토·고르기·업로드)이거나 실패해서 손봐야 하는 에피소드
  const mine = active.filter((episode) => workflow(episode).activity !== "busy");

  return (
    <>
      <AutoRefresh active={active.some(isBusy)} />
      <h1 className="page-head">대시보드</h1>

      <div className="stats">
        <div className="stat">
          <span className="stat-label">ManyMotions 잔여</span>
          <strong className="stat-value">{account?.credits != null ? account.credits.toLocaleString("ko-KR") : "—"}</strong>
          <span className="muted small">{account?.fetchedAt ? `${formatDateTime(account.fetchedAt)} 조회` : "크레딧"}</span>
        </div>
        <div className="stat">
          <span className="stat-label">이번 달 크레딧</span>
          <strong className="stat-value">{credits.used.toLocaleString("ko-KR")}</strong>
          <span className="muted small">한도 {credits.limit.toLocaleString("ko-KR")}</span>
        </div>
        <div className="stat">
          <span className="stat-label">이번 달 Claude</span>
          <strong className="stat-value">{formatUsd(actual ? actual.usd : calculated.total)}</strong>
          <span className="muted small">
            {actual ? (
              `실제 · ${formatDateTime(actual.fetchedAt)} 조회`
            ) : (
              <>
                대본 계산값 {calculated.runs}회 · <Link href="/settings#costs">실제 비용 연결</Link>
              </>
            )}
          </span>
        </div>
      </div>
      {actual ? (
        <p className="muted small">
          대본 계산값 {formatUsd(calculated.total)} ({calculated.runs}회)
        </p>
      ) : null}

      <h2 className="list-title">채널</h2>
      <ul className="cards channel-cards">
        {channels.map((channel) => {
          const episodes = active.filter((episode) => episode.channel === channel.slug);
          const waiting = mine.filter((episode) => episode.channel === channel.slug).length;
          return (
            <li key={channel.slug}>
              <Link href={`/channels/${channel.slug}`} className="card">
                <div className="row between">
                  <strong className="card-title">{channelLabel(channel)}</strong>
                  <span className="badge">
                    {ROUTE_ICONS[channel.route]} {ROUTE_LABELS[channel.route]}
                  </span>
                </div>
                <p className="muted small channel-counts">
                  진행 중 {episodes.length} · <span className={waiting ? "accent" : undefined}>내 차례 {waiting}</span> · 올림{" "}
                  {uploaded.get(channel.slug) ?? 0}
                </p>
                {channel.youtubeChannelId ? null : (
                  <p className="warn small">유튜브 채널 ID 가 없어 자동 업로드가 꺼져 있습니다.</p>
                )}
              </Link>
            </li>
          );
        })}
      </ul>

      <h2 className="list-title">내 차례</h2>
      {mine.length ? (
        <EpisodeCards episodes={mine} channelLabels={labels} />
      ) : (
        <p className="muted small">지금 검토하거나 고를 에피소드가 없습니다.</p>
      )}
    </>
  );
}
