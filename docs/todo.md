# 남은 할 일

> 2026-10-16 기준. 자세한 계획은 [mvp-plan.md](mvp-plan.md), 결정 기록은 [decisions.md](decisions.md).

## 끝난 것
기획서·MVP 계획(#1) · DB·실행 틀(#2) · 대시보드 로그인·목록·생성(#3) · 리뷰 봇 한도(#4) ·
ManyMotions 모델 조회·설정(#5) · 대본 생성·검토(#6) · 설정 드롭다운·모델 목록 자동 갱신(#7) ·
진행 상황 표시·뒤로가기·기본 모델(#8) · Claude 실제 비용(#9·#10) · ManyMotions 잔여 크레딧(#11) ·
내레이션(#14) · 비용 실행 규칙(#15) · 장면 생성(#16) · 영상 합성·검토(#17)

## 개발 (Claude)
- [x] ⑤-1 내레이션: 목소리 선택·생성·다시 만들기, Blob 저장, 크레딧 한도 사전 검사
- [x] ⑤-2 장면 생성: 영상 2·이미지 2 동시 요청 → Blob 저장, 장면 갤러리, 실패 시 남은 장면만 다시
  - 영상 결과(`result.video`) 형태는 실제 첫 실행 때 확인 필요(이미지는 실측)
  - ManyMotions 작업은 서버 메모리에만 있어 재배포 때 사라질 수 있다(job_not_found) → 바로바로 폴링하고 사라지면 다시 요청
  - 영상 모델은 `t2v_id`(텍스트→영상) 를 그대로 쓴다
  - 생성 응답의 `credits_consumed` 를 assets.credits 에, `credits_remaining` 으로 잔액도 갱신 (REST 문서 기준, MCP 응답은 첫 실행 때 확인)
- [x] ⑥ ffmpeg 합성·영상 검토: 자막(숫자 강조)·하단 고지·이미지 확대·이동·음량 -14 LUFS, 영상 재생, 영상 승인, 다시 합성
- [ ] 무료 라이선스 영상 소스 수집 ([계획](clips-plan.md))
  - [x] 기반: 타입·라이선스 판정·선별·키워드 확장·백오프·스키마
  - [ ] Pixabay → 기능 1(주제 검색·채택) → NASA → Wikimedia → Internet Archive → 기능 2(매일 수집·태그) → 장면 연동 → 공유마당
- [ ] 정리: 쓰지 않는 `provider_probes.models` 컬럼을 지우는 마이그레이션

## 사용자
- [x] 대본 생성 실제 테스트 (#1, Opus 5.5, 약 2분 30초)
- [ ] Haiku 5.5 기본값으로 대본 생성해 보고 품질 확인 → 부족하면 Sonnet 5.5 로, 그래도 부족하면 Gemini 비교 검토
- [x] Claude 실제 비용 연결 (조직 전환 + Admin 키)
- [x] Vercel Blob 스토어 연결 → `BLOB_READ_WRITE_TOKEN` GitHub Secrets 등록
- [x] 내레이션·장면 생성 실제 실행 확인
- [ ] Pixabay API 키 → GitHub Secrets `PIXABAY_API_KEY` (https://pixabay.com/api/docs/ 로그인 후 확인)
- [ ] (공유마당 PR 전) 공유마당 API 키 → `GONGU_API_KEY`
- [ ] 첫 영상 합성 결과를 휴대폰으로 확인 (자막 크기·위치, 고지, 음량)

## 보류: 유튜브 업로드 (새 기능을 더 넣은 뒤 진행 — 2026-10-16 사용자 결정)
- [ ] ⑦ 유튜브 비공개 업로드: 업로드 버튼, AI 합성 공개 표시, 리프레시 토큰 발급 도우미 ([계획](mvp-plan.md#pr--feat-유튜브-비공개-업로드))
  - 사용자 준비: Google Cloud OAuth(동의 화면 게시 상태 "프로덕션") → GitHub Secrets `YOUTUBE_CLIENT_ID` / `_SECRET` / `_REFRESH_TOKEN`
- [ ] ⑧ 운영 가이드·MVP 완료: PDRN 실측 크레딧·품질 반영 (⑦ 뒤)
- 그동안 영상은 승인까지 하고 "업로드 대기" 상태로 둔다. 필요하면 대시보드의 완성 영상을 내려받아 직접 올린다.

## 미결 결정
- 영상/이미지 장면 비율 (⑤ 실측 후)
- 대본 생성에 Grok·Gemini 추가 여부 (Haiku 결과를 본 뒤)

## MVP 이후 (2단계~)
화·금 예약 업로드 · 구글 API 감사 신청(공개 업로드) · 자동 재시도·장면 단위 재생성(지금은 없는 장면만 다시 만듦) · 완료·실패 알림 · YouTube Analytics 반영
