-- 음악 채널의 이름을 정했다: 하박. 채널 설정에서 이미 바꿨으면 그대로 둔다.
update channels set name = '하박', updated_at = now() where slug = 'music' and name = '음악 샘플';
