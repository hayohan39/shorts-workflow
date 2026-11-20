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

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** datetime-local 입력값(한국 시간, 분 단위) "2026-11-21T18:00". */
export function kstInputValue(date: Date): string {
  return new Date(date.getTime() + KST_OFFSET_MS).toISOString().slice(0, 16);
}

/** 한국 날짜 키 "2026-11-21"(같은 날 묶기용). */
export function kstDayKey(date: Date): string {
  return kstInputValue(date).slice(0, 10);
}

const day = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", weekday: "short" });
const time = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit" });

/** 한국 시간 "11. 21. (금)". */
export function formatDay(date: Date): string {
  return day.format(date);
}

/** 한국 시간 "오후 06:00". */
export function formatTime(date: Date): string {
  return time.format(date);
}
