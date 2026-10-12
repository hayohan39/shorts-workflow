-- 진행 중인 단계를 화면에 보여 주기 위한 값.
--   step_started_at: 단계를 요청(대기)하거나 Actions 가 시작한 시각 → 경과 시간 표시
--   step_progress:   Actions 가 중간중간 적는 진행 메모(예: "자료 조사 중 · 웹 검색 3회")
alter table episodes
  add column step_started_at timestamptz,
  add column step_progress text;
