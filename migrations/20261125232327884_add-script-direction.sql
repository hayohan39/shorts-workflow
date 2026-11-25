-- 에피소드마다 대본 생성 때 같이 보내는 연출 방향(예: "친구에게 말하듯 가볍게, 마지막은 질문으로").
-- 채널 공통 지침(prompts 의 script:<채널>)과 달리 이 편에만 쓴다. 비우면 보내지 않는다.
alter table episodes add column script_direction text not null default '' check (length(script_direction) <= 500);
