"use client";

import { useActionState } from "react";
import type { Script } from "@/pipeline/scripts";
import {
  approveScriptAction,
  editScriptAction,
  rejectScriptAction,
  type SimpleState,
} from "../../actions";

export function ScriptActions({ episodeId }: { episodeId: number }) {
  const [approveState, approve, approving] = useActionState<SimpleState, FormData>(approveScriptAction, {});
  const [rejectState, reject, rejecting] = useActionState<SimpleState, FormData>(rejectScriptAction, {});
  const busy = approving || rejecting;

  return (
    <div className="stack">
      <form action={approve} className="stack">
        <input type="hidden" name="id" value={episodeId} />
        <label className="field">
          <span>검토 메모 (선택)</span>
          <input name="note" placeholder="승인하면서 남길 메모" />
        </label>
        <button type="submit" disabled={busy}>
          {approving ? "승인 중…" : "대본 승인"}
        </button>
        {approveState.error ? <p className="error">{approveState.error}</p> : null}
      </form>
      <form action={reject} className="stack">
        <input type="hidden" name="id" value={episodeId} />
        <label className="field">
          <span>반려 메모 (필수 — 다음 대본에 반영)</span>
          <textarea name="note" rows={3} placeholder="예: 훅을 더 짧게, 효과 부분에 임상 근거 수준을 분명히" />
        </label>
        <button type="submit" className="secondary" disabled={busy}>
          {rejecting ? "반려 중…" : "반려하고 다시 생성"}
        </button>
        {rejectState.error ? <p className="error">{rejectState.error}</p> : null}
      </form>
    </div>
  );
}

export function ScriptEditForm({ script }: { script: Script }) {
  const [state, action, pending] = useActionState<SimpleState, FormData>(editScriptAction, {});
  return (
    <details className="edit">
      <summary>직접 수정 (내레이션·제목·설명란·해시태그)</summary>
      <form action={action} className="stack">
        <input type="hidden" name="id" value={script.episodeId} />
        {script.scenes.map((scene) => (
          <label key={scene.no} className="field">
            <span>
              {scene.no}번 장면 내레이션 ({scene.kind === "video" ? "영상" : "이미지"})
            </span>
            <textarea name={`narration_${scene.no}`} rows={2} defaultValue={scene.narration} required />
          </label>
        ))}
        <label className="field">
          <span>제목</span>
          <input name="title" defaultValue={script.title} required />
        </label>
        <label className="field">
          <span>설명란</span>
          <textarea name="description" rows={8} defaultValue={script.description} />
        </label>
        <label className="field">
          <span>해시태그 (띄어쓰기로 구분)</span>
          <input name="tags" defaultValue={script.tags.join(" ")} />
        </label>
        {state.error ? <p className="error">{state.error}</p> : null}
        {state.saved ? <p className="ok">새 버전으로 저장했습니다. 위에서 확인 후 승인하세요.</p> : null}
        <button type="submit" className="secondary" disabled={pending}>
          {pending ? "저장 중…" : "수정 내용 저장"}
        </button>
      </form>
    </details>
  );
}
