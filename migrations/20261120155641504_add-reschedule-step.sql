-- 예약 공개로 올린 영상의 공개 시각을 바꾸는 단계(reschedule). 상태는 그대로(uploaded) 둔다.
alter table episodes drop constraint episodes_step_check;
alter table episodes
  add constraint episodes_step_check check (step in ('script', 'voice', 'render', 'compose', 'upload', 'reschedule'));
