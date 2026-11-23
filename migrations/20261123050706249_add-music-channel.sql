-- 음악형 채널: 사용자가 직접 만든 음원(Suno 등)을 올리고 → 가사 싱크 → 이미지 → 합성 → 업로드.
--   route music  : 대본·내레이션 없이 음원이 영상의 소리가 된다.
--   music_tracks : 에피소드마다 음원 하나. 영상에 쓰는 구간은 start_seconds 부터 에피소드 길이(target_seconds)만큼.
--                  곡이 그보다 짧으면 곡 전체(앱에서 계산).
alter table episodes drop constraint episodes_route_check;
alter table episodes add constraint episodes_route_check check (route in ('ai', 'clips', 'music'));
alter table channels drop constraint channels_route_check;
alter table channels add constraint channels_route_check check (route in ('ai', 'clips', 'music'));

create table music_tracks (
  episode_id integer primary key references episodes (id) on delete cascade,
  audio_url text not null check (audio_url like 'https://%'),
  file_name text not null check (length(file_name) between 1 and 200),
  duration_seconds numeric(7, 2) not null check (duration_seconds > 0 and duration_seconds <= 900),
  start_seconds numeric(7, 2) not null default 0 check (start_seconds >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 이름은 임시(채널 설정에서 바꾼다). 유튜브 채널을 만들면 토큰 Secret 과 채널 ID 를 넣는다.
insert into channels (slug, name, emoji, route, position, youtube_token_secret, default_seconds, description_footer) values
  ('music', '음악 샘플', '🎤', 'music', 3, 'YOUTUBE_REFRESH_TOKEN_MUSIC', 30, '🎵 이 곡은 AI(Suno)로 만들었습니다.');
