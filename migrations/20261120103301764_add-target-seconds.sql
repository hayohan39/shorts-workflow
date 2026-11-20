-- 영상 길이를 에피소드마다 정한다(20~55초, 5초 단위). 장면 수와 내레이션 글자 수가 이 값에서 나온다(script/schema.ts lengthRules).
-- 기존 에피소드는 35초: 지금까지의 규칙(장면 4개, 공백 제외 150~170자)으로 실제 만든 영상이 약 37초였다.
alter table episodes add column target_seconds integer not null default 35
  check (target_seconds between 20 and 55 and target_seconds % 5 = 0);

-- 채널의 기본 길이(새 에피소드의 기본값). 라쿤씨 30초.
alter table channels add column default_seconds integer not null default 30
  check (default_seconds between 20 and 55 and default_seconds % 5 = 0);
