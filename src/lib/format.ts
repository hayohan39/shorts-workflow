const dateTime = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** 한국 시간 "10. 11. 오후 02:55" 형식. */
export function formatDateTime(date: Date): string {
  return dateTime.format(date);
}

/** since 부터 지금까지의 경과 시간 "1분 05초" / "45초". */
export function formatElapsed(since: Date, now = Date.now()): string {
  const total = Math.max(0, Math.floor((now - since.getTime()) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes ? `${minutes}분 ${String(seconds).padStart(2, "0")}초` : `${seconds}초`;
}
