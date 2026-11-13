# 1단계(MVP) 구현 계획 — 대시보드 중심

> 기준: [docs/plan.md](plan.md) "8. 일정" 의 1단계.
> **변경(2026-10-11)**: 사용자 요청으로 대본 생성·승인, 영상 확인·승인, 유튜브 업로드를 **전부 대시보드에서** 한다.
> 원래 2단계에 있던 대시보드를 1단계로 당겨 왔으므로 기간은 1주 → 약 1.5주로 본다.
>
> **완료 기준: 대시보드에서 주제 1개를 입력하고 승인 버튼 두 번 + 업로드 버튼 한 번으로
> 유튜브 비공개 업로드까지 도달한다.**

## 구조

```
 [대시보드 · Vercel]  ── 비밀번호 로그인 ──  나(휴대폰/PC)
   │ 입력·승인·업로드 버튼 → DB 상태 변경 + GitHub Actions 실행 요청
   ▼
 [Neon DB]  episodes · scripts · assets · uploads · settings
   ▲
   │ 결과 기록(상태·대본·장면·크레딧·영상 URL)
 [GitHub Actions · pipeline.yml]  대본 생성 · 장면/음성 생성 · ffmpeg 합성 · 유튜브 업로드
   │
   ├─ Claude API (대본·근거 검색)
   ├─ ManyMotions API (영상·이미지·음성)
   ├─ Vercel Blob (장면·완성 영상 저장 → 대시보드에서 재생)
   └─ YouTube Data API (비공개 업로드)
```

- 오래 걸리는 작업(생성·ffmpeg·업로드)은 Actions 에서, 화면과 버튼은 Vercel 에서. (Vercel 함수는 실행 시간
  제한이 있고 ffmpeg 를 쓰기 어렵다.)
- 대시보드 버튼은 DB 상태를 바꾸고 **GitHub API 로 `pipeline.yml` 을 바로 실행**한다(아래 "결정 필요" 1).
- Actions 화면은 몰라도 된다. 진행 상황·실패 사유는 대시보드에 표시한다.

## 대시보드 화면

| 화면 | 하는 일 | 버튼 |
| --- | --- | --- |
| 로그인 | 비밀번호 1개로 로그인 | 로그인 |
| 에피소드 목록 | 상태별 목록, 이번 달 크레딧 사용량 / 한도 | **새 에피소드** |
| 새 에피소드 | 주제·목차 입력 | **대본 생성** |
| 에피소드 상세 · 대본 | 근거·출처, 내레이션, 장면 4개(프롬프트·자막), 제목·설명·태그, 금지 표현 경고 | **승인** · **수정 후 승인**(직접 고치기) · **반려**(메모 → 재생성) |
| 에피소드 상세 · 진행 | 단계별 진행 상태, 장면별 미리보기·크레딧, 실패 사유 | **다시 시도**(실패 단계부터) |
| 에피소드 상세 · 영상 | 완성 영상 재생(휴대폰 세로), 메타데이터 최종 확인 | **영상 승인** · **다시 합성**(크레딧 0) |
| 에피소드 상세 · 업로드 | 업로드 결과, YouTube Studio 링크 | **유튜브에 업로드**(비공개) |
| 설정 | ManyMotions 모델 조회 결과, 목소리·모델 선택, 월 크레딧 한도 | **모델 조회** · 저장 |

상태 흐름 (상태가 단계 사이의 유일한 연결고리. 각 단계는 시작할 때 상태를 확인한다):

```
queued ─[대본]─► script_review ─승인─► approved ─[장면·음성]─► rendering ─[합성]─► video_review
       ─영상 승인─► ready ─업로드 버튼─[업로드]─► uploaded
어느 단계든 실패 ─► failed (error 표시) ─다시 시도─► 그 단계부터
```

---

## PR 순서 한눈에 보기

