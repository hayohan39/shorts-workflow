-- 무료 라이선스 영상 클립 수집.
--   clip_tags:          매일 자동 수집에 쓰는 태그(최근 7일 안에 쓴 태그는 건너뛴다)
--   clip_collections:   수집 한 번(주제 검색 또는 매일 수집). 키워드·합계 길이·부족 사유
--   clip_candidates:    수집에서 받은 후보. rank 가 있으면 선택된 클립(순서), 없으면 교체 후보.
--                       라이선스는 수집 시점 값을 그대로 남긴다(license_raw).
--                       채택하면 파일을 Blob 으로 옮겨 blob_url 에 남긴다.
--   clip_source_state:  소스별 요청 수·마지막 429·다시 시도해도 되는 시각
--   clip_search_cache:  소스 응답 캐시(Pixabay 는 24시간 캐시가 이용 조건)
create table clip_tags (
  id integer generated always as identity primary key,
  name text not null unique,
  active boolean not null default true,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);

create table clip_collections (
  id integer generated always as identity primary key,
  kind text not null check (kind in ('search', 'daily')),
  topic text not null,
  tag_id integer references clip_tags (id) on delete set null,
  episode_id integer references episodes (id) on delete set null,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  keywords text[] not null default '{}',
  -- 소스별 결과 수·오류 {pixabay: {found, kept, error}}
  source_results jsonb not null default '{}',
  total_seconds numeric(6, 1),
  shortfall text,
  keyword_cost_usd numeric(10, 6),
  run_url text,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index clip_collections_created_idx on clip_collections (created_at desc);

create table clip_candidates (
  id integer generated always as identity primary key,
  collection_id integer not null references clip_collections (id) on delete cascade,
  source text not null,
  source_id text not null,
  keyword text not null,
  title text not null,
  page_url text not null,
  thumbnail_url text,
  preview_url text,
  download_url text,
  width integer,
  height integer,
  duration_sec numeric(6, 1),
  author text,
  author_url text,
  license_code text not null,
  license_name text not null,
  license_url text,
  license_raw jsonb not null default '{}',
  fetched_at timestamptz not null default now(),
  score numeric(4, 2) not null default 0,
  rank smallint,
  blob_url text,
  adopted_at timestamptz,
  unique (collection_id, source, source_id)
);

create table clip_source_state (
  source text primary key,
  -- 오늘(KST) 요청 수. 날짜가 바뀌면 0 부터
  day date not null,
  requests integer not null default 0,
  last_status integer,
  last_429_at timestamptz,
  retry_at timestamptz,
  updated_at timestamptz not null default now()
);

create table clip_search_cache (
  source text not null,
  query text not null,
  response jsonb not null,
  fetched_at timestamptz not null default now(),
  primary key (source, query)
);
