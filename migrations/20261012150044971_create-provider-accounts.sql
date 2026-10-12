-- 외부 서비스 계정의 잔여 크레딧(지금은 ManyMotions GET /api/v1/account). 공급자당 한 행, 조회할 때마다 덮어쓴다.
--   credits: 응답에서 찾은 잔여 크레딧(못 찾으면 null)
--   fields:  응답의 숫자 필드만 {경로: 값} 으로(이메일 같은 개인정보는 저장하지 않음). 필드 이름 확인용
create table provider_accounts (
  provider text primary key,
  state text not null check (state in ('ok', 'failed')),
  credits numeric(14, 2),
  credits_field text,
  fields jsonb not null default '{}',
  message text,
  -- 마지막으로 잔액을 받은 시각(실패하면 그대로 둔다) / 마지막 시도 시각
  fetched_at timestamptz,
  checked_at timestamptz not null default now()
);
