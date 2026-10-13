# 남은 할 일

> 2026-10-12 기준. 자세한 계획은 [mvp-plan.md](mvp-plan.md), 결정 기록은 [decisions.md](decisions.md).

## 끝난 것
기획서·MVP 계획(#1) · DB·실행 틀(#2) · 대시보드 로그인·목록·생성(#3) · 리뷰 봇 한도(#4) ·
ManyMotions 모델 조회·설정(#5) · 대본 생성·검토(#6) · 설정 드롭다운·모델 목록 자동 갱신(#7) ·
진행 상황 표시·뒤로가기·기본 모델(Haiku 5.5, 추천 모델)

## 개발 (Claude)
- [x] ⑤-1 내레이션: 목소리 선택·생성·다시 만들기·미리 듣기(전에 만든 내레이션), Blob 저장, 크레딧 한도 사전 검사
- [ ] ⑤-2 장면 생성: 영상 2(Kling 3.0 Standard)·이미지 2(Seedream 4.5) → Blob 저장, 진행 화면
  - `media_forge_generate` 응답에 `credits_consumed` 가 온다(실측). `job_status` 결과의 이미지 주소는 `/api/media-forge/asset/...` 상대 경로
  - ManyMotions 작업은 서버 메모리에만 있어 재배포 때 사라질 수 있다(job_not_found) → 바로바로 폴링하고 사라지면 다시 요청
  - 영상 모델은 `t2v_id`(텍스트→영상) 를 그대로 쓴다
  - 생성 응답의 `credits_consumed` 를 assets.credits 에, `credits_remaining` 으로 잔액도 갱신 (REST 문서 기준, MCP 응답은 첫 실행 때 확인)
- [ ] ⑥ ffmpeg 합성·영상 검토: 자막·고지·이미지 모션·음량 정규화, 영상 재생, 영상 승인
- [ ] ⑦ 유튜브 비공개 업로드: 업로드 버튼, AI 합성 공개 표시, 리프레시 토큰 발급 도우미
- [ ] ⑧ 운영 가이드·MVP 완료: PDRN 실측 크레딧·품질 반영
- [ ] 정리: 쓰지 않는 `provider_probes.models` 컬럼을 지우는 마이그레이션

## 사용자
- [x] 대본 생성 실제 테스트 (#1, Opus 5.5, 약 2분 30초)
- [ ] Haiku 5.5 기본값으로 대본 생성해 보고 품질 확인 → 부족하면 Sonnet 5.5 로, 그래도 부족하면 Gemini 비교 검토
- [ ] Claude 실제 비용 연결: 조직 계정 → Admin 키 → GitHub Secrets `ANTHROPIC_ADMIN_KEY` (설정 화면에 안내)
- [x] Vercel Blob 스토어 연결 → `BLOB_READ_WRITE_TOKEN` GitHub Secrets 등록
- [ ] 내레이션 실제 생성해 보고 목소리 고르기 (편당 약 80크레딧)
- [ ] ⑦ 전: Google Cloud OAuth(동의 화면 게시 상태 "프로덕션") → YouTube 시크릿 3종

## 미결 결정
- 영상/이미지 장면 비율 (⑤ 실측 후)
- 대본 생성에 Grok·Gemini 추가 여부 (Haiku 결과를 본 뒤)

## MVP 이후 (2단계~)
화·금 예약 업로드 · 구글 API 감사 신청(공개 업로드) · 자동 재시도·장면 단위 재생성 · 완료·실패 알림 · YouTube Analytics 반영
