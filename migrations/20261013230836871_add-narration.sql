-- 내레이션(⑤-1): 대본 승인 뒤 목소리를 골라 내레이션 음성을 만든다.
--   episodes.voice_id / voice_model: 다음 내레이션 생성에 쓸 목소리(대시보드에서 고른 값)
--   assets.meta: 생성 정보(목소리 이름, ManyMotions 프로젝트 ID, 원본 주소 등)
--   episodes.step 에 'voice'(내레이션 생성) 단계를 더한다.
alter table episodes
  add column voice_id text,
  add column voice_model text;

alter table episodes drop constraint episodes_step_check;
alter table episodes
  add constraint episodes_step_check check (step in ('script', 'voice', 'render', 'compose', 'upload'));

alter table assets add column meta jsonb not null default '{}';
