import Link from "next/link";
import { AutoRefresh } from "@/components/auto-refresh";
import { StatusBadge } from "@/components/status-badge";
import { WorkflowBar } from "@/components/workflow-steps";
import { requireSession } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { getManyMotionsAccount } from "@/pipeline/accounts";
import { monthlyActualCost, utcMonthStart } from "@/pipeline/costs";
import { monthlyCredits } from "@/pipeline/credits";
import { listEpisodes } from "@/pipeline/episodes";
import { formatUsd } from "@/pipeline/script/pricing";
import { scriptCostSince } from "@/pipeline/scripts";
import { isBusy } from "@/pipeline/status";
import { STAGE_LABELS, workflow } from "@/pipeline/workflow";

export const dynamic = "force-dynamic";

export default async function EpisodesPage() {
  await requireSession();
  const [episodes, credits, actual, calculated, account] = await Promise.all([
    listEpisodes(),
    monthlyCredits(),
    monthlyActualCost(),
    scriptCostSince(utcMonthStart()),
    getManyMotionsAccount(),
  ]);

  return (
    <>
      <AutoRefresh active={episodes.some(isBusy)} />
      <div className="row between page-head">
        <h1>에피소드</h1>
        <Link href="/episodes/new" className="button">
          + 새 에피소드
        </Link>
      </div>

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

      {episodes.length === 0 ? (
        <div className="empty">
          <p>아직 에피소드가 없습니다.</p>
          <p className="muted small">주제와 목차를 넣으면 대본 → 내레이션 → 장면 → 영상 → 업로드 순서로 진행합니다.</p>
          <Link href="/episodes/new" className="button">
            첫 에피소드 만들기
          </Link>
        </div>
      ) : (
        <ul className="cards">
          {episodes.map((episode) => {
            const flow = workflow(episode);
            return (
              <li key={episode.id}>
                <Link href={`/episodes/${episode.id}`} className="card">
                  <div className="row between">
                    <strong className="card-title">
                      <span className="muted">#{episode.id}</span> {episode.topic}
                    </strong>
                    <StatusBadge episode={episode} />
                  </div>
                  <WorkflowBar flow={flow} />
                  <div className="row between muted small">
                    <span>
                      {flow.activity ? `${STAGE_LABELS[flow.current]} 단계` : "모든 단계 끝"}
                      {episode.stepProgress && isBusy(episode) ? ` · ${episode.stepProgress}` : ""}
                    </span>
                    <span>{formatDateTime(episode.updatedAt)}</span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
