-- 편집형 채널(새새 열매)의 소재 풀과 스토리 후보.
--   소재 풀: 채널마다 모아 두는 영상·사진. 매일 수집은 kind = 'pool' 수집 하나로 남고, 같은 소재(소스·ID)는 다시 넣지 않는다.
--   검색어는 채널 설정에서 고치고, 가장 오래 안 쓴 것부터 다음 페이지를 가져온다(같은 결과를 되풀이하지 않게).
--   스토리 후보: 풀에서 장면 순서대로 소재를 골라 만든 기획안(ideas.clip_ids). 고르면 그 소재로 편집형 에피소드를 만든다.

alter table clip_collections drop constraint clip_collections_kind_check;
alter table clip_collections
  add constraint clip_collections_kind_check check (kind in ('search', 'daily', 'pool'));
alter table clip_collections add column channel text references channels (slug);
create index clip_collections_pool_idx on clip_collections (channel) where kind = 'pool';

-- 에피소드에 쓴 풀 소재(다음 스토리에 다시 넣지 않는다).
alter table clip_candidates add column pool_used_at timestamptz;

-- 풀 검색어. page 는 다음에 가져올 페이지, 결과가 없으면 1로 돌아간다.
create table pool_keywords (
  channel text not null references channels (slug),
  keyword text not null check (length(keyword) between 1 and 60),
  page integer not null default 1 check (page >= 1),
  last_used_at timestamptz,
  primary key (channel, keyword)
);

-- 스토리 후보의 소재(clip_candidates.id, 장면 순서).
alter table ideas add column clip_ids integer[];

insert into pool_keywords (channel, keyword)
select 'saesae', keyword from unnest(array[
  'sparrow', 'tree sparrow', 'magpie', 'crow', 'owl', 'penguin', 'puffin', 'kingfisher', 'woodpecker', 'hummingbird',
  'parrot', 'cockatoo', 'duck', 'mandarin duck', 'swan', 'heron', 'egret', 'crane bird', 'eagle', 'hawk',
  'pigeon', 'robin', 'chickadee', 'tit bird', 'wren', 'flamingo', 'pelican', 'seagull', 'toucan', 'bird bathing',
  'bird feeding chicks', 'bird nest', 'bird courtship display', 'bird flock'
]) as keyword;
