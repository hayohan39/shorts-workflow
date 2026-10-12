import { isBusy, statusLabel, type EpisodeState } from "@/pipeline/status";

export function StatusBadge({ episode }: { episode: EpisodeState }) {
  const className = isBusy(episode) ? "badge-busy" : `badge-${episode.status}`;
  return <span className={`badge ${className}`}>{statusLabel(episode)}</span>;
}
