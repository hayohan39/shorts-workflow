"use client";

import { useActionState, useState } from "react";
import { markUploadedAction, type SimpleState } from "../../actions";

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="secondary"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? "복사됨" : label}
    </button>
  );
}

/**
 * 유튜브에 직접 올리기 위한 재료: 완성 영상 내려받기, 제목·설명·태그 복사, 업로드 화면에서 고를 값.
 * 올린 뒤 "올렸어요" 를 누르면 업로드 완료로 표시한다(영상 링크는 선택).
 */
export function UploadKit({
  episodeId,
  downloadUrl,
  title,
  description,
  tags,
  synthetic,
  canMark,
}: {
  episodeId: number;
  downloadUrl: string;
  title: string;
  description: string;
  tags: string[];
  synthetic: boolean;
  canMark: boolean;
}) {
  const [state, mark, marking] = useActionState<SimpleState, FormData>(markUploadedAction, {});
  return (
    <section className="stack">
      <h2>유튜브에 올리기</h2>
      <p className="muted small">YouTube 앱이나 Studio 에서 직접 올립니다. 아래 순서대로 하면 됩니다.</p>

      <div className="stack">
        <strong>1. 영상 내려받기</strong>
        <a className="button" href={downloadUrl} download>
          완성 영상 내려받기 (mp4)
        </a>
      </div>

      <div className="stack">
        <div className="row between">
          <strong>2. 제목</strong>
          <CopyButton text={title} label="제목 복사" />
        </div>
        <p className="prewrap">{title}</p>
      </div>

      <div className="stack">
        <div className="row between">
          <strong>3. 설명</strong>
          <CopyButton text={description} label="설명 복사" />
        </div>
        <details>
          <summary>설명 보기 (출처 표기·해시태그 포함)</summary>
          <pre className="raw prewrap">{description}</pre>
        </details>
      </div>

      {tags.length ? (
        <div className="stack">
          <div className="row between">
            <strong>4. 태그 (선택)</strong>
            <CopyButton text={tags.join(", ")} label="태그 복사" />
          </div>
          <p className="muted small">{tags.join(", ")}</p>
        </div>
      ) : null}

      <div className="stack">
        <strong>5. 업로드 화면에서 고를 것</strong>
        <ul className="small">
          <li>공개 상태: 공개 (또는 원하는 날짜로 예약)</li>
          <li>시청자층: 아니요, 아동용이 아닙니다</li>
          <li>
            변경되었거나 합성된 콘텐츠: <strong>{synthetic ? "예" : "아니요"}</strong>
            {synthetic ? " (AI 로 만든 장면이 있습니다)" : " (무료 클립만 썼습니다)"}
          </li>
          <li>카테고리: 교육</li>
        </ul>
      </div>

      {canMark ? (
        <form action={mark} className="stack">
          <input type="hidden" name="id" value={episodeId} />
          <strong>6. 올린 뒤</strong>
          <input name="link" type="url" placeholder="유튜브 영상 링크 (선택, 예: https://youtu.be/…)" />
          <button type="submit" disabled={marking}>
            {marking ? "기록 중…" : "올렸어요"}
          </button>
          {state.error ? <p className="error">{state.error}</p> : null}
        </form>
      ) : null}
    </section>
  );
}
