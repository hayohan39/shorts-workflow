-- 외부 API 의 실제 청구 비용(일 단위). 지금은 Anthropic Cost API(Admin 키)만 쓴다.
--   day: 비용이 잡힌 날(UTC). Cost API 가 UTC 하루 단위로만 준다.
--   breakdown: [{ model, costType, usd }] — 모델·종류(토큰/웹 검색)별 합계
create table api_costs (
  provider text not null,
  day date not null,
  amount_usd numeric(12, 4) not null,
  breakdown jsonb not null default '[]',
  fetched_at timestamptz not null default now(),
  primary key (provider, day)
);

-- 마지막 조회 결과(성공·건너뜀·실패)와 사유. 공급자당 한 행.
create table api_cost_status (
  provider text primary key,
  state text not null check (state in ('ok', 'skipped', 'failed')),
  message text,
  updated_at timestamptz not null default now()
);
