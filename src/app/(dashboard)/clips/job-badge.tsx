import type { JobStatus } from "@/pipeline/clips/store";

const LABELS: Record<JobStatus, string> = { queued: "대기", running: "진행 중", done: "완료", failed: "실패" };
const CLASSES: Record<JobStatus, string> = {
  queued: "badge-busy",
  running: "badge-busy",
  done: "badge-ready",
  failed: "badge-failed",
};

export function JobBadge({ status, prefix = "" }: { status: JobStatus; prefix?: string }) {
  return <span className={`badge ${CLASSES[status]}`}>{prefix + LABELS[status]}</span>;
}
