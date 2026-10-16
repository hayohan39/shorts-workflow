-- 수집 결과의 [채택]: 선택된 클립을 내려받아 mp4 로 바꾼 뒤 Blob 에 올리는 Actions 실행의 상태.
--   adopt_status 가 null 이면 아직 채택을 요청한 적 없음.
alter table clip_collections
  add column adopt_status text check (adopt_status in ('queued', 'running', 'done', 'failed')),
  add column adopt_error text,
  add column adopt_run_url text,
  add column updated_at timestamptz not null default now();
