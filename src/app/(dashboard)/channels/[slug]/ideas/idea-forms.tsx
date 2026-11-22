"use client";

import { useActionState } from "react";
import { LengthSelect } from "@/components/length-select";
import type { Idea } from "@/pipeline/ideas/store";
import { createFromIdeaAction, decideIdeaAction, requestIdeasAction, type IdeaActionState } from "../../actions";

/** "지금 추천 받기" (Claude 비용, 누르는 것이 확인). */
export function RequestIdeasButton({ slug, disabled, label }: { slug: string; disabled: boolean; label: string }) {
  const [state, formAction, pending] = useActionState<IdeaActionState, FormData>(requestIdeasAction, {});
  return (
    <form action={formAction} className="stack">
      <input type="hidden" name="slug" value={slug} />
      <button type="submit" disabled={disabled || pending}>
        {pending ? "요청 중…" : label}
      </button>
      {state.error ? <p className="error">{state.error}</p> : null}
    </form>
  );
}

/** 기획안 카드의 버튼: 이걸로 만들기(고쳐서 만들기) · 저장 · 폐기 · 되살리기. */
export function IdeaActions({ idea, canStart }: { idea: Idea; canStart: boolean }) {
  const [created, createAction, creating] = useActionState<IdeaActionState, FormData>(createFromIdeaAction, {});
  const [decided, decideAction, deciding] = useActionState<IdeaActionState, FormData>(decideIdeaAction, {});
  const busy = creating || deciding;
  if (idea.status === "discarded") {
    return (
      <form action={decideAction} className="row idea-actions">
        <input type="hidden" name="id" value={idea.id} />
        <button type="submit" name="decision" value="saved" className="secondary" disabled={busy}>
          되살려 저장
        </button>
        {decided.error ? <p className="error">{decided.error}</p> : null}
      </form>
    );
  }
  return (
    <div className="stack idea-actions">
      <form action={createAction} className="stack">
        <input type="hidden" name="id" value={idea.id} />
        <details className="idea-edit">
          <summary className="small">고쳐서 만들기</summary>
          <label className="field">
            <span>제목(주제)</span>
            <input name="title" defaultValue={idea.title} maxLength={200} required />
          </label>
          <label className="field">
            <span>목차</span>
            <textarea name="outline" rows={5} maxLength={1900} defaultValue={idea.outline} />
          </label>
          {idea.clipIds ? (
            <p className="muted small">길이({idea.targetSeconds}초)와 장면 소재는 후보 그대로입니다.</p>
          ) : (
            <LengthSelect defaultValue={idea.targetSeconds} hint="훅은 기획안 그대로 목차 맨 앞에 넣습니다." />
          )}
        </details>
        <button type="submit" disabled={busy}>
          {creating ? "만드는 중…" : canStart ? "이걸로 만들기 (대본 생성 약 $0.1)" : "이걸로 에피소드 만들기"}
        </button>
        {created.error ? <p className="error">{created.error}</p> : null}
      </form>
      <form action={decideAction} className="row">
        <input type="hidden" name="id" value={idea.id} />
        {idea.status === "new" ? (
          <button type="submit" name="decision" value="saved" className="secondary" disabled={busy}>
            저장
          </button>
        ) : null}
        <button type="submit" name="decision" value="discarded" className="secondary" disabled={busy}>
          폐기
        </button>
        {decided.error ? <p className="error">{decided.error}</p> : null}
      </form>
    </div>
  );
}
