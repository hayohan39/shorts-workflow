# 1단계(MVP) 구현 계획

> 기준: [docs/plan.md](plan.md) "8. 일정" 의 1단계(기간 1주).
> **완료 기준: 주제 1개가 Actions 수동 실행만으로 유튜브 비공개 업로드까지 도달한다.**

## 한눈에 보기

| PR | 제목 | 선행 | 필요한 시크릿 | merge 후 사용자가 할 일 | 크레딧 |
| --- | --- | --- | --- | --- | --- |
| #1 | docs: 기획서와 MVP 계획 (이 PR) | — | — | 계획 확인 | 0 |
| ① | feat: DB 스키마와 파이프라인 뼈대 | #1 | — | `new` 실행 → 에피소드 생성 확인 | 0 |
| ② | feat: ManyMotions 어댑터 + probe | ① | `MANYMOTIONS_API_KEY` | `probe` 실행 → 모델·목소리 확인 | 0 |
| ③ | feat: 대본 생성과 대본 승인 | ① | `ANTHROPIC_API_KEY` | PDRN 으로 `new` → 대본 검토 | 0 (Claude API 소액) |
| ④ | feat: 장면·음성 생성 | ②③ | `BLOB_READ_WRITE_TOKEN` | `retry`(render) → 장면 4개·음성 확인 | 약 331 |
| ⑤ | feat: ffmpeg 합성 | ④ | — | `retry`(compose) → 완성 영상 확인 | 0 |
| ⑥ | feat: 유튜브 비공개 업로드 | ⑤ | `YOUTUBE_*` 3종 | `approve-video` → Studio 확인 | 0 |
| ⑦ | docs: 운영 가이드와 MVP 완료 기록 | ⑥ | — | 새 주제 1편 처음부터 끝까지 | 약 331 |

- PR 은 위 순서대로 하나씩 올린다. 다음 PR 은 앞 PR 이 merge 된 main 에서 시작한다.
  (②와 ③은 서로 독립이라 리뷰 순서는 바꿔도 된다.)
- 각 PR 은 `npm run check` 통과, DB 변경 시 로컬 마이그레이션 확인, CI 초록불 후 리뷰를 요청한다.
- 테스트는 가짜 응답을 쓴다. **크레딧이 나가는 실제 실행은 사용자가 버튼을 누를 때만** 일어난다.

### 예상 일정 (merge·시크릿 준비가 바로 된다는 가정)

| 일차 | PR | 사용자 준비 |
| --- | --- | --- |
| 1 | #1, ① | ManyMotions·Anthropic 키 발급 |
| 2 | ②, ③ | 키 2개 등록 → `probe`, 첫 대본 |
| 3 | ④ | Vercel Blob 스토어 연결, 목소리 결정 |
| 4 | ⑤ | — |
| 5 | ⑥ | Google Cloud·OAuth 설정, 리프레시 토큰 발급 |
| 6~7 | ⑦ + 실제 실행 | 영상 검토·승인 |

---

## 실행 방식 (MVP 공통)

대시보드는 2단계에서 만든다. MVP 에서는 GitHub → Actions → **Pipeline** 워크플로의
"Run workflow" 버튼으로 실행·승인한다(휴대폰 GitHub 앱/웹 가능). 쓰기 권한자만 실행할 수 있어
별도 인증이 필요 없다. 검토할 내용은 실행 결과 **Summary** 에 나온다.

| 버튼(action) | 입력 | 하는 일 | 끝난 뒤 상태 | 추가되는 PR |
| --- | --- | --- | --- | --- |
| `new` | topic, outline | 에피소드 생성 → 대본 생성 | `script_review` | ①(생성만) → ③(대본까지) |
| `probe` | — | ManyMotions 모델·목소리·크레딧 조회 | — | ② |
| `approve-script` | episode_id, note | 대본 승인 → 장면·음성 생성 → 합성 | `video_review` | ③(승인) → ④(렌더) → ⑤(합성) |
| `reject-script` | episode_id, note | 반려 메모를 반영해 대본 재생성 | `script_review` | ③ |
| `approve-video` | episode_id | 유튜브 비공개 업로드 | `uploaded` | ⑥ |
| `retry` | episode_id, step | 실패·재작업을 지정 단계부터 다시 | 단계별 | ① 틀, 각 PR 에서 단계 추가 |

