-- 에피소드 만드는 길 두 가지.
--   ai    : 주제·목차 → 대본 → 내레이션 → 장면 생성(AI) → 영상 → 업로드 (기존 에피소드는 모두 이것)
--   clips : 주제·연관 단어 → 무료 영상 찾기 → 4개 골라 순서 지정 + 컨셉·목차 → 대본 → 내레이션 → 영상 → 업로드
alter table episodes add column route text not null default 'ai' check (route in ('ai', 'clips'));

-- clips 길에서 장면마다 고른 클립(장면 순서). 대본을 승인하면 이 클립으로 장면을 채운다.
create table episode_clips (
  episode_id integer not null references episodes (id) on delete cascade,
  scene_no integer not null check (scene_no >= 1),
  clip_id integer not null references clip_candidates (id) on delete cascade,
  primary key (episode_id, scene_no),
  unique (episode_id, clip_id)
);