| PR | 제목 | 선행 | 새 설정값 (어디에) | merge 후 직접 확인할 것 | 크레딧 |
| --- | --- | --- | --- | --- | --- |
| #1 | docs: 기획서와 MVP 계획 (이 PR) | — | — | 계획 확인 | 0 |
| ① | feat: DB 스키마와 파이프라인 실행 틀 | #1 | — | (화면 없음) CI 통과 | 0 |
| ② | feat: 대시보드 로그인과 에피소드 목록·생성 | ① | `DASHBOARD_PASSWORD`, `SESSION_SECRET`, `GITHUB_DISPATCH_TOKEN` (Vercel) | 로그인 → 새 에피소드 → 목록에 표시, Actions 실행됨 | 0 |
| ③ | feat: ManyMotions 연결과 설정 화면 | ② | `MANYMOTIONS_API_KEY` (GitHub) | 설정 → **모델 조회** → 모델·목소리 선택 | 0 |
| ④ | feat: 대본 생성과 대본 검토 화면 | ② | `ANTHROPIC_API_KEY` (GitHub) | PDRN 입력 → 대본 검토 → 승인/수정/반려 | 0 (API 소액) |
| ⑤ | feat: 장면·음성 생성과 진행 화면 | ③④ | `BLOB_READ_WRITE_TOKEN` (Vercel + GitHub) | 대본 승인 → 장면 4개·음성 미리보기 | 약 331 |
| ⑥ | feat: ffmpeg 합성과 영상 검토 화면 | ⑤ | — | **다시 합성** → 영상 재생 → 영상 승인 | 0 |
| ⑦ | feat: 유튜브 비공개 업로드 | ⑥ | `YOUTUBE_*` 3종 (GitHub) | **유튜브에 업로드** → Studio 링크 확인 | 0 |
| ⑧ | docs: 운영 가이드와 MVP 완료 기록 | ⑦ | — | 새 주제 1편을 대시보드로만 끝까지 | 약 331 |

- PR 은 위 순서대로 하나씩 올린다. 다음 PR 은 앞 PR 이 merge 된 main 에서 시작한다
  (③과 ④는 서로 독립이라 리뷰 순서를 바꿔도 된다).
- 각 PR 은 `npm run check` 통과, DB 변경 시 로컬 마이그레이션 확인, CI 초록불 후 리뷰를 요청한다.
  화면이 바뀌는 PR 은 **PR 프리뷰 링크에서 화면을 먼저 볼 수 있다**.
- 테스트는 가짜 응답을 쓴다. **크레딧이 나가는 실제 실행은 사용자가 대시보드 버튼을 누를 때만** 일어난다.

### 예상 일정 (merge·키 준비가 바로 된다는 가정)

| 일차 | PR | 직접 준비할 것 |
| --- | --- | --- |
| 1 | #1, ① | ManyMotions·Anthropic 키 발급 |
| 2 | ② | 대시보드 비밀번호·GitHub 토큰 등록 (Vercel) |
| 3 | ③, ④ | 키 2개 등록 (GitHub) → 모델 조회, 첫 대본 |
| 4~5 | ⑤ | Vercel Blob 스토어 연결, 목소리 결정 |
| 6~7 | ⑥ | — |
| 8 | ⑦ | Google Cloud OAuth 설정, 리프레시 토큰 발급 |
| 9~10 | ⑧ + 실제 실행 | 영상 검토·승인·업로드 |

---

## PR 별 상세

### PR ① feat: DB 스키마와 파이프라인 실행 틀

**목적**: 대시보드와 Actions 가 함께 쓰는 데이터 구조와 실행 틀. 화면·외부 API 없음.

작업
- [ ] 마이그레이션: `episodes`, `scripts`, `assets`, `uploads`, `settings` (브리프 4장 컬럼 + `updated_at`)
  - `episodes.status` 는 허용 값만 들어가도록 CHECK 제약, 실행 중인 단계 표시용 `step`, `run_url`
  - `settings` 기본값: 월 크레딧 한도 4,000, 업로드 요일 화·금
- [ ] `src/pipeline/status.ts`: 상태 목록과 허용 전이 표 (버튼별 허용 상태 포함)
- [ ] `src/pipeline/episodes.ts`: 생성·조회·목록, 상태 전이(기대 상태가 아니면 거부), 실패 기록
- [ ] `src/pipeline/cli.ts` + `npm run pipeline -- <step> --episode <id>`: Actions 진입점
- [ ] `.github/workflows/pipeline.yml`: `workflow_dispatch`(입력: step, episode_id), 같은 에피소드 동시 실행 방지,
      실행 시작·실패를 DB 에 기록. 이 PR 에서는 단계 구현 없이 상태만 기록하는 빈 단계

