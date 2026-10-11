import type { Script } from "@/pipeline/scripts";
import { countChars, RULES, type EvidenceLevel } from "@/pipeline/script/schema";
import { ScriptActions, ScriptEditForm } from "./script-forms";

const EVIDENCE_LABELS: Record<EvidenceLevel, string> = {
  strong: "근거 있음",
  limited: "근거 제한적",
  none: "근거 없음",
};

const FIELD_LABELS: Record<string, string> = {
  narration: "내레이션",
  title: "제목",
  description: "설명란",
  tags: "해시태그",
  research: "근거",
  scenes: "장면",
};

function fieldLabel(field: string): string {
  const scene = /^scenes\.(\d+)$/.exec(field);
  return scene ? `${scene[1]}번 장면` : (FIELD_LABELS[field] ?? field);
}

/** 대본 검토 화면. reviewing 이면 승인·반려·수정 버튼을 보여 준다. */
export function ScriptReview({ script, reviewing }: { script: Script; reviewing: boolean }) {
  const length = countChars(script.narration);
  const lengthOk = length >= RULES.narrationMin && length <= RULES.narrationMax;
  const titleLength = [...script.title].length;

  return (
    <section>
      <h2>
        대본 v{script.version}
        {script.source === "edited" ? " (직접 수정)" : ""}
      </h2>

      {script.warnings.length ? (
        <div className="callout warn-box">
          <strong>확인할 것 {script.warnings.length}건</strong>
          <ul className="small">
            {script.warnings.map((problem, i) => (
              <li key={i}>
                {fieldLabel(problem.field)}: {problem.message}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="ok small">자동 검사에서 걸린 항목이 없습니다.</p>
      )}

      <h3>내레이션</h3>
      <p className={lengthOk ? "muted small" : "warn small"}>
        공백 제외 {length}자 (기준 {RULES.narrationMin}~{RULES.narrationMax}자)
      </p>
      <ol className="scenes">
        {script.scenes.map((scene) => (
          <li key={scene.no}>
            <div className="small muted">
              {scene.no}번 · {scene.kind === "video" ? "AI 영상" : "AI 이미지"} · {scene.seconds}초
              {scene.realistic_person ? " · 실사풍 인물" : ""}
            </div>
            <p className="line">{scene.narration}</p>
            <details>
              <summary className="small">생성 프롬프트</summary>
              <p className="small prewrap">{scene.prompt}</p>
            </details>
          </li>
        ))}
      </ol>

      <h3>근거</h3>
      <ul className="research">
        {script.research.map((item, i) => (
          <li key={i}>
            <span className={`evidence evidence-${item.evidence}`}>{EVIDENCE_LABELS[item.evidence]}</span> {item.claim}
            {item.sources.length ? (
              <ul className="small">
                {item.sources.map((source) => (
                  <li key={source.url}>
                    <a href={source.url} target="_blank" rel="noreferrer">
                      {source.title || source.url}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>

      <h3>유튜브 정보</h3>
      <p>
        <strong>{script.title}</strong>{" "}
        <span className={titleLength > RULES.titleMax ? "warn small" : "muted small"}>({titleLength}자)</span>
      </p>
      <p className="small">{script.tags.join(" ")}</p>
      <details>
        <summary className="small">설명란</summary>
        <p className="small prewrap">{script.description}</p>
      </details>
      <p className="small muted">
        AI 합성 콘텐츠 공개 표시: {script.needsAiDisclosure ? "켬 (실사풍 인물 장면 있음)" : "끔"}
        {script.usage
          ? ` · 웹 검색 ${script.usage.webSearches ?? 0}회 · 토큰 입력 ${(script.usage.inputTokens ?? 0).toLocaleString("ko-KR")} / 출력 ${(script.usage.outputTokens ?? 0).toLocaleString("ko-KR")}`
          : ""}
        {script.model ? ` · ${script.model}` : ""}
      </p>
      {script.reviewerNote ? <p className="small">검토 메모: {script.reviewerNote}</p> : null}

      {reviewing ? (
        <>
          <ScriptActions episodeId={script.episodeId} />
          <ScriptEditForm script={script} />
        </>
      ) : null}
    </section>
  );
}