상태 흐름 (상태가 단계 사이의 유일한 연결고리이고, 각 단계는 시작할 때 상태를 확인한다):

```
queued ─[대본]─► script_review ─approve─► approved ─[렌더]─► rendering ─[합성]─► video_review
       ─approve─► ready ─[업로드]─► uploaded
어느 단계든 실패 ─► failed (error 기록) ─retry─► 그 단계부터
```

---

## PR 별 상세

### PR ① feat: DB 스키마와 파이프라인 뼈대

**목적**: 이후 모든 단계가 쓰는 데이터 구조와 실행 틀을 만든다. 외부 API 는 아직 부르지 않는다.

작업
- [ ] 마이그레이션: `episodes`, `scripts`, `assets`, `uploads`, `settings` (브리프 4장 컬럼 그대로)
  - `episodes.status` 는 허용 값만 들어가도록 CHECK 제약
  - `settings` 기본값 행: 월 크레딧 한도 4,000, 업로드 요일 화·금
- [ ] `src/pipeline/status.ts`: 상태 목록과 허용 전이 표
- [ ] `src/pipeline/episodes.ts`: 에피소드 생성·조회, 상태 전이(기대 상태가 아니면 거부), 실패 기록
- [ ] `src/pipeline/cli.ts` + `npm run pipeline -- <action>`: Actions 가 호출하는 진입점
- [ ] `.github/workflows/pipeline.yml`: 수동 실행 입력(action, episode_id, topic, outline, note, step),
      같은 에피소드 동시 실행 방지, Summary 작성
- [ ] 이 PR 에서 `new` 는 에피소드를 `queued` 로 만드는 데까지만

확인
- 상태 전이 단위 테스트, DB 테스트(로컬·CI Postgres), 로컬 `npm run migrate`
- **merge 후**: Actions → Pipeline → `new` 실행 → Summary 에 "에피소드 #1 (queued)"

배포 영향: 새 테이블 5개(기존 데이터 없음, 삭제 없음).

### PR ② feat: ManyMotions 어댑터 + probe

**목적**: 영상·이미지·음성 생성 호출을 한 곳(어댑터)에 모으고, 실제 model_id 를 조회해 확정한다.

작업
- [ ] `src/pipeline/providers/types.ts`: `MediaProvider` 인터페이스 (영상·이미지·음성 생성, 작업 상태 조회, 모델 목록)
- [ ] `src/pipeline/providers/manymotions.ts`
  - REST: `POST /api/v1/video/seedance-2/generate`, `POST /api/v1/image/nano-banana/generate`
  - MCP(`/api/mcp`, JSON-RPC `tools/call`): `list_models`, `media_forge_generate`, `job_status`
  - 완료까지 폴링(간격 점점 늘림, 전체 타임아웃), 실패 사유·크레딧 반환
- [ ] `probe` 버튼: 모델 목록·크레딧·목소리 목록을 Summary 표로. 사용 예정 모델
      (Kling 3.0 Standard, Seedream 4.5, ElevenLabs v3)의 model_id 를 찾으면 `settings` 에 저장,
      후보가 여럿이면 저장하지 않고 보여 준다(추측 금지)

확인
- 가짜 응답으로 요청 형식·폴링 완료/실패/타임아웃 테스트
- **merge 후**: `MANYMOTIONS_API_KEY` 등록 → `probe` → 모델 ID·크레딧표 확인, **목소리 1개 결정**

배포 영향: 새 시크릿 `MANYMOTIONS_API_KEY` (GitHub Secrets).

### PR ③ feat: 대본 생성과 대본 승인

**목적**: 주제·목차 → 근거 조사 → 검토 가능한 대본(JSON)까지. 첫 번째 사람 승인 관문.

