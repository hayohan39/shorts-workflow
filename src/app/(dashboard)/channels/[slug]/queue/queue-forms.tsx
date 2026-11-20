"use client";

import { useActionState } from "react";
import { rescheduleAction, uploadAction, type SimpleState } from "../../../actions";

/** 날짜 미정 영상: 공개 시각을 정하면 바로 비공개 + 예약 공개로 올린다(YouTube 가 그 시각에 공개). */
export function ScheduleForm({
  episodeId,
  min,
  disabled,
  retry,
}: {
  episodeId: number;
  min: string;
  disabled: boolean;
  retry: boolean;
}) {
  const [state, formAction, pending] = useActionState<SimpleState, FormData>(uploadAction, {});
  return (
    <form action={formAction} className="stack queue-form">
      <input type="hidden" name="id" value={episodeId} />
      <input type="hidden" name="privacy" value="scheduled" />
      <div className="row queue-row">
        <input type="datetime-local" name="publishAt" min={min} required aria-label="공개 시각(한국 시간)" disabled={disabled} />
        <button type="submit" disabled={disabled || pending}>
          {pending ? "요청 중…" : retry ? "다시 올리기" : "예약 업로드"}
        </button>
      </div>
      {state.error ? <p className="error">{state.error}</p> : null}
    </form>
  );
}

/** 예약된 영상: 공개 시각 바꾸기(YouTube 의 예약 시각도 바뀐다). */
export function RescheduleForm({
  episodeId,
  current,
  min,
  disabled,
}: {
  episodeId: number;
  current: string;
  min: string;
  disabled: boolean;
}) {
  const [state, formAction, pending] = useActionState<SimpleState, FormData>(rescheduleAction, {});
  return (
    <form action={formAction} className="stack queue-form">
      <input type="hidden" name="id" value={episodeId} />
      <div className="row queue-row">
        <input
          type="datetime-local"
          name="publishAt"
          min={min}
          defaultValue={current}
          required
          aria-label="새 공개 시각(한국 시간)"
          disabled={disabled}
        />
        <button type="submit" className="secondary" disabled={disabled || pending}>
          {pending ? "요청 중…" : "시각 바꾸기"}
        </button>
      </div>
      {state.error ? <p className="error">{state.error}</p> : null}
    </form>
  );
}
