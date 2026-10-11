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
