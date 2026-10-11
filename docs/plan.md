# shorts-pipeline 기획 브리프

> 원본 기획서: https://claude.ai/code/artifact/7d3c5d02-c69e-4d99-972c-87189aa99fbc (2026-10-11)
> 이 파일은 Claude Code 세션에 넘기기 위한 요약본이다. 수치·정책은 기획서 작성일 기준이며 구현 전에 다시 확인한다.

## 1. 목표와 확정된 결정
- 주제·목차를 넣으면 대본 → 영상 생성 → 자막 합성 → 유튜브 업로드까지 자동으로 진행되는 코드 파이프라인
- 사람의 개입은 두 번: **대본 승인**, **완성 영상 승인** (건강·화장품 정보라 생략 불가)
- 빈도: 주 2편 (화·금), 월 8~9편
- 스타일: 페이스리스 정보형, AI 전문가 캐릭터 사용 금지
- 영상 생성: ManyMotions API (현재 Starter 플랜, 월 4,500크레딧)
- 대본: Claude API (웹 검색으로 논문·규제 근거 수집)
- 합성: ffmpeg
- 인프라: project-bootstrap 템플릿, 배포 Vercel, DB Neon, 작업 실행 GitHub Actions, 영상 파일 Vercel Blob

## 2. 쇼츠 포맷 규격
| 항목 | 규격 |
| --- | --- |
| 길이 | 20초 (내레이션 약 150~170자) |
| 화면 | 9:16, 1080×1920, 30fps |
| 장면 | 4개 = AI 영상 2개(훅·핵심, 각 5초) + AI 이미지 2개(각 5초, 천천히 확대·이동 모션) |
| 대본 | 사용자 목차를 따르되 항목당 한 문장으로 압축, 첫 2초는 질문형 훅 |
| 음성 | 한국어 AI 내레이션 1개, 채널 전체 동일 목소리, 전문가로 소개하지 않음 |
| 자막 | ffmpeg + ASS로 영상에 입힘. 대본에서 직접 생성(음성 인식 사용 안 함). 숫자·연도 강조 |
| 고지 | 하단 고정 “의학적 조언이 아닙니다” |
| AI 영상 프롬프트 | 글자 금지(깨짐). 글자는 전부 자막으로 |
| 메타데이터 | 제목 40자 이내, 설명(요약 + 논문·규제 출처 링크 + 고지), 해시태그 3~5개(#shorts 포함) |
| 다양성 | 장면 연출·훅을 매 편 다르게 (템플릿 반복 = 비진정성 콘텐츠 위험) |

## 3. 파이프라인 단계와 상태
| 단계 | 실행 | 하는 일 | 다음 상태 |
| --- | --- | --- | --- |
| 1. 주제 입력 | Vercel 대시보드 | 주제·목차 입력 | queued |
| 2. 대본 생성 | Actions (입력 즉시) | Claude API + 웹 검색 → 근거 요약·콘티·내레이션·장면 프롬프트·제목·설명을 JSON 스키마로 생성, 식약처 금지 표현 자동 검사 | script_review |
| 3. 대본 승인 | 사람 | 승인·수정·반려 | approved |
| 4. 장면·음성 생성 | Actions | ManyMotions에 영상 2·이미지 2·내레이션 요청, 완료까지 폴링, 크레딧 기록 | rendering → (완료) |
| 5. 합성·자막 | Actions (ffmpeg) | 장면 연결, 이미지 모션, 자막·고지 입힘, 음량 정규화 | video_review |
| 6. 영상 승인 | 사람 | 미리보기 후 승인, 문제 장면만 재생성 가능 | ready |
| 7. 업로드 | Actions (화·금 cron) | ready 1편 업로드 + 메타데이터. 감사 전에는 비공개 업로드 후 알림 | uploaded |

실패 시 status=failed + error 기록, 해당 단계부터 재실행 가능해야 한다.

## 4. 데이터 모델 (Neon)
- episodes: id, topic, outline, status, scheduled_at, youtube_video_id, credits_used, error
- scripts: episode_id, version, research(근거 요약·출처 URL), narration, scenes(JSON: 순서·시간·종류·프롬프트·자막), title, description, tags, needs_ai_disclosure, reviewer_note
- assets: episode_id, scene_no, kind(video/image/voice/final), model, mm_job_id, credits, url, status
- uploads: episode_id, privacy, published_at, youtube_url
- settings: 목소리, 모델, 업로드 요일, 월 크레딧 한도(기본 4,000 — 넘으면 렌더 중단 + 알림)

## 5. ManyMotions API 메모
- 문서: https://manymotions.com/docs/api · 크레딧표: https://manymotions.com/docs/api/credits
- 인증: `Authorization: Bearer cw_live_…` (API 키는 dashboard/api-keys)
- REST 전용 엔드포인트는 일부 모델만: `POST /api/v1/video/seedance-2/generate`, `POST /api/v1/image/nano-banana/generate`
- 나머지 모델은 같은 키로 MCP 엔드포인트 호출: `https://manymotions.com/api/mcp` (Streamable HTTP, JSON-RPC 2.0, `tools/call`)
  - `list_models` → 정확한 model_id 확인 (추측 금지)
  - `media_forge_generate` → job_id 반환 (비동기)
  - `job_status` → 완료 시 result.video / result.images
- 실패한 생성은 자동 환불, 최소 과금 5크레딧
- 사용 예정 모델과 크레딧(문서 기준):
  - Kling 3.0 Standard: 초당 21 → 5초 105
  - Seedream 4.5: 이미지 1장 23
  - ElevenLabs v3: 생성 1회 75
  - 1편 합계 약 331 (재생성 여유 포함 약 435), 월 9편 약 3,000~3,900
- 모델 호출은 어댑터 한 곳에 모아 다른 공급자(Kling 직접, fal.ai 등)로 교체 가능하게

## 6. YouTube 업로드 제약
- Data API `videos.insert`, OAuth 범위 `youtube.upload`
- 2020-07-28 이후 만든 **미감사 API 프로젝트의 업로드는 비공개로 고정** → 초기에는 비공개 업로드 후 Studio에서 수동 공개, 2단계에서 구글 감사 신청
- 실사풍 사람이 나오는 합성 장면이 있으면 AI 합성 콘텐츠 공개 표시
- 쇼츠 기준: 세로·정사각 3분 이하

## 7. 정책 가드레일 (대본 생성 프롬프트에 반영)
- 근거가 없으면 “근거 없음”이라고 쓴다. 효능 단정 금지
- 의약품 오인 표현 금지(식약처 화장품 표시·광고 관리 지침)
- AI 의사·전문가 화자 금지 (2026-07-16 YouTube 비진정성 콘텐츠 가이드)
- 설명란에 출처 링크 필수

## 8. 일정
| 단계 | 기간 | 범위 | 완료 기준 |
| --- | --- | --- | --- |
| 0. 준비 | 이번 주 | API 키·계정 연결, PDRN 1편 반수동 제작으로 크레딧·한국어 음성 품질 실측 | 편당 실제 크레딧 확인 |
| 1. MVP | 1주 | 레포 생성, 단계별 스크립트 4개(대본·렌더·합성·업로드), Actions 수동 실행 | 주제 1개가 비공개 업로드까지 자동 도달 |
| 2. 자동화 | 1주 | 대시보드(입력·승인·미리보기), 상태 기반 자동 실행, 화·금 예약 업로드, 구글 감사 신청 | 사람은 승인 버튼만 누름 |
| 3. 안정화 | 2주 | 실패 재시도, 장면 단위 재생성(장면당 최대 2회), 월 크레딧 한도, 알림 | 4주 연속 주 2편 무사고 |
| 4. 성과 반영 | 이후 | YouTube Analytics 수집 → 훅·주제 패턴을 대본 생성에 반영 | 월간 리포트 |

## 9. 필요한 시크릿 (GitHub Secrets / Vercel env)
- MANYMOTIONS_API_KEY
- ANTHROPIC_API_KEY
- YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN
- DATABASE_URL (Neon)
- BLOB_READ_WRITE_TOKEN (Vercel Blob)

## 10. 첫 에피소드 예시 (PDRN)
목차: 소개 → 제조 방식 → 효과(논문·임상, 없으면 없다고) → 위험성(FDA·식약처 승인 관련 경고) → 마무리(누구·어떤 피부에 맞는지)
핵심 근거: 당뇨발 궤양 RCT(Squadrito 2014, 완치율 37% vs 19%), 바르는 PDRN은 분자량 문제로 임상 근거 부족, 미국 FDA 미용 목적 PDRN 주사 승인 없음, 식약처 PDRN 화장품 광고 위반 106건 적발(2023~2026 상반기)
