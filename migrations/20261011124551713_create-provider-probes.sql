-- create-provider-probes
-- 이 파일은 하나의 트랜잭션으로 실행됩니다.
-- 적용된 뒤에는 수정하지 마세요. 새 마이그레이션을 추가하세요.

-- ManyMotions "모델 조회" 결과. 가장 최근 행이 현재 값이다.
-- tools: MCP tools/list 결과(도구 이름·설명·입력 형식)
-- listings: 인자 없이 부를 수 있는 list_* 도구의 응답 원문 {도구 이름: 결과}
-- models: listings 에서 뽑은 모델 목록 [{id, label, kind, credits}]
create table provider_probes (
  id integer generated always as identity primary key,
  provider text not null default 'manymotions',
  state text not null default 'pending' check (state in ('pending', 'running', 'done', 'failed')),
  run_url text,
  tools jsonb,
  listings jsonb,
  models jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