확인
- 상태 전이 단위 테스트, DB 테스트(로컬·CI Postgres), 로컬 `npm run migrate`

배포 영향: 새 테이블 5개(기존 데이터 없음, 삭제 없음).

### PR ② feat: 대시보드 로그인과 에피소드 목록·생성

**목적**: 대시보드의 뼈대. 로그인하고, 에피소드를 만들고, 그 순간 Actions 가 실행되는 것까지.

작업
- [ ] 로그인: 비밀번호 1개(`DASHBOARD_PASSWORD`) 비교 → `SESSION_SECRET` 으로 서명한 httpOnly 쿠키(30일)
  - `src/proxy.ts`(Next 16 의 미들웨어)로 로그인 화면 외 모든 페이지·쓰기 요청 보호
  - 시간 일정 비교, 실패 시 지연. 로그아웃 버튼
- [ ] 에피소드 목록(상태 배지, 갱신 시각, 이번 달 크레딧) / 새 에피소드(주제·목차) / 상세 화면 틀
- [ ] `src/lib/github.ts`: `GITHUB_DISPATCH_TOKEN` 으로 `pipeline.yml` 실행 요청(REST). 실패하면 화면에 오류 표시
- [ ] 진행 중 에피소드는 화면이 몇 초마다 자동 새로고침
- [ ] 휴대폰 세로 화면 기준 레이아웃, 문구는 한국어

확인
- 로그인·쿠키 서명·보호 경로 테스트, 프리뷰에서 화면 확인
- **merge 후**: Vercel 환경변수 3개 등록 → 로그인 → 새 에피소드 → 목록에 `queued` → Actions 실행 기록 확인

배포 영향: 새 Vercel 환경변수 `DASHBOARD_PASSWORD`, `SESSION_SECRET`, `GITHUB_DISPATCH_TOKEN`.
값이 없으면 대시보드가 "설정 필요" 오류를 보여 준다(공개되지 않음).

### PR ③ feat: ManyMotions 연결과 설정 화면

**목적**: 영상·이미지·음성 호출을 한 곳(어댑터)에 모으고, 실제 model_id·목소리를 조회해 설정한다.

작업
- [x] `src/pipeline/providers/mcp.ts`: MCP 클라이언트(Streamable HTTP, JSON-RPC: `initialize` · `tools/list` · `tools/call`, SSE 응답·세션 ID 처리)
- [x] `src/pipeline/providers/manymotions.ts`: `https://manymotions.com/api/mcp` 에 `Authorization: Bearer` 로 연결
- [x] `src/pipeline/providers/poll.ts`: 작업 완료까지 폴링(간격 점점 늘림, 전체 타임아웃)
- [x] `probe` 단계: `tools/list`(도구별 **입력 형식** 포함)와, 인자 없이 부를 수 있는 `list_*` 도구의 응답을 그대로 DB 에 저장.
      응답에서 모델·목소리 ID 를 뽑아 선택지로 쓴다(크레딧을 쓰는 도구는 부르지 않음)
- [x] 설정 화면: **모델 조회** 버튼, 영상/이미지/음성 모델과 목소리(조회 결과에서 고름, 목록에 없는 값은 경고), 월 크레딧 한도
- 변경: 생성 호출(`media_forge_generate`, `job_status`)과 `MediaProvider` 구현은 ⑤로 옮겼다. 문서를 이 세션에서 열 수 없어서,
  조회로 받은 도구 입력 형식을 보고 맞춰 쓰기 위해서다(추측 금지). REST 전용 엔드포인트(seedance-2, nano-banana)는
  사용 예정 모델이 아니라서 쓰지 않는다.

확인
- 가짜 응답으로 요청 형식·폴링 완료/실패/타임아웃 테스트
- **merge 후**: `MANYMOTIONS_API_KEY` 등록(GitHub) → 설정 → 모델 조회 → **목소리 1개 결정** 후 저장

배포 영향: 새 GitHub 시크릿 `MANYMOTIONS_API_KEY`. API 키는 Actions 에만 있고 Vercel 에는 넣지 않는다.

### PR ④ feat: 대본 생성과 대본 검토 화면

