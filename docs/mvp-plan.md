# 1단계(MVP) 구현 계획

> 기준: [docs/plan.md](plan.md) "8. 일정" 의 1단계.
> **완료 기준: 주제 1개가 Actions 수동 실행만으로 비공개 업로드까지 도달한다.**
> 대시보드·예약 업로드·재시도·장면 재생성은 2~3단계에서 한다.

## 실행 모양

MVP 에는 대시보드가 없다. 모든 조작은 GitHub → Actions → **Pipeline** 워크플로의
"Run workflow" 버튼(workflow_dispatch)으로 한다. 휴대폰 GitHub 앱/웹에서도 된다.
Actions 를 실행할 수 있는 사람은 리포지토리에 쓰기 권한이 있는 사람뿐이므로,
따로 인증을 만들지 않아도 승인 버튼이 공개되지 않는다.

| 버튼(action) | 입력 | 하는 일 | 끝난 뒤 상태 | 검토할 곳 |
| --- | --- | --- | --- | --- |
| `new` | topic, outline | 에피소드 생성 → 대본 생성 | `script_review` | 실행 결과 Summary 에 대본·근거·금지표현 검사 결과 |
| `approve-script` | episode_id, note(선택) | 승인 → 장면·음성 생성 → 합성 | `video_review` | Summary 에 완성 영상 링크(Blob) |
| `reject-script` | episode_id, note | 반려 메모를 넣고 대본 재생성 | `script_review` | 위와 같음 |
| `approve-video` | episode_id | 유튜브 비공개 업로드 | `uploaded` | Summary 에 YouTube Studio 링크 |
| `retry` | episode_id, step | `failed` 에피소드를 지정 단계부터 다시 실행 | 단계별 | |
| `probe` | — | ManyMotions 모델 목록·크레딧표 조회(크레딧 소모 없음) | — | Summary |

사람 개입은 브리프대로 두 번(대본 승인, 영상 승인)이다. 상태가 단계 사이의 유일한 연결고리이고,
각 단계는 시작할 때 상태를 확인한다(예: `approved` 가 아니면 렌더하지 않는다).

```
new ─► [대본] ─► script_review ─approve-script─► approved ─► [렌더] ─► rendering
    ─► [합성] ─► video_review ─approve-video─► ready ─► [업로드] ─► uploaded
어느 단계든 실패 ─► failed + error 기록 ─retry─► 그 단계부터
```

## 코드 구조

```
migrations/                 episodes · scripts · assets · uploads · settings
src/pipeline/
  cli.ts                    npm run pipeline -- <action> ...  (Actions 가 호출)
  episodes.ts               상태 전이 규칙 + DB 접근 (query() 재사용)
  steps/script.ts           대본 생성 (Claude API)
  steps/render.ts           장면·음성 생성 (provider 어댑터 호출) → Blob 저장
  steps/compose.ts          ffmpeg 합성
  steps/upload.ts           YouTube 업로드
  providers/types.ts        MediaProvider 인터페이스 (generateVideo/Image/Voice)
  providers/manymotions.ts  REST + MCP(JSON-RPC) 클라이언트, job 폴링
  script/schema.ts          대본 JSON 스키마
  script/guardrails.ts      식약처 금지 표현 검사 (목록은 데이터 파일로 분리)
  compose/ass.ts            대본 → ASS 자막 (숫자·연도 강조, 하단 고지)
  compose/ffmpeg.ts         ffmpeg 인자 생성 (순수 함수 → 테스트 가능)
  youtube/                  OAuth 토큰 갱신, resumable upload
.github/workflows/pipeline.yml
scripts/youtube-auth.mjs    리프레시 토큰을 한 번 발급받는 로컬 도우미
```

- 파이프라인 코드를 `src/` 아래 둬서 2단계 대시보드(Next.js)가 같은 상태 전이·DB 코드를 쓴다.
- 외부 API 는 전부 어댑터 뒤에 둔다. 테스트는 fetch 를 가짜로 바꿔 돌리고, CI 에서는
  실제 API 를 부르지 않는다(크레딧·비용 0).
- 로컬/CI 에는 실제 키가 없다. **실제 API 호출은 사용자가 버튼을 눌러 실행한 Actions 에서만** 일어난다.

## PR 단위

각 PR 은 `npm run check` + (DB 변경 시) 로컬 마이그레이션 확인 후 올린다. merge 는 사용자.

