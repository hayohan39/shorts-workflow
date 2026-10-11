"use client";

import { useActionState } from "react";
import { requestProbeAction, type SimpleState } from "../actions";

export function ProbeButton({ disabled, label }: { disabled: boolean; label: string }) {
  const [state, formAction, pending] = useActionState<SimpleState, FormData>(requestProbeAction, {});
  return (
    <form action={formAction} className="stack">
      <button type="submit" disabled={disabled || pending}>
        {pending ? "요청 중…" : label}
      </button>
      {state.error ? <p className="error">{state.error}</p> : null}
    </form>
  );
}
