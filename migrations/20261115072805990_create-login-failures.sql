-- 대시보드 로그인 실패 기록(비밀번호 대입 막기). IP 당·전체 실패 횟수로 잠시 로그인을 막는다.
-- 하루 지난 기록은 새 실패를 적을 때 지운다.
create table login_failures (
  id bigint generated always as identity primary key,
  ip text not null,
  failed_at timestamptz not null default now()
);

create index login_failures_ip_idx on login_failures (ip, failed_at);
create index login_failures_time_idx on login_failures (failed_at);
