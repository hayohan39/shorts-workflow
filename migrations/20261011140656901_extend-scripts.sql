-- extend-scripts
-- 이 파일은 하나의 트랜잭션으로 실행됩니다.
-- 적용된 뒤에는 수정하지 마세요. 새 마이그레이션을 추가하세요.

-- 대본 검토 화면에 필요한 값. 모두 기본값이 있어 기존 행(없음)에도 안전하다.
--   source: generated(Claude 가 생성) / edited(사람이 수정해 저장)
--   warnings: 금지 표현·길이 등 자동 검사 결과 [{field, message}]
--   model, usage: 생성에 쓴 모델과 토큰·웹 검색 횟수
alter table scripts
  add column source text not null default 'generated' check (source in ('generated', 'edited')),
  add column warnings jsonb not null default '[]',
  add column model text,
  add column usage jsonb;
