import { STATUS_LABELS, type Status } from "@/pipeline/status";

export function StatusBadge({ status }: { status: Status }) {
  return <span className={`badge badge-${status}`}>{STATUS_LABELS[status]}</span>;
}
