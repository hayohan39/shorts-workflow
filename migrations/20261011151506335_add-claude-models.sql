-- add-claude-models
-- 이 파일은 하나의 트랜잭션으로 실행됩니다.
-- 적용된 뒤에는 수정하지 마세요. 새 마이그레이션을 추가하세요.

-- 모델 조회 때 Anthropic 모델 목록도 함께 저장한다(설정 화면의 대본 모델 드롭다운).
-- [{id, label}] 또는 조회 실패 시 {error}
alter table provider_probes add column claude_models jsonb;
