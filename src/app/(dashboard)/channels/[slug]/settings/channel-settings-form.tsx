"use client";

import { useActionState } from "react";
import { LengthSelect } from "@/components/length-select";
import type { Channel } from "@/pipeline/channels";
import { ROUTE_ICONS, ROUTE_LABELS } from "@/pipeline/workflow";
import { updateChannelAction, type ChannelSettingsState } from "../../actions";

export function ChannelSettingsForm({
  channel,
  nameMax,
  limits,
}: {
  channel: Channel;
  nameMax: number;
  limits: { notice: number; footer: number };
}) {
  const [state, formAction, pending] = useActionState<ChannelSettingsState, FormData>(updateChannelAction, {});
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
      <p className="small channel-route">
        제작 방식:{" "}
        <strong>
          {ROUTE_ICONS[channel.route]} {ROUTE_LABELS[channel.route]}
        </strong>
        <span className="muted"> · 채널 특성이라 바꾸지 않습니다. 새 에피소드에서 한 편만 다른 방식으로 만들 수는 있습니다.</span>
      </p>
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
      <label className="field">
        <span>영상 고지 문구</span>
        <input
          name="videoNotice"
          maxLength={limits.notice}
          defaultValue={channel.videoNotice}
          placeholder="비우면 띄우지 않습니다"
        />
        <small className="muted">영상 위쪽에 계속 띄우는 짧은 문구입니다(예: ※ 의학적 조언이 아닙니다).</small>
      </label>
      <label className="field">
        <span>설명란 끝 문구</span>
        <textarea name="descriptionFooter" rows={3} maxLength={limits.footer} defaultValue={channel.descriptionFooter} />
        <small className="muted">새로 만드는 대본의 유튜브 설명란 맨 끝에 붙습니다. 비우면 붙이지 않습니다.</small>
      </label>
      {state.error ? <p className="error">{state.error}</p> : null}
      {state.saved && !pending ? <p className="ok small">저장했습니다.</p> : null}
      <button type="submit" disabled={pending}>
        {pending ? "저장 중…" : "저장"}
      </button>
    </form>
  );
}
