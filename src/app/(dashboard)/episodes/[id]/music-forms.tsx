"use client";

import { upload } from "@vercel/blob/client";
import { useActionState, useRef, useState, type ChangeEvent } from "react";
import { formatClock } from "@/lib/format";
import { AUDIO_MAX_BYTES, MUSIC_MAX_SECONDS, MUSIC_MIN_SECONDS, musicUploadPath } from "@/pipeline/music/rules";
import { saveMusicAudioAction, setMusicStartAction, type MusicActionState } from "../../music-actions";

/** 브라우저에서 곡 길이를 읽는다(서버는 파일을 받지 않는다. 합성할 때 다시 잰다). */
function readDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      if (Number.isFinite(audio.duration) && audio.duration > 0) resolve(audio.duration);
      else reject(new Error("곡 길이를 읽지 못했습니다. mp3·wav·m4a 파일로 올리세요."));
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("이 브라우저에서 재생할 수 없는 파일입니다. mp3·wav·m4a 파일로 올리세요."));
    };
    audio.src = url;
  });
}

/** 음원 올리기: 브라우저가 Vercel Blob 에 바로 올리고(서버 함수 크기 한도를 피한다) 주소를 저장한다. */
export function MusicUploader({ episodeId, replacing }: { episodeId: number; replacing: boolean }) {
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    setError(null);
    if (!file.type.startsWith("audio/")) return setError("음원 파일(mp3·wav·m4a)만 올릴 수 있습니다.");
    if (file.size > AUDIO_MAX_BYTES) return setError(`파일이 ${AUDIO_MAX_BYTES / 1024 / 1024}MB 를 넘습니다. mp3 로 올리세요.`);
    try {
      setProgress("곡 길이 확인 중");
      const duration = await readDuration(file);
      if (duration < MUSIC_MIN_SECONDS) throw new Error(`곡이 너무 짧습니다(${MUSIC_MIN_SECONDS}초 이상).`);
      if (duration > MUSIC_MAX_SECONDS) throw new Error(`곡은 ${MUSIC_MAX_SECONDS / 60}분 이내만 올릴 수 있습니다.`);
      const blob = await upload(musicUploadPath(episodeId, file.name), file, {
        access: "public",
        handleUploadUrl: "/api/music/upload",
        contentType: file.type,
        onUploadProgress: ({ percentage }) => setProgress(`올리는 중 ${Math.round(percentage)}%`),
      });
      setProgress("저장 중");
      const result = await saveMusicAudioAction({ episodeId, url: blob.url, fileName: file.name, durationSeconds: duration });
      if (result.error) setError(result.error);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      // 업로드 토큰을 못 받은 경우(로그인이 풀렸거나 이미 다음 단계로 넘긴 에피소드). 라이브러리 메시지는 영어라 바꿔 보여 준다.
      setError(
        /client token/i.test(message)
          ? "업로드를 준비하지 못했습니다. 다시 로그인했는지, 이 쇼츠가 아직 음원 단계인지 확인하세요."
          : message,
      );
    } finally {
      setProgress(null);
    }
  }

  return (
    <div className="stack">
      <label className="field">
        <span>{replacing ? "다른 음원으로 바꾸기" : "음원 파일"}</span>
        <input type="file" accept="audio/*" onChange={onChange} disabled={progress !== null} />
        <small className="muted">
          mp3·wav·m4a, {AUDIO_MAX_BYTES / 1024 / 1024}MB 까지. Suno 에서 받은 곡을 그대로 올리면 됩니다
          {replacing ? " (바꾸면 구간은 처음부터 다시 고릅니다)" : ""}.
        </small>
      </label>
      {progress ? <p className="small">{progress}…</p> : null}
      {error ? <p className="error small">{error}</p> : null}
    </div>
  );
}

/** 영상에 쓸 구간 고르기: 시작 지점을 옮기고 그 구간만 들어 본다. */
export function MusicSegmentPicker({
  episodeId,
  audioUrl,
  duration,
  start: savedStart,
  seconds,
  editable,
}: {
  episodeId: number;
  audioUrl: string;
  duration: number;
  start: number;
  seconds: number;
  editable: boolean;
}) {
  const [state, formAction, pending] = useActionState<MusicActionState, FormData>(setMusicStartAction, {});
  const [start, setStart] = useState(savedStart);
  const audioRef = useRef<HTMLAudioElement>(null);
  // 구간 듣기: 끝 시각에 멈춘다. 사용자가 재생 막대를 직접 옮기면 멈추지 않는다(구간 듣기가 옮긴 것은 빼고).
  const stopAt = useRef<number | null>(null);
  const ownSeek = useRef(false);
  const max = Math.max(0, Math.floor((duration - seconds) * 10) / 10);
  const clamp = (value: number) => Math.min(Math.max(Math.round(value * 10) / 10, 0), max);

  function playSegment() {
    const audio = audioRef.current;
    if (!audio) return;
    ownSeek.current = true;
    audio.currentTime = start;
    stopAt.current = start + seconds;
    void audio.play();
  }

  function onSeeking() {
    if (ownSeek.current) ownSeek.current = false;
    else stopAt.current = null;
  }

  function onTimeUpdate() {
    const audio = audioRef.current;
    if (audio && stopAt.current !== null && audio.currentTime >= stopAt.current) {
      audio.pause();
      stopAt.current = null;
    }
  }

  return (
    <div className="stack">
      <audio ref={audioRef} src={audioUrl} controls preload="metadata" onTimeUpdate={onTimeUpdate} onSeeking={onSeeking} />
      <p className="small">
        쓸 구간:{" "}
        <strong>
          {formatClock(start)} ~ {formatClock(start + seconds)}
        </strong>{" "}
        ({seconds}초 · 곡 전체 {formatClock(duration)})
      </p>
      {editable && max > 0 ? (
        <form action={formAction} className="stack">
          <input type="hidden" name="id" value={episodeId} />
          <input type="hidden" name="start" value={start} />
          <label className="field">
            <span>시작 지점</span>
            <input
              type="range"
              min={0}
              max={max}
              step={0.1}
              value={start}
              onChange={(event) => setStart(clamp(Number(event.currentTarget.value)))}
            />
          </label>
          <div className="row nudges">
            <button type="button" className="secondary" onClick={() => setStart(clamp(start - 0.5))}>
              −0.5초
            </button>
            <button type="button" className="secondary" onClick={() => setStart(clamp(start + 0.5))}>
              +0.5초
            </button>
            <button type="button" className="secondary" onClick={() => setStart(clamp(audioRef.current?.currentTime ?? start))}>
              재생 위치로
            </button>
          </div>
          <div className="row nudges">
            <button type="button" className="secondary" onClick={playSegment}>
              ▶ 이 구간 듣기
            </button>
            <button type="submit" disabled={pending || start === savedStart}>
              {pending ? "저장 중…" : "구간 저장"}
            </button>
          </div>
          {state.error ? <p className="error small">{state.error}</p> : null}
          {state.saved && start === savedStart ? <p className="muted small">저장했습니다.</p> : null}
        </form>
      ) : (
        <button type="button" className="secondary" onClick={playSegment}>
          ▶ 이 구간 듣기
        </button>
      )}
    </div>
  );
}
