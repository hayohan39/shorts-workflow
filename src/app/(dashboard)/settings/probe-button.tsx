"use client";

import { useActionState, useEffect, useRef, useTransition } from "react";
import { requestProbeAction, type SimpleState } from "../actions";

export function ProbeButton({ disabled, label }: { disabled: boolean; label: string }) {
  const [state, formAction, pending] = useActionState<SimpleState, FormData>(requestProbeAction, {});
  return (
    <form action={formAction} className="stack">
      <button type="submit" className="secondary" disabled={disabled || pending}>
        {pending ? "요청 중…" : label}
      </button>
      {state.error ? <p className="error">{state.error}</p> : null}
    </form>
  );
}

/** 목록이 없거나 오래됐을 때 화면을 연 순간 한 번 자동으로 갱신을 요청한다. */
export function AutoProbe({ enabled }: { enabled: boolean }) {
  const started = useRef(false);
  const [, startTransition] = useTransition();
  useEffect(() => {
    if (!enabled || started.current) return;
    started.current = true;
    startTransition(async () => {
      await requestProbeAction();
    });
  }, [enabled]);
  return null;
}
