"use client";

import { useActionState } from "react";
import { saveSettingsAction, type SimpleState } from "../actions";

interface Field {
  name: "scriptModel" | "videoModel" | "imageModel" | "voiceModel" | "voice";
  label: string;
  hint: string;
  value: string;
  /** ManyMotions 조회 결과에서 고르는 값인가(대본 모델은 아님). */
  fromCatalog: boolean;
}

export function SettingsForm({
  fields,
  options,
  monthlyCreditLimit,
}: {
  fields: Field[];
  /** 모델 조회로 확인한 ID. 비어 있으면 아직 조회 전. */
  options: { id: string; label: string }[];
  monthlyCreditLimit: number;
}) {
  const [state, formAction, pending] = useActionState<SimpleState, FormData>(saveSettingsAction, {});
  const known = new Set(options.map((option) => option.id));

  return (
    <form action={formAction} className="stack">
      <datalist id="catalog">
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </datalist>
      {fields.map((field) => (
        <label key={field.name} className="field">
          <span>{field.label}</span>
          <input
            name={field.name}
            defaultValue={field.value}
            list={field.fromCatalog ? "catalog" : undefined}
            placeholder={field.hint}
          />
          {field.fromCatalog && field.value && options.length > 0 && !known.has(field.value) ? (
            <small className="warn">조회 결과에 없는 값입니다. 아래 목록에서 ID 를 확인하세요.</small>
          ) : null}
        </label>
      ))}
      <label className="field">
        <span>월 크레딧 한도</span>
        <input name="monthlyCreditLimit" type="number" min={1} step={1} required defaultValue={monthlyCreditLimit} />
        <small className="muted">이번 달 사용량이 이 값을 넘으면 장면 생성을 시작하지 않습니다.</small>
      </label>
      {state.error ? <p className="error">{state.error}</p> : null}
      {state.saved ? <p className="ok">저장했습니다.</p> : null}
      <button type="submit" disabled={pending}>
        {pending ? "저장 중…" : "저장"}
      </button>
    </form>
  );
}
