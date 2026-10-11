-- create-pipeline-tables
-- 이 파일은 하나의 트랜잭션으로 실행됩니다.
-- 적용된 뒤에는 수정하지 마세요. 새 마이그레이션을 추가하세요.

-- 에피소드 하나 = 쇼츠 한 편. status 가 단계 사이의 유일한 연결고리다.
-- step / step_state 는 지금(또는 마지막으로) 돌린 자동 단계와 그 진행 상태다.
-- status 가 failed 이면 step 이 실패한 단계이고, 다시 시도는 그 단계부터 한다.
create table episodes (
  id integer generated always as identity primary key,
  topic text not null,
  outline text not null default '',
  status text not null default 'queued'
    check (status in ('queued', 'script_review', 'approved', 'rendering',
                      'video_review', 'ready', 'uploaded', 'failed')),
  step text check (step in ('script', 'render', 'compose', 'upload')),
  step_state text check (step_state in ('pending', 'running', 'done', 'failed')),
  run_url text,
  scheduled_at timestamptz,
  youtube_video_id text,
  credits_used integer not null default 0,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index episodes_status_idx on episodes (status);

-- 대본은 버전으로 쌓는다(반려·수정할 때마다 새 버전). 화면은 최신 버전을 보여 준다.
create table scripts (
  id integer generated always as identity primary key,
  episode_id integer not null references episodes (id) on delete cascade,
  version integer not null,
  research jsonb not null default '[]',
  narration text not null,
  scenes jsonb not null default '[]',
  title text not null,
  description text not null default '',
  tags text[] not null default '{}',
  needs_ai_disclosure boolean not null default false,
  reviewer_note text,
  created_at timestamptz not null default now(),
  unique (episode_id, version)
);

-- 장면 파일·음성·완성 영상. scene_no 는 장면(video/image)에만 있다.
create table assets (
  id integer generated always as identity primary key,
  episode_id integer not null references episodes (id) on delete cascade,
  scene_no smallint,
  kind text not null check (kind in ('video', 'image', 'voice', 'final')),
  model text,
  mm_job_id text,
  credits integer not null default 0,
  url text,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'done', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index assets_episode_idx on assets (episode_id);

create table uploads (
  id integer generated always as identity primary key,
  episode_id integer not null references episodes (id) on delete cascade,
  privacy text not null default 'private' check (privacy in ('private', 'unlisted', 'public')),
  youtube_url text,
  published_at timestamptz,
  created_at timestamptz not null default now()
);

create index uploads_episode_idx on uploads (episode_id);

-- 설정은 한 행뿐이다(id 가 항상 true).
-- upload_days: 0=일 … 6=토. 기본 화(2)·금(5).
create table settings (
  id boolean primary key default true check (id),
  voice text,
  script_model text,
  video_model text,
  image_model text,
  voice_model text,
  upload_days smallint[] not null default '{2,5}',
  monthly_credit_limit integer not null default 4000 check (monthly_credit_limit > 0),
  updated_at timestamptz not null default now()
);

insert into settings default values;
