-- 채널 추천(기획안): 카테고리마다 쇼츠 거리 하나씩 기획안(제목·훅·목차·길이)을 받아, 고른 것만 대본으로 만든다.
-- 대본은 고른 뒤에 만든다(근거 조사 비용은 고른 것에만 든다).

-- 채널 카테고리. 추천은 카테고리마다 하나씩.
create table channel_categories (
  id serial primary key,
  channel text not null references channels (slug),
  name text not null check (length(name) between 1 and 30),
  position integer not null default 0,
  unique (channel, name)
);

-- 화면에서 고치는 프롬프트. key 마다 가장 큰 version 이 지금 쓰는 값이고, 고칠 때마다 새 버전을 쌓는다(되돌리기 가능).
--   ideas:<채널>              채널 공통 추천 프롬프트
--   ideas:category:<카테고리 id> 카테고리 추천 프롬프트
create table prompts (
  key text not null check (length(key) <= 80),
  version integer not null check (version >= 1),
  body text not null check (length(body) <= 4000),
  created_at timestamptz not null default now(),
  primary key (key, version)
);

-- 자동 추천(매일 03:17 KST 실행에서 주기가 됐는지 본다). 돈이 드는 자동 실행이라 기본 꺼짐.
alter table channels
  add column ideas_auto boolean not null default false,
  add column ideas_every_days integer not null default 2 check (ideas_every_days between 1 and 7);

-- 추천 실행 한 번(Actions). 비용·실패 이유를 남긴다.
create table idea_runs (
  id serial primary key,
  channel text not null references channels (slug),
  trigger text not null check (trigger in ('manual', 'schedule')),
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  progress text,
  error text,
  model text,
  cost_usd numeric(10, 6),
  run_url text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index idea_runs_channel_created_idx on idea_runs (channel, created_at desc);

-- 기획안. new(새 추천) → saved(저장) / discarded(폐기) / used(에피소드로 만듦).
create table ideas (
  id serial primary key,
  run_id integer references idea_runs (id) on delete set null,
  channel text not null references channels (slug),
  category_id integer references channel_categories (id) on delete set null,
  title text not null,
  hook text not null,
  outline text not null,
  reason text not null default '',
  target_seconds integer not null check (target_seconds between 20 and 55 and target_seconds % 5 = 0),
  status text not null default 'new' check (status in ('new', 'saved', 'discarded', 'used')),
  episode_id integer references episodes (id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index ideas_channel_status_idx on ideas (channel, status, created_at desc);

-- 라쿤씨 카테고리 3개와 기본 프롬프트.
insert into channel_categories (channel, name, position) values
  ('raccoon', '화장품 성분', 1),
  ('raccoon', '피부건강 꿀팁', 2),
  ('raccoon', '피부 과학', 3);

insert into prompts (key, version, body) values
  ('ideas:raccoon', 1,
   '채널 "피부건강 라쿤씨": 피부 건강에 대한 소소하지만 유용한 지식을 쇼츠로 전한다.
시청자는 피부 관리에 관심 있는 20~40대. 말투는 친근하고 차분하게, 근거 중심으로.
과장·공포 마케팅, 특정 제품 추천, 의약품처럼 들리는 효능 표현은 하지 않는다. 한 편에 메시지 하나.');

insert into prompts (key, version, body)
select 'ideas:category:' || id, 1, body
from channel_categories
join (values
  ('화장품 성분', '화장품 성분 소개 및 분석: 성분 하나(또는 자주 함께 쓰는 두 성분)가 무엇이고 피부에 어떻게 작용하는지, 연구 근거가 어느 정도인지, 쓸 때 주의할 점을 짧게 정리할 수 있는 주제. 요즘 화제가 된 성분도 좋다.'),
  ('피부건강 꿀팁', '피부건강 꿀팁: 오늘 바로 해 볼 수 있는 생활 속 피부 관리 팁, 또는 흔한 오해를 바로잡는 주제. 근거가 있는 팁만.'),
  ('피부 과학', '피부와 연관된 과학지식: 피부의 구조·생리·현상(예: 각질이 생기는 이유, 자외선이 피부에 하는 일)을 쉬운 비유로 설명하는 과학 상식.')
) as defaults (name, body) using (name)
where channel = 'raccoon';
