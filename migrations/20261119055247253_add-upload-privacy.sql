-- 유튜브 자동 업로드에서 고른 공개 상태. 예약 공개는 이미 있는 scheduled_at 에 공개 시각을 둔다(그동안은 비공개).
-- null 이면 아직 고르지 않음. 업로드 결과(실제 공개 상태)는 uploads 에 남는다.
alter table episodes add column upload_privacy text check (upload_privacy in ('private', 'unlisted', 'public'));