**목적**: 주제·목차 → 근거 조사 → 대본. 첫 번째 사람 승인 관문을 대시보드에.

작업
- [x] `src/pipeline/script/schema.ts`: 대본 형식과 검증(오류 = 다음 단계가 깨지는 문제, 경고 = 사람이 판단할 문제).
      설명란은 요약 + **근거의 출처 링크** + 고지로 코드가 조립하고, 해시태그는 #shorts 를 맨 앞에 붙인다
- [x] 대본 생성 프롬프트(`script/prompt.ts`): 브리프 7장 가드레일 + 질문형 훅, 장면 프롬프트 글자 금지,
      **최근 편의 훅·장면 구성을 넣어 겹치지 않게**, 반려 메모와 이전 내레이션 반영
- [x] Claude API(`script/generate.ts`): 웹 검색·웹 페이지 읽기로 근거를 찾고 `submit_script` 도구(strict 스키마)로 제출.
      형식 오류·길이 이탈은 Claude 에게 돌려보내 고치게 하고, 거절되면 서버 측 대체 모델로 다시 시도(`fallbacks: "default"`)
- [x] 금지 표현 검사(`script/guardrails.ts` + `forbidden-expressions.ts`): 화면에 경고만(자동 반려 안 함)
- [x] 대본 검토 화면: 경고, 장면별 내레이션·생성 프롬프트, 근거 수준과 출처 링크, 제목·해시태그·설명란, AI 공개 표시, 토큰·검색 횟수
  - **대본 승인**(메모 선택) → `approved`. 장면 생성 버튼은 ⑤에서 생긴다
  - **직접 수정**: 내레이션·제목·설명란·해시태그를 고쳐 새 버전으로 저장(검사 다시 실행) → 확인 후 승인
  - **반려하고 다시 생성**: 메모(필수)를 반영해 새 버전 생성
- [x] 설정 화면에 대본 모델(기본 `claude-haiku-5-5`, 2026-10-12 변경)

확인
- 스키마 검증·금지 표현 검사·수정 저장 테스트, 가짜 Claude 응답으로 단계 전체 테스트
- **merge 후**: `ANTHROPIC_API_KEY` 등록(GitHub) → 새 에피소드에 PDRN 목차 → 대본 검토 → 승인/수정/반려

배포 영향: 새 GitHub 시크릿 `ANTHROPIC_API_KEY`.

### PR ⑤ feat: 장면·음성 생성과 진행 화면

**목적**: 승인된 대본으로 장면 4개와 내레이션을 만든다. 처음으로 크레딧이 나가는 단계.

작업
- [ ] `src/pipeline/steps/render.ts`: `approved` → `rendering`
  - 영상 2·이미지 2·내레이션 1 을 병렬 요청, `assets` 에 작업 ID·상태·크레딧 기록
  - 결과 파일을 Vercel Blob 에 복사(공급자 URL 은 만료될 수 있음), `episodes.credits_used` 합산
- [ ] **월 크레딧 한도 사전 검사**: 이번 달 사용량 + 이번 편 예상치 > 한도면 시작하지 않고 화면에 사유 표시
- [ ] 일부 장면 실패 시: 성공한 장면은 남기고 `failed`. **다시 시도**는 못 만든 장면만 다시 요청
- [ ] 대본 승인 버튼이 이 단계를 바로 실행
- [ ] 진행 화면: 장면별 상태·크레딧·미리보기(영상·이미지 재생, 음성 재생)

확인
- 가짜 provider 로 성공·부분 실패·한도 초과 테스트
- **merge 후**: Blob 스토어 연결 → ④에서 만든 대본 **승인** → 장면·음성 확인, **실제 크레딧 실측**
  (브리프 0단계의 실측을 여기서 한다)

배포 영향: `BLOB_READ_WRITE_TOKEN` (Vercel 에 자동 추가됨 → GitHub 시크릿에도 등록). Blob 무료 한도 내 예상.

### PR ⑥ feat: ffmpeg 합성과 영상 검토 화면

**목적**: 장면·음성·자막을 합쳐 MP4 를 만들고, 두 번째 사람 승인 관문을 대시보드에.

작업
- [ ] `src/pipeline/compose/ass.ts`: 대본 → ASS 자막(문장 단위, 글자 수 비율 × 실제 음성 길이로 타이밍,
      숫자·연도 강조, 하단 "의학적 조언이 아닙니다" 고정)