작업
- [ ] `src/pipeline/script/schema.ts`: 대본 JSON 형식과 검증
  - 근거 목록(주장·출처 URL·근거 수준), 내레이션 150~170자, 장면 4개(영상 2 + 이미지 2, 각 5초,
    프롬프트·자막), 제목 40자 이내, 설명, 해시태그 3~5개(#shorts 포함), AI 공개 필요 여부
- [ ] 대본 생성 프롬프트: 브리프 7장 가드레일(근거 없으면 "근거 없음", 효능 단정·의약품 오인 표현 금지,
      전문가 화자 금지, 출처 필수) + 첫 2초 질문형 훅, 장면 프롬프트 글자 금지, 매 편 다른 연출
- [ ] Claude API 호출(웹 검색 도구 + 구조화 출력). 모델은 `settings` 로 바꿀 수 있게
- [ ] `src/pipeline/script/guardrails.ts` + 금지 표현 목록 데이터 파일: 걸리면 Summary 에 경고(자동 반려는 안 함)
- [ ] 버튼: `new`(대본까지), `approve-script`(→ `approved`), `reject-script`(메모 반영 재생성, version 증가)
- [ ] Summary: 내레이션, 장면표, 근거·출처, 금지 표현 검사 결과

확인
- 스키마 검증·금지 표현 검사 테스트, 가짜 Claude 응답으로 단계 전체 테스트
- **merge 후**: `ANTHROPIC_API_KEY` 등록 → PDRN 목차로 `new` → 대본 검토 → 승인 또는 반려

배포 영향: 새 시크릿 `ANTHROPIC_API_KEY`.

### PR ④ feat: 장면·음성 생성

**목적**: 승인된 대본으로 장면 4개와 내레이션을 만들어 저장한다. 처음으로 크레딧이 나가는 단계.

작업
- [ ] `src/pipeline/steps/render.ts`: `approved` → `rendering`
  - 영상 2·이미지 2·내레이션 1 을 병렬 요청, `assets` 에 작업 ID·상태·크레딧 기록
  - 결과 파일을 Vercel Blob 에 복사(공급자 URL 은 만료될 수 있음)
  - `episodes.credits_used` 합산
- [ ] **월 크레딧 한도 사전 검사**: 이번 달 사용량 + 이번 편 예상치 > 한도면 시작하지 않고 실패 처리
- [ ] 일부 장면 실패 시: 성공한 장면은 남기고 `failed`. `retry` 는 못 만든 장면만 다시 요청
- [ ] Summary: 장면별 상태·크레딧·미리보기 링크

확인
- 가짜 provider 로 성공·부분 실패·한도 초과 테스트
- **merge 후**: Blob 스토어 연결 + `BLOB_READ_WRITE_TOKEN` 등록 → PR ③ 에서 승인한 대본으로
  `retry`(render) → 장면·음성 확인, **실제 크레딧 실측**(0단계의 실측을 여기서 한다)

배포 영향: 새 시크릿 `BLOB_READ_WRITE_TOKEN`, Vercel Blob 사용(무료 한도 내 예상).

### PR ⑤ feat: ffmpeg 합성

**목적**: 장면·음성·자막을 합쳐 업로드 가능한 MP4 를 만든다. 두 번째 사람 승인 관문의 준비.

작업
- [ ] `src/pipeline/compose/ass.ts`: 대본 → ASS 자막(문장 단위, 글자 수 비율 × 실제 음성 길이로 타이밍,
      숫자·연도 강조, 하단 "의학적 조언이 아닙니다" 고정)
- [ ] `src/pipeline/compose/ffmpeg.ts`: 영상 장면 5초·1080×1920·30fps 로 맞춤, 이미지 장면 천천히 확대·이동,
      내레이션 길이에 맞춰 이미지 장면 길이 조정, 장면 연결, 음량 정규화(약 -14 LUFS), 자막 입히기
- [ ] `src/pipeline/steps/compose.ts`: 합성 → 결과 검사(해상도·길이·오디오) → Blob 저장 → `video_review`
- [ ] 워크플로에 ffmpeg·한글 폰트(OFL 라이선스) 설치
- [ ] `approve-script` 가 렌더 → 합성까지 이어서 실행. `retry`(compose) 는 크레딧 없이 재합성

확인
- 자막·ffmpeg 인자 단위 테스트 + **CI 에서 테스트 패턴 영상으로 실제 합성** 후 해상도·길이 검사
- **merge 후**: `retry`(compose) → Summary 의 영상 링크를 휴대폰에서 재생해 자막·고지·음량 확인

배포 영향: 없음.

### PR ⑥ feat: 유튜브 비공개 업로드

**목적**: 승인된 영상을 메타데이터와 함께 비공개로 올린다.

작업
- [ ] `src/pipeline/youtube/`: 리프레시 토큰 → 액세스 토큰, resumable upload
- [ ] 메타데이터: 제목, 설명(요약 + 출처 링크 + 고지), 태그(#shorts 포함), `privacyStatus=private`,
      아동용 아님, AI 합성 공개 표시(`needs_ai_disclosure` 일 때)
- [ ] `approve-video`: `video_review` → `ready` → 업로드 → `uploaded`, `uploads`·`youtube_video_id` 기록
- [ ] `scripts/youtube-auth.mjs`: 사용자가 내 PC 에서 한 번 실행해 리프레시 토큰을 받는 도우미
- [ ] Summary: YouTube Studio 링크

확인
- 가짜 응답으로 토큰 갱신·업로드 요청·메타데이터 길이 테스트
- **merge 후**: YouTube 시크릿 3종 등록 → `approve-video` → Studio 에서 비공개 영상 확인

배포 영향: 새 시크릿 `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN`.

### PR ⑦ docs: 운영 가이드와 MVP 완료 기록

작업
- [ ] `docs/runbook.md`: 버튼별 사용법, 실패 시 `retry`, 크레딧 확인법, 시크릿 목록
- [ ] PDRN 실측(크레딧·소요 시간·품질 이슈)을 `docs/plan.md`·`docs/decisions.md` 에 반영
- [ ] 2단계로 넘길 항목 정리

**MVP 완료 확인**: 새 주제 1개를 `new` → `approve-script` → `approve-video` 세 번의 실행만으로
비공개 업로드까지 보낸다.

---

## 사용자가 준비할 것 (필요해지는 순서)

키는 채팅에 붙여 넣지 않고 **GitHub → Settings → Secrets and variables → Actions** 에 직접 넣는다.

- [ ] `MANYMOTIONS_API_KEY` — manymotions.com dashboard/api-keys (`cw_live_…`) · PR ② merge 후
- [ ] `ANTHROPIC_API_KEY` — console.anthropic.com (Claude 구독과 별도 결제) · PR ③ merge 후.
      리포지토리 생성 때 복사되지 않은 시크릿이다.
- [ ] 고정 목소리 1개 결정 · PR ② 의 `probe` 결과를 보고
- [ ] `BLOB_READ_WRITE_TOKEN` — Vercel 대시보드 → shorts-workflow → Storage → Blob 스토어 생성·연결 →
      토큰을 GitHub Secrets 에도 등록 · PR ④ merge 후
- [ ] YouTube 3종 · PR ⑥ merge 후
  - Google Cloud 프로젝트 → YouTube Data API v3 사용 설정 → OAuth 동의 화면 → OAuth 클라이언트(데스크톱 앱)
  - **OAuth 동의 화면 게시 상태를 "프로덕션"으로**. "테스트"면 리프레시 토큰이 7일 뒤 만료된다
    (본인 계정이라 "확인되지 않은 앱" 경고는 "계속"으로 넘어가면 된다)
  - `scripts/youtube-auth.mjs` 를 내 PC 에서 실행해 리프레시 토큰 발급
- 이미 있음: `DATABASE_URL`, Vercel·Neon 연결

## 이번 단계에서 하지 않는 것

- 2단계: 대시보드(입력·승인·미리보기), 상태 기반 자동 실행, 화·금 예약 업로드, 구글 API 감사 신청
- 3단계: 자동 재시도, 장면 단위 재생성 버튼(장면당 최대 2회), 알림
- 4단계: YouTube Analytics 반영
- 예외: 비용 사고를 막는 **월 크레딧 한도 사전 검사**는 PR ④ 에 간단히 넣는다.

## 확인이 필요한 가정

1. MVP 승인은 Actions 버튼으로 한다(대시보드는 2단계).
2. ManyMotions 의 정확한 model_id·목소리 목록·응답 형식은 이 세션에서 문서에 접속할 수 없어
   PR ② 의 `probe` 결과로 확정한다. 크레딧 수치도 그때 다시 확인한다.
3. 실제 실행 크레딧: PR ④ 확인에 약 331, PR ⑦ 확인에 약 331 (재생성 시 편당 약 435).