| # | PR | 내용 | 필요한 시크릿 | 확인 방법 |
| --- | --- | --- | --- | --- |
| 0 | **docs: 기획서·MVP 계획** (이 PR) | `docs/plan.md`, 이 문서, `decisions.md` 기록 | — | 문서 리뷰 |
| 1 | **feat: DB 스키마와 파이프라인 뼈대** | 마이그레이션 5개 테이블, 상태 전이 규칙, `cli.ts`, `pipeline.yml`(action 선택 + 단계별 job 틀, 아직 외부 호출 없음) | (DATABASE_URL 은 이미 있음) | 상태 전이 단위 테스트, 로컬 Postgres 마이그레이션, merge 후 `new` 를 눌러 행이 생기는지 |
| 2 | **feat: ManyMotions 어댑터 + probe** | REST(`seedance-2`, `nano-banana`) + MCP(`list_models` / `media_forge_generate` / `job_status`) 클라이언트, 폴링·타임아웃, 크레딧 기록 형식. `probe` 로 **정확한 model_id 를 조회해서 settings 에 저장**(추측 금지) | `MANYMOTIONS_API_KEY` | 가짜 응답 테스트. merge 후 `probe` 실행 → Summary 의 모델 목록 확인 |
| 3 | **feat: 대본 생성** | Claude API + 웹 검색 → JSON 스키마(근거·출처·내레이션 150~170자·장면 4개·제목 40자·설명·태그·AI 공개 여부), 정책 가드레일 프롬프트, 금지 표현 자동 검사, `approve-script` / `reject-script` | `ANTHROPIC_API_KEY` | 스키마·검사기 테스트. merge 후 PDRN 으로 `new` 실행 → 대본 확인 |
| 4 | **feat: 장면·음성 생성** | 영상 2(Kling 3.0 Std 5초)·이미지 2(Seedream 4.5)·내레이션 1(ElevenLabs v3) 요청 → 결과를 Vercel Blob 에 복사(공급자 URL 은 만료될 수 있음), assets·credits 기록. **월 한도 사전 검사**(이번 달 사용량 + 예상치 > 한도면 시작하지 않음) | `BLOB_READ_WRITE_TOKEN` | 가짜 provider 테스트. merge 후 대본 승인 → 크레딧 실측 |
| 5 | **feat: ffmpeg 합성** | 1080×1920·30fps 로 맞춤, 이미지 확대·이동 모션, 장면 연결, 내레이션 + 음량 정규화, ASS 자막·하단 고지, 한글 폰트. 결과 MP4 → Blob, `video_review` | — | ASS·인자 생성 단위 테스트 + **CI 에서 ffmpeg 로 합성 영상(테스트 패턴) 실제 렌더** 후 해상도·길이 검사 |
| 6 | **feat: 유튜브 비공개 업로드** | 토큰 갱신, resumable upload, 메타데이터(제목·설명·태그·#shorts), `privacyStatus=private`, 아동용 아님, AI 합성 공개 표시, uploads 기록, `scripts/youtube-auth.mjs` | `YOUTUBE_CLIENT_ID` · `YOUTUBE_CLIENT_SECRET` · `YOUTUBE_REFRESH_TOKEN` | 가짜 응답 테스트. merge 후 `approve-video` |
| 7 | **docs: 운영 가이드 + 첫 실행 결과** | `docs/runbook.md`(버튼별 사용법, 실패 시 retry, 비용 확인), PDRN 실측 크레딧을 plan 에 반영 | — | PDRN 1편이 비공개 업로드까지 도달 = **MVP 완료** |

PR 2~6 은 각자 merge 직후 해당 단계만 실제로 돌려 볼 수 있게 순서를 잡았다(키가 준비된 것부터).
실제 실행 버튼은 사용자가 누른다 — 크레딧이 나가기 때문이다.

## 단계별 구현 메모

**대본 (PR 3)**
- Claude API 의 웹 검색 도구로 논문·규제 근거를 찾고, 결과를 구조화된 JSON 으로 받는다.
  모델·가격·도구 버전은 구현 시점 문서로 확인하고, 모델은 `settings` 에서 바꿀 수 있게 한다.
- 프롬프트 고정 규칙: 근거 없으면 "근거 없음", 효능 단정 금지, 의약품 오인 표현 금지,
  화자를 전문가로 소개하지 않음, 첫 2초 질문형 훅, 장면 프롬프트에 글자 금지, 매 편 다른 연출.
- 금지 표현 검사는 코드(정규식 목록)로 한 번 더 한다. 걸리면 Summary 에 경고로 보여 주고
  사람이 승인 시 판단한다(자동 반려는 하지 않음).

**렌더 (PR 4)**
- 공급자 호출은 `MediaProvider` 인터페이스 하나로. ManyMotions 가 바뀌어도 이 파일만 바꾼다.
- 장면 4개 + 음성을 병렬로 요청하고 `job_status` 를 간격을 늘려 가며 폴링, 전체 타임아웃을 둔다.
- 한 장면이라도 실패하면 에피소드를 `failed` 로 두되, **이미 성공한 장면은 assets 에 남겨
  retry 때 다시 만들지 않는다**(크레딧 절약 — 3단계 장면 재생성의 기반).

**합성 (PR 5)**
- 영상 장면은 5초로 자르고 1080×1920 으로 크롭/스케일, 이미지 장면은 zoompan 으로 천천히 확대·이동.
- 내레이션 길이가 20초와 다르면 **이미지 장면 길이로 맞춘다**(영상은 5초 고정, 이미지는 늘이기 쉬움).
- 자막 타이밍은 음성 인식 없이 대본 문장 길이(글자 수) 비율 × 실제 음성 길이로 계산한다.
  어색하면 3단계에서 공급자의 타임스탬프 기능을 검토한다.
- 한글 폰트는 OFL 라이선스 폰트를 워크플로에서 설치(또는 리포지토리에 포함)한다.
- 음량은 `loudnorm` 으로 쇼츠 기준(약 -14 LUFS) 정규화.

**업로드 (PR 6)**
- 미감사 API 프로젝트라 무조건 비공개. 공개는 YouTube Studio 에서 직접(편당 클릭 한 번).
- 실사풍 사람이 나오는 장면이 있으면(`needs_ai_disclosure`) AI 합성 콘텐츠 표시를 켠다.

## 사용자가 준비할 것

키는 채팅에 붙여 넣지 않고 **GitHub → Settings → Secrets and variables → Actions** 에 직접 넣는다.
PR 순서대로 필요해지므로 한 번에 다 할 필요는 없다.

- [ ] `MANYMOTIONS_API_KEY` — manymotions.com dashboard/api-keys (`cw_live_…`) · PR 2 부터
- [ ] `ANTHROPIC_API_KEY` — console.anthropic.com (Claude 구독과 별도 결제) · PR 3 부터.
      새 리포지토리 생성 때 이 시크릿은 복사되지 않았다(빠진 시크릿으로 보고됨).
- [ ] `BLOB_READ_WRITE_TOKEN` — Vercel 대시보드 → shorts-workflow 프로젝트 → Storage →
      Blob 스토어 생성·연결 → 생성된 토큰을 GitHub Secrets 에도 넣기 · PR 4 부터
- [ ] YouTube 3종 · PR 6 부터
  - Google Cloud 프로젝트 → YouTube Data API v3 사용 설정 → OAuth 동의 화면 → OAuth 클라이언트(데스크톱 앱)
  - **OAuth 동의 화면 게시 상태를 "프로덕션"으로** 둔다. "테스트" 상태면 리프레시 토큰이 7일 뒤 만료된다
    (검증 안 된 앱 경고는 본인 계정이라 "계속"으로 넘어가면 된다).
  - PR 6 의 `scripts/youtube-auth.mjs` 를 내 PC 에서 한 번 실행해 리프레시 토큰을 받는다.
- [ ] 고정 목소리 1개 결정 (PR 2 의 `probe` 결과에서 고를 수 있으면 거기서)
- 이미 있음: `DATABASE_URL`(프로젝트 생성 때 설정됨), Vercel·Neon 연결

## 이번 단계에서 하지 않는 것

대시보드 UI, 상태 기반 자동 실행, 화·금 cron, 구글 감사 신청(2단계) /
자동 재시도, 장면 단위 재생성 버튼, 알림(3단계) / Analytics(4단계).
단, 비용 사고를 막는 **월 크레딧 한도 사전 검사**는 PR 4 에 간단히 넣는다.

## 확인이 필요한 가정

1. 승인 방식: MVP 는 Actions 버튼(workflow_dispatch)으로 승인한다. 대시보드는 2단계.
2. ManyMotions 의 정확한 model_id·음성 목록·응답 형식은 문서 접근이 세션에서 막혀 있어
   PR 2 의 `probe` 로 실제 응답을 보고 확정한다. 크레딧 수치도 그때 다시 확인한다.
3. 첫 실제 실행(PDRN 1편)은 크레딧 약 331(재생성 포함 약 435)이 든다.
