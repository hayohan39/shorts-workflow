"use client";

import { useActionState } from "react";
import {
  addTagAction,
  adoptClipsAction,
  deleteTagAction,
  fillSceneAction,
  removeSceneClipAction,
  retryCollectAction,
  setDailyAction,
  setTagActiveAction,
  swapClipAction,
  type ClipActionState,
} from "./actions";

type Action = (prev: ClipActionState, formData: FormData) => Promise<ClipActionState>;

function ActionButton({
  action,
  fields,
  label,
  className,
  disabled = false,
}: {
  action: Action;
  fields: Record<string, number | string>;
  label: string;
  className?: string;
  disabled?: boolean;
}) {
  const [state, formAction, pending] = useActionState<ClipActionState, FormData>(action, {});
  return (
    <form action={formAction} className="stack">
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <button type="submit" className={className} disabled={disabled || pending}>
        {pending ? "요청 중…" : label}
      </button>
      {state.error ? <p className="error">{state.error}</p> : null}
    </form>
  );
}

export function RetryCollectButton({ id }: { id: number }) {
  return <ActionButton action={retryCollectAction} fields={{ id }} label="다시 수집" />;
}

export function AdoptButton({ id, label, disabled }: { id: number; label: string; disabled: boolean }) {
  return <ActionButton action={adoptClipsAction} fields={{ id }} label={label} disabled={disabled} />;
}

export function SwapButton({ id, selected, alternate }: { id: number; selected: number; alternate: number }) {
  return (
    <ActionButton action={swapClipAction} fields={{ id, selected, alternate }} label="이걸로 교체" className="secondary" />
  );
}

export function DailyToggle({ enabled }: { enabled: boolean }) {
  return (
    <ActionButton
      action={setDailyAction}
      fields={{ enabled: enabled ? "0" : "1" }}
      label={enabled ? "자동 수집 끄기" : "자동 수집 켜기"}
      className={enabled ? "secondary" : undefined}
    />
  );
}

export function AddTagForm({ maxLength }: { maxLength: number }) {
  const [state, formAction, pending] = useActionState<ClipActionState, FormData>(addTagAction, {});
  return (
    <form action={formAction} className="stack">
      <div className="row">
        <input name="name" required maxLength={maxLength} placeholder="예: 우주 탐사" aria-label="새 태그" />
        <button type="submit" className="secondary" disabled={pending}>
          추가
        </button>
      </div>
      {state.error ? <p className="error">{state.error}</p> : null}
    </form>
  );
}

export function TagButtons({ id, active }: { id: number; active: boolean }) {
  return (
    <div className="row">
      <ActionButton
        action={setTagActiveAction}
        fields={{ id, active: active ? "0" : "1" }}
        label={active ? "끄기" : "켜기"}
        className="secondary"
      />
      <ActionButton action={deleteTagAction} fields={{ id }} label="삭제" className="secondary" />
    </div>
  );
}

export function FillSceneButton({ id, scene, clip }: { id: number; scene: number; clip: number }) {
  return <ActionButton action={fillSceneAction} fields={{ id, scene, clip }} label="이 장면에 넣기" className="secondary" />;
}

export function RemoveSceneClipButton({ id, asset }: { id: number; asset: number }) {
  return <ActionButton action={removeSceneClipAction} fields={{ id, asset }} label="클립 빼기" className="secondary" />;
}
