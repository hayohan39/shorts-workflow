import Link from "next/link";
import { AutoRefresh } from "@/components/auto-refresh";
import { StatusBadge } from "@/components/status-badge";
import { requireSession } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { monthlyActualCost, utcMonthStart } from "@/pipeline/costs";
import { monthlyCredits } from "@/pipeline/credits";
import { listEpisodes } from "@/pipeline/episodes";
import { formatUsd } from "@/pipeline/script/pricing";
import { scriptCostSince } from "@/pipeline/scripts";
import { isBusy } from "@/pipeline/status";

export const dynamic = "force-dynamic";

export default async function EpisodesPage() {
  await requireSession();
  const [episodes, credits, actual, calculated] = await Promise.all([
    listEpisodes(),
    monthlyCredits(),
    monthlyActualCost(),
    scriptCostSince(utcMonthStart()),
  ]);

  return (
    <>
      <AutoRefresh active={episodes.some(isBusy)} />
      <div className="row between">
        <h1>에피소드</h1>
        <Link href="/episodes/new" className="button">
          새 에피소드
        </Link>
      </div>
      <p className="muted">
        이번 달 크레딧 {credits.used.toLocaleString("ko-KR")} / {credits.limit.toLocaleString("ko-KR")}
      </p>
      <p className="muted small">
        이번 달 Claude 비용:{" "}
        {actual ? (
          <>
            실제 <strong>{formatUsd(actual.usd)}</strong> ({formatDateTime(actual.fetchedAt)} 조회) ·{" "}
          </>
        ) : null}
        대본 계산값 {formatUsd(calculated.total)} ({calculated.runs}회)
        {actual ? null : (
          <>
            {" · "}
            <Link href="/settings#costs">실제 비용 연결</Link>
          </>
        )}
      </p>

      {episodes.length === 0 ? (
        <p className="muted">아직 에피소드가 없습니다. 주제와 목차를 넣어 첫 에피소드를 만드세요.</p>
      ) : (
        <ul className="cards">
          {episodes.map((episode) => (
            <li key={episode.id}>
              <Link href={`/episodes/${episode.id}`} className="card">
                <div className="row between">
                  <strong>
                    #{episode.id} {episode.topic}
                  </strong>
                  <StatusBadge episode={episode} />
                </div>
                <div className="muted small">
                  {episode.stepProgress && isBusy(episode) ? `${episode.stepProgress} · ` : ""}
                  {formatDateTime(episode.updatedAt)}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
