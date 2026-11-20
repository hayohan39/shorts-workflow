"use client";

import { useActionState } from "react";
import { createEpisodeAction, type NewEpisodeState } from "../../actions";

export function NewEpisodeForm({
  channel,
  topicMax,
  outlineMax,
  startsRun,
}: {
  channel: string;
  topicMax: number;
  outlineMax: number;
  startsRun: boolean;
}) {
  const [state, formAction, pending] = useActionState<NewEpisodeState, FormData>(createEpisodeAction, {});
  return (
    <form action={formAction} className="stack">
      <input type="hidden" name="channel" value={channel} />
      <label className="field">
        <span>주제</span>
        <input name="topic" required maxLength={topicMax} defaultValue={state.topic} placeholder="예: PDRN" />
      </label>
      <label className="field">
        <span>목차</span>
        <textarea
          name="outline"
          rows={6}
          maxLength={outlineMax}
          defaultValue={state.outline}
          placeholder={"예: 소개 → 제조 방식 → 효과(논문·임상) → 위험성 → 마무리"}
        />
      </label>
      {state.error ? <p className="error">{state.error}</p> : null}
      <button type="submit" disabled={pending}>
        {pending ? "만드는 중…" : startsRun ? "만들고 대본 생성 시작" : "만들기"}
      </button>
    </form>
  );
}
