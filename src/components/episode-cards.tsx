import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import { WorkflowBar } from "@/components/workflow-steps";
import { formatDateTime } from "@/lib/format";
import type { Episode } from "@/pipeline/episodes";
import { isBusy } from "@/pipeline/status";
import { ROUTE_ICONS, ROUTE_LABELS, STAGE_LABELS, workflow } from "@/pipeline/workflow";

/** 에피소드 목록 카드. channelLabels 를 주면 카드에 채널 이름을 함께 보여 준다(여러 채널을 섞어 보일 때). */
export function EpisodeCards({ episodes, channelLabels }: { episodes: Episode[]; channelLabels?: Map<string, string> }) {
  return (
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
                  {channelLabels ? `${channelLabels.get(episode.channel) ?? episode.channel} · ` : ""}
                  {ROUTE_ICONS[episode.route]} {ROUTE_LABELS[episode.route]} ·{" "}
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
  );
}
