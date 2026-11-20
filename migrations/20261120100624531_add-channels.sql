-- 유튜브 채널별로 에피소드를 나눈다. 채널마다 기본 제작 방식과 올릴 유튜브 채널이 다르다.
--   route                : 기본 제작 방식. ai = 생성형(대본 → AI 장면), clips = 편집형(무료 영상·사진 → 스토리)
--   youtube_channel_id   : 올릴 유튜브 채널 ID(UC…). 비어 있으면 자동 업로드를 하지 않는다(다른 채널에 올라가지 않게).
--   youtube_token_secret : 이 채널의 리프레시 토큰이 든 GitHub Secret 이름. pipeline.yml 이 업로드 단계에 넘긴다.
--                          다른 환경변수를 읽지 못하게 이름 형식을 제한한다.
create table channels (
  slug text primary key check (slug ~ '^[a-z][a-z0-9-]{1,30}$'),
  name text not null check (length(name) between 1 and 40),
  emoji text not null default '' check (length(emoji) <= 8),
  route text not null default 'ai' check (route in ('ai', 'clips')),
  position integer not null default 0,
  youtube_channel_id text check (youtube_channel_id ~ '^UC[A-Za-z0-9_-]{22}$'),
  youtube_token_secret text not null unique check (youtube_token_secret ~ '^YOUTUBE_REFRESH_TOKEN(_[A-Z0-9]+)?$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 라쿤씨는 이미 등록한 YOUTUBE_REFRESH_TOKEN 을 그대로 쓴다.
insert into channels (slug, name, emoji, route, position, youtube_token_secret) values
  ('raccoon', '피부건강 라쿤씨', '🦝', 'ai', 1, 'YOUTUBE_REFRESH_TOKEN'),
  ('saesae', '새새 열매', '🐦', 'clips', 2, 'YOUTUBE_REFRESH_TOKEN_SAESAE');

-- 기존 에피소드는 모두 라쿤씨 채널 것이다.
alter table episodes add column channel text not null default 'raccoon' references channels (slug);
create index episodes_channel_created_idx on episodes (channel, created_at desc);
