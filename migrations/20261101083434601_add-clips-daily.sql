-- 매일 영상 클립 자동 수집 켜기/끄기. 기본은 꺼짐(사용자가 영상 소스 화면에서 켠다).
alter table settings add column clips_daily boolean not null default false;
