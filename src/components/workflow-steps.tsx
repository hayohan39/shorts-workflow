import Link from "next/link";
import type { Stage, Workflow } from "@/pipeline/workflow";

const ACTIVITY_TEXT = {
  busy: "진행 중",
  failed: "실패",
  waiting: "지금 할 차례",
} as const;

/**
 * 에피소드 단계 탭(대본 → 내레이션 → 장면 → 영상 → 업로드).
 * 끝난 단계는 ✓, 지금 단계는 강조(진행 중이면 깜빡임, 실패면 빨강), 보고 있는 탭은 밑줄.
 */
export function WorkflowTabs({ episodeId, flow, active }: { episodeId: number; flow: Workflow; active: Stage }) {
  return (
    <nav className="steps" aria-label="진행 단계">
      <ol>
        {flow.stages.map((item, index) => {
          const isCurrent = item.state === "current";
          const className = [
            "step",
            `step-${item.state}`,
            isCurrent && flow.activity ? `step-${flow.activity}` : "",
            item.stage === active ? "step-active" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <li key={item.stage} className={className}>
              <Link
                href={`/episodes/${episodeId}?tab=${item.stage}`}
                scroll={false}
                aria-current={item.stage === active ? "page" : undefined}
              >
                <span className="step-dot" aria-hidden>
                  {item.state === "done" ? "✓" : isCurrent && flow.activity === "failed" ? "!" : index + 1}
                </span>
                <span className="step-label">{item.label}</span>
                <span className="sr-only">
                  {item.state === "done" ? " (끝남)" : isCurrent && flow.activity ? ` (${ACTIVITY_TEXT[flow.activity]})` : ""}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** 목록 카드용 작은 진행 막대. */
export function WorkflowBar({ flow }: { flow: Workflow }) {
  return (
    <div className="mini-steps" aria-label={`${flow.stages.length}단계 중 ${flow.doneCount}단계 끝남`}>
      {flow.stages.map((item) => (
        <span
          key={item.stage}
          className={`mini-step mini-${item.state}${item.state === "current" && flow.activity ? ` mini-${flow.activity}` : ""}`}
          title={item.label}
        />
      ))}
    </div>
  );
}