- [ ] `src/pipeline/compose/ffmpeg.ts`: 영상 장면 5초·1080×1920·30fps, 이미지 장면 천천히 확대·이동,
      내레이션 길이에 맞춰 이미지 장면 길이 조정, 장면 연결, 음량 정규화(약 -14 LUFS), 자막 입히기
- [ ] `src/pipeline/steps/compose.ts`: 합성 → 결과 검사(해상도·길이·오디오) → Blob 저장 → `video_review`
- [ ] 워크플로에 ffmpeg·한글 폰트(OFL 라이선스) 설치. 장면 생성이 끝나면 합성이 이어서 실행
- [ ] 영상 검토 화면: 세로 영상 플레이어, 제목·설명·태그 최종 확인
  - **영상 승인** → `ready`
  - **다시 합성**: 크레딧 없이 자막·모션만 다시 (장면 재생성은 3단계)

확인
- 자막·ffmpeg 인자 단위 테스트 + **CI 에서 테스트 패턴 영상으로 실제 합성** 후 해상도·길이 검사
- **merge 후**: ⑤의 에피소드에서 **다시 합성** → 휴대폰에서 재생해 자막·고지·음량 확인 → 영상 승인

배포 영향: 없음.

### PR ⑦ feat: 유튜브 비공개 업로드

> **2026-10-16 보류 → 2026-11-13 구현**(업로드 버튼 방식, 사용자 결정). 감사 전에는 영상이 "비공개로 잠김" 이라
> Studio 에서 공개로 바꿀 수 없다는 점을 확인해 안내 문구를 고쳤다(`docs/youtube-setup.md`).

**목적**: 승인된 영상을 대시보드 버튼으로 비공개 업로드.

