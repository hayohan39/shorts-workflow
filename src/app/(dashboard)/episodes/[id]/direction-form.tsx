"use client";

import { useActionState } from "react";
import { DirectionField } from "@/components/direction-field";
import { setDirectionAction, type SimpleState } from "../../actions";

/** 대본 탭의 대본 방향: 승인 전에는 고칠 수 있고, 다음 대본 생성(반려 후 다시 생성·다시 시도)부터 반영된다. */
export function DirectionForm({ episodeId, direction, note }: { episodeId: number; direction: string; note: string }) {
  const [state, action, pending] = useActionState<SimpleState, FormData>(setDirectionAction, {});
  return (
    <form action={action} className="stack">
      <input type="hidden" name="id" value={episodeId} />
      <DirectionField defaultValue={direction} />
      <p className="muted small">{note}</p>
      {state.error ? <p className="error">{state.error}</p> : null}
      {state.saved ? <p className="ok">저장했습니다.</p> : null}
      <button type="submit" className="secondary" disabled={pending}>
        {pending ? "저장 중…" : "대본 방향 저장"}
      </button>
    </form>
  );
}
