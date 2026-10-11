"use client";

import { useActionState } from "react";
import { runStepAction, type RunStepState } from "../../actions";

export function RunStepButton({ id, step, label }: { id: number; step: string; label: string }) {
  const [state, formAction, pending] = useActionState<RunStepState, FormData>(runStepAction, {});
  return (
    <form action={formAction} className="stack">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="step" value={step} />
      <button type="submit" disabled={pending}>
        {pending ? "요청 중…" : label}
      </button>
      {state.error ? <p className="error">{state.error}</p> : null}
    </form>
  );
}
