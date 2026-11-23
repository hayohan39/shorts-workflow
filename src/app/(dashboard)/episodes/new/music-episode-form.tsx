"use client";

import { useActionState } from "react";
import { LengthSelect } from "@/components/length-select";
import { createMusicEpisodeAction, type MusicEpisodeState } from "../../music-actions";

/** 음악형 새 에피소드: 곡 제목·컨셉·쓸 길이. 만들면 음원 올리기 화면으로 간다(크레딧 없음). */
export function MusicEpisodeForm({
  channel,
  defaultSeconds,
  topicMax,
  outlineMax,
}: {
  channel: string;
  defaultSeconds: number;
  topicMax: number;
  outlineMax: number;
}) {
  const [state, formAction, pending] = useActionState<MusicEpisodeState, FormData>(createMusicEpisodeAction, {});
  return (
    <form action={formAction} className="stack">
      <input type="hidden" name="channel" value={channel} />
      <label className="field">
        <span>곡 제목</span>
        <input name="topic" required maxLength={topicMax} defaultValue={state.topic} placeholder="예: 떡볶이 랩" />
      </label>
      <label className="field">
        <span>컨셉</span>
        <textarea
          name="outline"
          rows={4}
          maxLength={outlineMax}
          defaultValue={state.outline}
          placeholder={"예: 분식집 사장님이 부르는 중독성 있는 광고 랩. 밝고 빠른 붐뱁."}
        />
        <small className="muted">이미지 프롬프트를 만들 때 씁니다.</small>
      </label>
      <LengthSelect
        defaultValue={state.targetSeconds ?? defaultSeconds}
        scenes={false}
        hint="곡에서 이만큼을 잘라 씁니다. 다음 화면에서 음원을 올리고 시작 지점을 고릅니다."
      />
      {state.error ? <p className="error">{state.error}</p> : null}
      <button type="submit" disabled={pending}>
        {pending ? "만드는 중…" : "만들고 음원 올리기"}
      </button>
    </form>
  );
}
