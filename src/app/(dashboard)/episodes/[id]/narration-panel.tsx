"use client";

import { useActionState, useState } from "react";
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

/**
 * 내레이션: 목소리를 골라 만들고, 들어 보고, 마음에 안 들면 다른 목소리로 다시 만든다.
 * 미리 듣기는 그 목소리로 전에 만든 내레이션(다른 편 포함)을 쓴다. 공식 샘플이 없어서다.
 */
export function NarrationPanel({
  episodeId,
  voices,
  models,
  defaultVoiceId,
  defaultModel,
  samples,
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
  samples: Record<string, { url: string; text: string }>;
  narrations: NarrationItem[];
  canRun: boolean;
  blockedReason: string | null;
  creditsPerRun: number;
}) {
  const [state, formAction, pending] = useActionState<RunStepState, FormData>(narrationAction, {});
  const [voiceId, setVoiceId] = useState(defaultVoiceId);
  const sample = samples[voiceId];

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
          <select name="voiceId" value={voiceId} onChange={(event) => setVoiceId(event.target.value)}>
            {voices.map((voice) => (
              <option key={voice.id} value={voice.id}>
                {samples[voice.id] ? "♪ " : ""}
                {voice.label}
              </option>
            ))}
          </select>
          {sample ? (
            <>
              <small className="muted">미리 듣기 (전에 이 목소리로 만든 내레이션)</small>
              <audio controls preload="none" src={sample.url} />
            </>
          ) : (
            <small className="muted">이 목소리는 아직 샘플이 없습니다. 한 번 만들면 다음부터 미리 들을 수 있습니다(♪ 표시).</small>
          )}
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
