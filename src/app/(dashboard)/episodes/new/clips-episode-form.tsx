"use client";

import { useActionState } from "react";
import { LengthSelect } from "@/components/length-select";
import { createClipsEpisodeAction, type ClipsEpisodeState } from "../../clips/actions";

/** 편집형: 주제 + 연관 단어 → 무료 영상 찾기. */
export function ClipsEpisodeForm({
  channel,
  defaultSeconds,
  maxLength,
  startsRun,
}: {
  channel: string;
  defaultSeconds: number;
  maxLength: number;
  startsRun: boolean;
}) {
  const [state, formAction, pending] = useActionState<ClipsEpisodeState, FormData>(createClipsEpisodeAction, {});
  return (
    <form action={formAction} className="stack">
      <input type="hidden" name="channel" value={channel} />
      <label className="field">
        <span>주제</span>
        <input name="topic" required maxLength={maxLength} defaultValue={state.topic} placeholder="예: 겨울 바다와 피부 보습" />
      </label>
      <label className="field">
        <span>연관 단어</span>
        <input
          name="related"
          maxLength={maxLength}
          defaultValue={state.related}
          placeholder="예: 파도, 바닷바람, 얼음, 해변 산책"
        />
        <small className="muted">화면에 나왔으면 하는 것들을 쉼표로 적어 주세요. 영어 검색어로 바꿔 찾습니다.</small>
      </label>
      <LengthSelect
        defaultValue={state.targetSeconds ?? defaultSeconds}
        hint="길이에 맞는 수만큼 장면 클립을 고릅니다. 완성 영상은 1분을 넘지 않게 합성 때 다시 확인합니다."
      />
      {state.error ? <p className="error">{state.error}</p> : null}
      <button type="submit" disabled={pending}>
        {pending ? "만드는 중…" : startsRun ? "만들고 영상 찾기 시작" : "만들기"}
      </button>
      <p className="muted small">누르면 Claude Haiku 로 영어 검색어를 만들고(1회 $0.001 미만) 무료 소스에서 찾습니다.</p>
    </form>
  );
}
