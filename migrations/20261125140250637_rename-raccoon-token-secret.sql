-- 라쿤씨 토큰 Secret 이름에도 채널 구분자를 붙인다(YOUTUBE_REFRESH_TOKEN → YOUTUBE_REFRESH_TOKEN_RACCOON).
-- GitHub Secret 은 이름을 바꿀 수 없어서, 사용자가 새 이름으로 하나 더 넣는다(pipeline.yml 도 새 이름만 넘긴다).
update channels set youtube_token_secret = 'YOUTUBE_REFRESH_TOKEN_RACCOON', updated_at = now()
  where slug = 'raccoon' and youtube_token_secret = 'YOUTUBE_REFRESH_TOKEN';
