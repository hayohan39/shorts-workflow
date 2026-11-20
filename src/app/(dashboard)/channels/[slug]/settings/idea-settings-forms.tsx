"use client";

import { useActionState } from "react";
import { ideaSettingsAction, savePromptAction, type IdeaActionState } from "../../actions";

/** 자동 추천 켜기·끄기와 주기. 켜는 것이 매일 실행 비용의 승인이다. */
export function IdeaSettingsForm({ slug, auto, everyDays }: { slug: string; auto: boolean; everyDays: number }) {
  const [state, formAction, pending] = useActionState<IdeaActionState, FormData>(ideaSettingsAction, {});
  return (
    <form action={formAction} className="stack">
      <input type="hidden" name="slug" value={slug} />
      <label className="choice">
        <input type="checkbox" name="auto" defaultChecked={auto} />
        <span>
          <strong>자동 추천 켜기</strong>
          <br />
          <span className="muted small">
            매일 새벽 3시 무렵 실행에서 주기가 되면 카테고리마다 기획안을 하나씩 만듭니다(1회 약 $0.05).
          </span>
        </span>
      </label>
      <label className="field">
        <span>주기</span>
        <select name="everyDays" defaultValue={everyDays}>
          {[1, 2, 3, 4, 5, 6, 7].map((days) => (
            <option key={days} value={days}>
              {days === 1 ? "매일" : `${days}일마다`} (한 달 약 ${((30 / days) * 0.05).toFixed(2)})
            </option>
          ))}
        </select>
        <small className="muted">아직 보지 않은 새 기획안이 7개 이상 쌓여 있으면 그날은 건너뜁니다.</small>
      </label>
      {state.error ? <p className="error">{state.error}</p> : null}
      {state.saved && !pending ? <p className="ok small">저장했습니다.</p> : null}
      <button type="submit" disabled={pending}>
        {pending ? "저장 중…" : "자동 추천 저장"}
      </button>
    </form>
  );
}

export interface PromptHistoryItem {
  version: number;
  body: string;
  savedAt: string;
}

/** 추천 프롬프트 하나: 고쳐서 새 버전으로 저장하고, 예전 버전으로 되돌린다. */
export function PromptForm({
  promptKey,
  label,
  hint,
  body,
  history,
  max,
}: {
  promptKey: string;
  label: string;
  hint: string;
  body: string;
  history: PromptHistoryItem[];
  max: number;
}) {
  const [state, formAction, pending] = useActionState<IdeaActionState, FormData>(savePromptAction, {});
  const current = history[0]?.version;
  return (
    <div className="stack prompt-block">
      <form action={formAction} className="stack">
        <input type="hidden" name="key" value={promptKey} />
        <label className="field">
          <span>
            {label}
            {current ? <span className="muted small"> · v{current}</span> : null}
          </span>
          <textarea key={current} name="body" rows={5} maxLength={max} defaultValue={body} required />
          <small className="muted">{hint}</small>
        </label>
        {state.error ? <p className="error">{state.error}</p> : null}
        {state.saved && !pending ? <p className="ok small">새 버전으로 저장했습니다(내용이 같으면 그대로).</p> : null}
        <button type="submit" className="secondary" disabled={pending}>
          {pending ? "저장 중…" : "저장"}
        </button>
      </form>
      {history.length > 1 ? (
        <details className="prompt-history">
          <summary className="small">예전 버전 {history.length - 1}개</summary>
          <ol className="small">
            {history.slice(1).map((item) => (
              <li key={item.version}>
                <div className="row between">
                  <span className="muted">
                    v{item.version} · {item.savedAt}
                  </span>
                  <form action={formAction}>
                    <input type="hidden" name="key" value={promptKey} />
                    <input type="hidden" name="body" value={item.body} />
                    <button type="submit" className="link small" disabled={pending}>
                      이 버전으로 되돌리기
                    </button>
                  </form>
                </div>
                <p className="prewrap">{item.body}</p>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </div>
  );
}
