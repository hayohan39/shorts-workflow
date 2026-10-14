"use client";

import { useActionState } from "react";
import { narrationAction, type RunStepState } from "../../actions";

export interface NarrationItem {
  id: number;
  url: string;
  voiceName: string;
  voiceModel: string;
  credits: number;
  createdAt: string;
}

interface VoiceOption {
  id: string;
  label: string;
}

/** 내레이션: 목소리를 골라 만들고, 들어 보고, 마음에 안 들면 다른 목소리로 다시 만든다. */
export function NarrationPanel({
  episodeId,
  voices,
  models,
  defaultVoiceId,
  defaultModel,
  narrations,
  canRun,
  blockedReason,
  creditsPerRun,
}: {
  episodeId: number;
  voices: VoiceOption[];
  models: VoiceOption[];
  defaultVoiceId: string;
  defaultModel: string;
  narrations: NarrationItem[];
  canRun: boolean;
  blockedReason: string | null;
  creditsPerRun: number;
}) {
  const [state, formAction, pending] = useActionState<RunStepState, FormData>(narrationAction, {});

  return (
    <section>
      <h2>내레이션</h2>
      {narrations.length ? (
        <ul className="narrations">
          {narrations.map((item, index) => (
            <li key={item.id}>
              <div className="small">
                {index === 0 ? <strong>사용할 내레이션 · </strong> : null}
                {item.voiceName} · {item.voiceModel} · {item.credits}크레딧 · {item.createdAt}
              </div>
              <audio controls preload="none" src={item.url} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">아직 만든 내레이션이 없습니다.</p>
      )}

      <form action={formAction} className="stack">
        <input type="hidden" name="id" value={episodeId} />
        <label className="field">
          <span>목소리</span>
          <select name="voiceId" defaultValue={defaultVoiceId}>
            {voices.map((voice) => (
              <option key={voice.id} value={voice.id}>
                {voice.label}
              </option>
            ))}
          </select>
          <small className="muted">목소리는 ManyMotions·ElevenLabs 웹에서 미리 들어 보고 고르세요.</small>
        </label>
        <label className="field">
          <span>음성 모델</span>
          <select name="voiceModel" defaultValue={defaultModel}>
            {models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={!canRun || pending}>
          {pending ? "요청 중…" : `${narrations.length ? "이 목소리로 다시 만들기" : "내레이션 만들기"} (약 ${creditsPerRun}크레딧)`}
        </button>
        {blockedReason ? <p className="warn small">{blockedReason}</p> : null}
        {state.error ? <p className="error">{state.error}</p> : null}
      </form>
    </section>
  );
}