작업
- [ ] `src/pipeline/youtube/`: 리프레시 토큰 → 액세스 토큰, resumable upload
- [ ] 메타데이터: 제목, 설명(요약 + 출처 링크 + 고지), 태그(#shorts 포함), `privacyStatus=private`,
      아동용 아님, AI 합성 공개 표시(`needs_ai_disclosure` 일 때)
- [ ] `ready` 에피소드의 **유튜브에 업로드** 버튼 → 업로드 단계 → `uploaded`, `uploads`·`youtube_video_id` 기록
- [ ] 업로드 화면: YouTube Studio 링크, "감사 전이라 비공개 — Studio 에서 공개로 바꾸세요" 안내
- [ ] `scripts/youtube-auth.mjs`: 사용자가 내 PC 에서 한 번 실행해 리프레시 토큰을 받는 도우미

확인
- 가짜 응답으로 토큰 갱신·업로드 요청·메타데이터 길이 테스트
- **merge 후**: YouTube 시크릿 3종 등록(GitHub) → **유튜브에 업로드** → Studio 에서 비공개 영상 확인

배포 영향: 새 GitHub 시크릿 `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN`.

### PR ⑧ docs: 운영 가이드와 MVP 완료 기록

작업
- [ ] `docs/runbook.md`: 화면별 사용법, 실패 시 다시 시도, 크레딧 확인, 설정값 목록과 위치
- [ ] PDRN 실측(크레딧·소요 시간·품질 이슈)을 `docs/plan.md`·`docs/decisions.md` 에 반영
- [ ] 2단계로 넘길 항목 정리

**MVP 완료 확인**: 새 주제 1개를 대시보드에서 입력 → 대본 승인 → 영상 승인 → 업로드 버튼만으로
비공개 업로드까지 보낸다.

---

## 사용자가 준비할 것 (필요해지는 순서)

키는 채팅에 붙여 넣지 않는다. **어디에 넣는지가 두 곳으로 나뉜다**: 화면(Vercel)이 쓰는 값은 Vercel 환경변수,
생성 작업(Actions)이 쓰는 값은 GitHub Secrets.

| 언제 | 이름 | 어디에 | 발급처 |
| --- | --- | --- | --- |
| ② 후 | `DASHBOARD_PASSWORD` | Vercel (Production·Preview) | 직접 정한 긴 비밀번호 |
| ② 후 | `SESSION_SECRET` | Vercel (Production·Preview) | 임의의 32자 이상 문자열 (예: `openssl rand -hex 32`) |
| ② 후 | `GITHUB_DISPATCH_TOKEN` | Vercel (**Production 만**) | GitHub → Settings → Developer settings → Fine-grained token: 저장소 `shorts-workflow` 만, 권한 **Actions: Read and write** |
| ③ 후 | `MANYMOTIONS_API_KEY` | GitHub Secrets | manymotions.com dashboard/api-keys (`cw_live_…`) |
| ④ 후 | `ANTHROPIC_API_KEY` | GitHub Secrets | console.anthropic.com (Claude 구독과 별도 결제). 리포지토리 생성 때 복사되지 않음 |
| ⑤ 전 | `BLOB_READ_WRITE_TOKEN` | Vercel(자동) + GitHub Secrets | Vercel → shorts-workflow → Storage → Blob 스토어 생성·연결 |
| ⑦ 후 | `YOUTUBE_CLIENT_ID` / `_SECRET` / `_REFRESH_TOKEN` | GitHub Secrets | 아래 참고 |

- 목소리 1개 결정: ③ 의 모델 조회 결과를 보고 설정 화면에서 선택
- YouTube: Google Cloud 프로젝트 → YouTube Data API v3 사용 설정 → OAuth 동의 화면 → OAuth 클라이언트(데스크톱 앱).
  **동의 화면 게시 상태를 "프로덕션"으로** 둔다("테스트"면 리프레시 토큰이 7일 뒤 만료). 본인 계정이라
  "확인되지 않은 앱" 경고는 "계속"으로 넘어가면 된다. 그 다음 `scripts/youtube-auth.mjs` 로 토큰 발급.
- 이미 있음: `DATABASE_URL`(Vercel·GitHub 모두), Vercel·Neon 연결
- `GITHUB_DISPATCH_TOKEN` 을 Preview 에 넣지 않는 이유: PR 프리뷰는 복제 DB 를 쓰는데 Actions 는 프로덕션 DB 를 본다.
  프리뷰에서 실행하면 엉뚱한 에피소드가 처리된다. 코드도 프로덕션(`VERCEL_ENV=production`)이 아니면 실행 요청을 보내지 않는다.

## 결정된 사항

1. **대시보드 → Actions 실행 방식**: GitHub fine-grained 토큰(`GITHUB_DISPATCH_TOKEN`)으로 버튼을 누르는 즉시 실행
   (확정: 무료, 즉시 실행, 이 저장소의 Actions 권한만). 대안인 "Actions 가 몇 분마다 DB 를 확인"은 토큰이
   필요 없지만 최대 5분 이상 지연되고, 5분마다 실행하면 월 약 8,600회라 비공개 저장소의 무료 Actions 시간(월 2,000분)을 넘긴다.
2. 대시보드 로그인은 **비밀번호 1개**로 확정(2026-10-11, 사용자 선택).

## 이번 단계에서 하지 않는 것 (2단계 이후)

- 화·금 예약 업로드(cron) — MVP 는 업로드 버튼을 누르면 바로 올라간다
- 구글 API 감사 신청 (공개 업로드)
- 자동 재시도, 장면 단위 재생성(장면당 최대 2회), 완료·실패 알림 (3단계)
- YouTube Analytics 반영 (4단계)
- 예외: 비용 사고를 막는 **월 크레딧 한도 사전 검사**는 ⑤ 에 넣는다.

## 확인이 필요한 가정

1. ManyMotions 의 정확한 model_id·목소리 목록·응답 형식은 이 세션에서 문서에 접속할 수 없어
   ③ 의 모델 조회 결과로 확정한다. 크레딧 수치도 그때 다시 확인한다.
2. 장면·완성 영상은 Vercel Blob 에 추측하기 어려운 URL 로 저장한다. 대시보드는 비밀번호로 막지만,
   URL 자체를 아는 사람은 파일을 볼 수 있다(비공개 업로드 전 영상이라 위험은 낮다고 판단).
   비공개 Blob 지원 여부는 ⑤ 구현 때 확인해 가능하면 쓴다.
3. 실제 실행 크레딧: ⑤ 확인에 약 331, ⑧ 확인에 약 331 (재생성 시 편당 약 435).
