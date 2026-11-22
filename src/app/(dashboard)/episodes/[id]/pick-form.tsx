"use client";

import { useActionState, useState } from "react";
import type { StoredClip } from "@/pipeline/clips/store";
import { SOURCE_LABELS } from "@/pipeline/clips/types";
import { pickClipsAction, type PickState } from "../../clips/actions";
import { ClipMedia, durationLabel } from "../../clips/clip-card";

/**
 * 소재 찾기 결과에서 장면 1~N 에 쓸 클립을 고르고(같은 장면을 다른 클립에 고르면 앞의 것은 비운다),
 * 영상 컨셉·목차를 적어 대본 생성을 시작한다.
 */
export function PickForm({
  episodeId,
  clips,
  picked,
  sceneCount,
  concept,
  outline,
  disabled,
}: {
  episodeId: number;
  clips: StoredClip[];
  /** 이미 고른 클립 ID(장면 순서). */
  picked: number[];
  sceneCount: number;
  concept: string;
  outline: string;
  disabled: boolean;
}) {
  const [state, formAction, pending] = useActionState<PickState, FormData>(pickClipsAction, {});
  // 클립 ID → 장면 번호
  const [scenes, setScenes] = useState<Record<number, number>>(() =>
    Object.fromEntries(picked.map((clipId, index) => [clipId, index + 1])),
  );
  const choose = (clipId: number, sceneNo: number) =>
    setScenes((current) => {
      const next = Object.fromEntries(Object.entries(current).filter(([, no]) => no !== sceneNo));
      if (sceneNo) next[clipId] = sceneNo;
      else delete next[clipId];
      return next;
    });
  const byScene = new Map(Object.entries(scenes).map(([clipId, no]) => [no, clips.find((clip) => clip.id === Number(clipId))]));
  const sceneNos = Array.from({ length: sceneCount }, (_, i) => i + 1);
  const ready = sceneNos.every((no) => byScene.get(no));

  return (
    <form action={formAction} className="stack">
      <input type="hidden" name="id" value={episodeId} />
      {Object.entries(scenes).map(([clipId, no]) => (
        <input key={clipId} type="hidden" name={`scene-${clipId}`} value={no} />
      ))}

      <section>
        <h2>장면에 쓸 클립 {sceneCount}개</h2>
        <ol className="pick-slots">
          {sceneNos.map((no) => {
            const clip = byScene.get(no);
            return (
              <li key={no} className={clip ? "pick-slot pick-filled" : "pick-slot"}>
                <span className="pick-no">{no}</span>
                <span className="pick-title">{clip ? clip.title : "아래에서 고르세요"}</span>
              </li>
            );
          })}
        </ol>
      </section>

      <section>
        <h2>찾은 소재</h2>
        <p className="muted small">미리 보고, 쓸 영상·사진에 장면 번호를 고르세요. 1번은 첫 2초 훅 장면입니다. 사진은 천천히 확대·이동해 영상처럼 씁니다.</p>
        <ul className="pick-grid">
          {clips.map((clip) => {
            const sceneNo = scenes[clip.id] ?? 0;
            return (
              <li key={clip.id} className={sceneNo ? "pick-card pick-chosen" : "pick-card"}>
                <ClipMedia clip={clip} className="pick-media" />
                <a href={clip.pageUrl} target="_blank" rel="noreferrer" className="pick-name small">
                  {clip.title}
                </a>
                <span className="muted pick-info">
                  {durationLabel(clip)} · {SOURCE_LABELS[clip.source]}
                  {clip.license.code === "cc-by-sa" ? " · 동일조건(SA)" : ""}
                </span>
                <label className="pick-select">
                  <span className="sr-only">장면</span>
                  <select
                    value={sceneNo}
                    onChange={(event) => choose(clip.id, Number(event.target.value))}
                  >
                    <option value={0}>쓰지 않음</option>
                    {sceneNos.map((no) => (
                      <option key={no} value={no}>
                        장면 {no}
                        {byScene.get(no) && byScene.get(no)!.id !== clip.id ? " (바꾸기)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="stack">
        <h2>영상 컨셉·목차</h2>
        <label className="field">
          <span>컨셉</span>
          <input
            name="concept"
            maxLength={300}
            defaultValue={state.concept ?? concept}
            placeholder="예: 겨울 바다 화면으로 건조한 피부 보습 상식을 차분하게"
          />
        </label>
        <label className="field">
          <span>목차</span>
          <textarea
            name="outline"
            rows={5}
            maxLength={1500}
            defaultValue={state.outline ?? outline}
            placeholder={"예: 겨울 피부가 건조한 이유 → 보습 성분 비교 → 바르는 순서"}
          />
        </label>
        {state.error ? <p className="error">{state.error}</p> : null}
        <button type="submit" disabled={disabled || pending || !ready}>
          {pending ? "요청 중…" : ready ? "이 클립으로 대본 만들기" : `장면 ${sceneCount}개를 모두 고르세요`}
        </button>
        <p className="muted small">고른 클립만 내려받아 저장하고(무료), 그 화면에 맞춰 Claude 로 대본을 만듭니다(대본 비용).</p>
      </section>
    </form>
  );
}
