"use client";

import { useActionState } from "react";
import { approveVideoAction, type SimpleState } from "../../actions";

/** 합성된 영상. 검토 중이면 승인 버튼을 함께 보여 준다(다시 합성 버튼은 진행 영역에 있다). */
export function VideoReview({
  episodeId,
  url,
  caption,
  reviewing,
}: {
  episodeId: number;
  url: string;
  caption: string;
  reviewing: boolean;
}) {
  const [state, approve, approving] = useActionState<SimpleState, FormData>(approveVideoAction, {});
  return (
    <section>
      <h2>완성 영상</h2>
      <video className="final-video" controls playsInline preload="metadata" src={url} />
      <p className="muted small">{caption}</p>
      {reviewing ? (
        <form action={approve} className="stack">
          <input type="hidden" name="id" value={episodeId} />
          <p className="small">휴대폰에서 자막·고지·음량을 확인하고 승인하세요. 제목·설명·태그는 대본 탭에서 확인합니다.</p>
          <button type="submit" disabled={approving}>
            {approving ? "승인 중…" : "영상 승인"}
          </button>
          {state.error ? <p className="error">{state.error}</p> : null}
        </form>
      ) : null}
    </section>
  );
}
