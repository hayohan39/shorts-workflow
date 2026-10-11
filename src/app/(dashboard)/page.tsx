import Link from "next/link";
import { AutoRefresh } from "@/components/auto-refresh";
import { StatusBadge } from "@/components/status-badge";
import { requireSession } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { monthlyCredits } from "@/pipeline/credits";
import { listEpisodes } from "@/pipeline/episodes";
import { isBusy, STEP_LABELS, STEP_STATE_LABELS } from "@/pipeline/status";

export const dynamic = "force-dynamic";

export default async function EpisodesPage() {
  await requireSession();
  const [episodes, credits] = await Promise.all([listEpisodes(), monthlyCredits()]);

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
                  <StatusBadge status={episode.status} />
                </div>
                <div className="muted small">
                  {episode.step && episode.stepState
                    ? `${STEP_LABELS[episode.step]} ${STEP_STATE_LABELS[episode.stepState]} · `
                    : ""}
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
