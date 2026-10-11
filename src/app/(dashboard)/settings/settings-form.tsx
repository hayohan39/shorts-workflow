"use client";

import { useActionState } from "react";
import type { ModelOption } from "@/pipeline/catalog";
import { saveSettingsAction, type SimpleState } from "../actions";

interface Field {
  name: "scriptModel" | "videoModel" | "imageModel" | "voiceModel";
  label: string;
  value: string;
  options: ModelOption[];
  /** 가성비 추천 모델 ID(목록에 ★ 표시). */
  recommended: string | null;
  /** 빈 값(자동 = 추천 모델 사용)을 고를 때 보이는 문구. */
  emptyLabel: string;
}

function optionLabel(option: ModelOption, recommended: boolean): string {
  const notes = [
    option.detail,
    option.vertical === false ? "세로 9:16 미지원" : "",
    option.fiveSeconds === false ? "5초 미지원" : "",
  ].filter(Boolean);
  const label = recommended ? `★ ${option.label}` : option.label;
  return notes.length ? `${label} (${notes.join(" · ")})` : label;
}

export function SettingsForm({
  fields,
  voice,
  monthlyCreditLimit,
}: {
  fields: Field[];
  voice: string;
  monthlyCreditLimit: number;
}) {
  const [state, formAction, pending] = useActionState<SimpleState, FormData>(saveSettingsAction, {});
  // 저장이 끝나면 React 가 폼을 처음 값으로 되돌린다. 저장된 값이 바뀌면 폼을 새로 그려서
  // 되돌아간 값이 아니라 방금 저장한 값이 보이게 한다.
  const formKey = JSON.stringify([fields.map((field) => field.value), voice, monthlyCreditLimit]);

  return (
    <form key={formKey} action={formAction} className="stack">
      {fields.map((field) => {
        const known = field.options.some((option) => option.id === field.value);
        return (
          <label key={field.name} className="field">
            <span>{field.label}</span>
            <select name={field.name} defaultValue={field.value}>
              <option value="">{field.emptyLabel}</option>
              {/* 저장된 값이 지금 목록에 없으면 사라지지 않게 따로 보여 준다. */}
              {field.value && !known ? <option value={field.value}>{field.value} (목록에 없음)</option> : null}
              {field.options.map((option) => (
                <option key={option.id} value={option.id}>
                  {optionLabel(option, option.id === field.recommended)}
                </option>
              ))}
            </select>
            {field.options.length === 0 ? <small className="muted">목록이 비어 있습니다.</small> : null}
            {field.value && !known && field.options.length > 0 ? (
              <small className="warn">저장된 값이 최신 목록에 없습니다. 다시 골라 주세요.</small>
            ) : null}
          </label>
        );
      })}
      <label className="field">
        <span>목소리 (채널 전체 고정)</span>
        <input name="voice" defaultValue={voice} placeholder="음성 모델의 목소리 ID" />
        <small className="muted">목소리 목록은 음성 생성 단계를 만들 때 함께 정리합니다.</small>
      </label>
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
