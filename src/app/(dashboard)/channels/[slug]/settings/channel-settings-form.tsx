"use client";

import { useActionState, useState } from "react";
import { LengthSelect } from "@/components/length-select";
import type { Channel } from "@/pipeline/channels";
import type { Route } from "@/pipeline/episodes";
import { updateChannelAction, type ChannelSettingsState } from "../../actions";

const ROUTES: { value: Route; label: string; hint: string }[] = [
  { value: "ai", label: "✍️ 생성형", hint: "대본을 쓰고 장면을 AI 로 만듭니다(장면 크레딧 사용)." },
  { value: "clips", label: "🎬 편집형", hint: "무료 영상을 먼저 찾아 고르고, 그 화면에 맞춰 대본을 씁니다(장면 크레딧 없음)." },
];

export function ChannelSettingsForm({ channel, nameMax }: { channel: Channel; nameMax: number }) {
  const [state, formAction, pending] = useActionState<ChannelSettingsState, FormData>(updateChannelAction, {});
  const [route, setRoute] = useState<Route>(channel.route);
  return (
    <form action={formAction} className="stack">
      <input type="hidden" name="slug" value={channel.slug} />
      <div className="row channel-name-fields">
        <label className="field emoji-field">
          <span>아이콘</span>
          <input name="emoji" maxLength={8} defaultValue={channel.emoji} />
        </label>
        <label className="field grow">
          <span>채널 이름</span>
          <input name="name" required maxLength={nameMax} defaultValue={channel.name} />
        </label>
      </div>
      <fieldset className="choices">
        <legend className="field-legend">기본 제작 방식</legend>
        {ROUTES.map((item) => (
          <label key={item.value} className={item.value === route ? "choice choice-active" : "choice"}>
            <input
              type="radio"
              name="route"
              value={item.value}
              checked={item.value === route}
              onChange={() => setRoute(item.value)}
            />
            <span>
              <strong>{item.label}</strong>
              <br />
              <span className="muted small">{item.hint}</span>
            </span>
          </label>
        ))}
        <small className="muted">
          새 에피소드를 만들 때 기본으로 고르는 방식입니다. 에피소드마다 다른 방식도 고를 수 있습니다.
        </small>
      </fieldset>
      <LengthSelect
        name="defaultSeconds"
        label="기본 영상 길이"
        defaultValue={channel.defaultSeconds}
        hint="새 에피소드의 기본 길이입니다. 에피소드마다 바꿀 수 있습니다."
      />
      <label className="field">
        <span>유튜브 채널 ID</span>
        <input
          name="youtubeChannelId"
          defaultValue={channel.youtubeChannelId ?? ""}
          placeholder="UC로 시작하는 24자"
          autoComplete="off"
          spellCheck={false}
        />
        <small className="muted">
          자동 업로드는 토큰의 채널이 이 ID 와 같을 때만 올립니다. 비워 두면 자동 업로드를 하지 않습니다.
        </small>
      </label>
      {state.error ? <p className="error">{state.error}</p> : null}
      {state.saved && !pending ? <p className="ok small">저장했습니다.</p> : null}
      <button type="submit" disabled={pending}>
        {pending ? "저장 중…" : "저장"}
      </button>
    </form>
  );
}
