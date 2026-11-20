"use client";

import { useActionState, useState } from "react";
import { uploadAction, type SimpleState } from "../../actions";

const CHOICES = [
  { value: "public", label: "공개", hint: "올리자마자 누구나 볼 수 있습니다." },
  { value: "unlisted", label: "일부 공개", hint: "링크가 있는 사람만 볼 수 있습니다." },
  { value: "private", label: "비공개", hint: "나만 볼 수 있습니다. Studio 에서 나중에 공개로 바꿀 수 있습니다." },
  { value: "scheduled", label: "예약 공개", hint: "비공개로 올렸다가 고른 시각(한국 시간)에 공개됩니다." },
] as const;

/** 유튜브 자동 업로드: 공개 상태를 고르고 올린다(Actions, 무료). */
export function AutoUpload({
  episodeId,
  target,
  minPublishAt,
  retry,
  disabled,
  disabledReason,
}: {
  episodeId: number;
  /** 올릴 채널(이름과 유튜브 채널 ID). 없으면 올릴 수 없다. */
  target: string | null;
  /** 예약으로 고를 수 있는 가장 이른 시각(한국 시간, datetime-local 형식) */
  minPublishAt: string;
  retry: boolean;
  disabled: boolean;
  disabledReason: string | null;
}) {
  const [state, formAction, pending] = useActionState<SimpleState, FormData>(uploadAction, {});
  const [choice, setChoice] = useState<(typeof CHOICES)[number]["value"]>("public");
  return (
    <section>
      <h2>유튜브에 자동으로 올리기</h2>
      {target ? <p className="muted small">{target} 채널에 올립니다.</p> : null}
      <form action={formAction} className="stack">
        <input type="hidden" name="id" value={episodeId} />
        <fieldset className="choices">
          <legend className="sr-only">공개 상태</legend>
          {CHOICES.map((item) => (
            <label key={item.value} className={item.value === choice ? "choice choice-active" : "choice"}>
              <input
                type="radio"
                name="privacy"
                value={item.value}
                checked={item.value === choice}
                onChange={() => setChoice(item.value)}
              />
              <span>
                <strong>{item.label}</strong>
                <span className="muted small"> · {item.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {choice === "scheduled" ? (
          <label className="field">
            <span>공개 시각 (한국 시간)</span>
            <input type="datetime-local" name="publishAt" min={minPublishAt} defaultValue={minPublishAt} required />
          </label>
        ) : null}
        {state.error ? <p className="error">{state.error}</p> : null}
        <button type="submit" disabled={disabled || pending}>
          {pending ? "요청 중…" : retry ? "유튜브 업로드 다시 시도" : "유튜브에 올리기"}
        </button>
        {disabledReason ? <p className="warn small">{disabledReason}</p> : null}
        <p className="muted small">
          제목·설명(출처 포함)·태그·합성 콘텐츠 표시는 아래 “직접 올리기”와 같은 값으로 올립니다. 아동용 아님, 카테고리 교육.
        </p>
      </form>
    </section>
  );
}
