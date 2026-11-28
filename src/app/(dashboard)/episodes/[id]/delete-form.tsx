"use client";

import { useActionState } from "react";
import { deleteEpisodeAction, type SimpleState } from "../../actions";

/** 쇼츠 삭제(되돌릴 수 없음). 유튜브에 올린 영상은 지워지지 않는다는 것을 함께 알린다. */
export function DeleteEpisodeForm({
  episodeId,
  uploaded,
  scheduled,
  busy,
}: {
  episodeId: number;
  /** 유튜브에 올린 영상이 있는가 */
  uploaded: boolean;
  /** 예약 공개로 올려 두었는가 */
  scheduled: boolean;
  /** 진행 중인 단계가 있는가 */
  busy: boolean;
}) {
  const [state, action, pending] = useActionState<SimpleState, FormData>(deleteEpisodeAction, {});
  return (
    <details className="danger-zone">
      <summary>쇼츠 삭제</summary>
      <form action={action} className="stack">
        <input type="hidden" name="id" value={episodeId} />
        <p className="small">대본·내레이션·장면·음원·완성 영상과 업로드 기록을 모두 지웁니다. 되돌릴 수 없습니다.</p>
        {uploaded ? (
          <p className="warn small">
            유튜브에 올린 영상은 지워지지 않습니다{scheduled ? "(예약 공개도 그대로 진행됩니다)" : ""}. 필요하면 YouTube Studio
            에서 직접 지우세요.
          </p>
        ) : null}
        {busy ? <p className="warn small">진행 중인 단계가 끝난 뒤에 지울 수 있습니다.</p> : null}
        <label className="choice small">
          <input type="checkbox" name="confirm" required />
          <span>되돌릴 수 없다는 것을 확인했습니다</span>
        </label>
        {state.error ? <p className="error">{state.error}</p> : null}
        <button type="submit" className="danger" disabled={pending || busy}>
          {pending ? "지우는 중…" : "이 쇼츠 삭제"}
        </button>
      </form>
    </details>
  );
}
