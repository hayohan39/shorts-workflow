# 결정 기록

이 프로젝트에서 내린 기술·인프라 결정을 남긴다. Claude 와 세션에서 합의한 것도 여기에 적는다.
최신 항목이 위로 온다.

형식:

```
## YYYY-MM-DD 제목
- 결정:
- 이유:
- 검토한 대안:
- 영향: (새 환경변수, 비용, 되돌리는 법)
```

## 미결

- PDRN 첫 편 실측 크레딧에 따른 장면 구성(영상/이미지 비율) 조정
- 대본 생성에 Grok·Gemini 추가 여부 (아래 2026-10-12 "대본 모델 기본값" 참고. Haiku 5.5 결과를 본 뒤 결정)

---

## 2026-10-16 무료 라이선스 영상 소스 수집

- 결정: 주제 → 영어 키워드(Claude Haiku 5.5) → 공식 API 검색(Pixabay·NASA·Wikimedia Commons·Internet Archive,
  공유마당은 링크만) → 라이선스 필터 → 60~120초 분량 선별. 수집·채택은 GitHub Actions(pipeline.yml)에서 하고
  키는 GitHub Secrets 에만 둔다. 채택한 클립만 Blob 에 저장한다. 매일 07:00 KST 에 태그 하나로 자동 수집한다.
  허용 라이선스: 퍼블릭 도메인·CC0·CC BY·CC BY-SA·공공누리 제1유형·소스 자체 라이선스. NC·ND·불명확은 제외.
  계획: [clips-plan.md](clips-plan.md).
- 이유: 사용자 요청. 장면을 AI 생성 대신 실사 클립으로 채우면 크레딧이 줄고, 출처·라이선스를 수집 시점에 남겨 두면
  업로드 설명의 출처 표기를 자동으로 만들 수 있다.
- 검토한 대안: 수집을 Vercel 에서(빠르지만 키를 Vercel 에도 넣어야 하고 변환은 어차피 Actions), Coverr(운영 사용은
  유료 구독이라 보류), 공유마당 data.go.kr 데이터셋(태그 목록뿐이라 공유마당 자체 API 를 쓴다).
- 영향: GitHub 시크릿 `PIXABAY_API_KEY`(Pixabay PR 부터), `GONGU_API_KEY`(공유마당 PR). 매일 수집의 Claude 비용 월 약 $0.03.
  CC BY-SA 클립을 쓰면 영상도 같은 조건으로 공개해야 한다는 해석이 있어 화면에 표시한다.

## 2026-10-14 내레이션: ManyMotions 영상 편집 에이전트(ElevenLabs), 목소리는 편마다 선택

- 결정: 내레이션은 ManyMotions 영상 편집 에이전트(`video_editor_instruct`)에 ElevenLabs 목소리·모델(eleven_v3 /
  eleven_multilingual_v2)을 지정해 만든다. 목소리는 고정하지 않고 에피소드마다 대시보드에서 고르며, 다시 만들 수 있다.
  받은 음성은 바로 Vercel Blob(공개 스토어)으로 옮긴다(생성 서비스 주소는 임시).
- 근거(2026-10-14 시험): MCP 모델 목록(`list_models`)에는 음성이 없고, 에이전트로는 한국어 목소리 12개(이름·ID)를 받을 수 있고
  음성 생성이 된다. 1회 실측 80크레딧(지시 5 + 생성 75). API 로는 미리 듣기 주소가 없다(`preview_url` 전부 null).
  대시보드에 미리 듣기는 두지 않는다(샘플을 만들려면 크레딧이 들어서). 목소리는 ManyMotions·ElevenLabs 웹에서 들어 보고 고른다.
  목소리 목록 조회도 지시라 약 20크레딧이 들어 `src/pipeline/voices.ts` 에 고정했다.
- 검토한 대안: Google Cloud TTS(Chirp 3 HD, 사실상 무료, 결과가 일정하지만 새 GCP 키), ElevenLabs 직접(무료 플랜은 수익 채널 불가, 월 $5~6).
- 영향: GitHub 시크릿 `BLOB_READ_WRITE_TOKEN`. 내레이션은 편당 약 80크레딧, 다시 만들 때마다 같은 만큼.

## 2026-10-13 ManyMotions 잔여 크레딧 조회

- 결정: probe(Actions, 매일 + 수동)가 `GET https://manymotions.com/api/v1/account`(기존 `MANYMOTIONS_API_KEY`)로 잔여 크레딧을
  가져와 `provider_accounts` 에 저장하고 목록·설정 화면에 보여 준다. 문서(docs/api/endpoints)의 응답 필드
  `credits_remaining` · `credits_used_this_period` · `credits_total_this_period` 를 쓰고, 형태가 바뀌면 이름 규칙
  (remaining/available/balance/credits)으로 찾는다. 숫자 필드만 저장한다.
  생성 API 응답에도 `credits_consumed` · `credits_remaining` 이 오므로 ⑤에서 장면별 실제 차감액을 기록한다.
- 이유: 사용자 요청. MCP 도구에는 잔액 조회가 없고 REST 계정 API 에 있다(사용자가 문서 확인).
- 영향: 새 환경변수 없음. 문자열 필드(이메일 등)는 저장하지 않는다.

## 2026-10-12 Claude 실제 청구 비용 조회 (Usage & Cost Admin API)

- 결정: 매일 probe(Actions)가 Anthropic Cost API(`/v1/organizations/cost_report`, 일 단위, 설명별)로 최근 35일 실제
  청구 비용을 가져와 `api_costs` 에 저장하고, 목록·설정 화면에 대본 계산값과 나란히 보여 준다.
- 이유: 사용자 요청(추정이 아닌 실제 금액). Cost API 는 하루 단위·조직 단위라 편별 금액은 계속 응답 사용량으로 계산하고,
  실제 금액은 월·일 합계로 맞춰 본다.
- 검토한 대안: Usage API(1분 단위·API 키별 토큰 수) — 편별로 나눌 수 있지만 금액이 아니라 토큰이라 결국 단가표가 필요하다.
- 영향: GitHub 시크릿 `ANTHROPIC_ADMIN_KEY`(선택, 조직 계정의 Admin 키. 조직 관리 권한이 있어 probe 실행에만 넘김),
  선택 변수 `ANTHROPIC_COST_WORKSPACE_ID`. 키가 없으면 조회를 건너뛰고 화면에 연결 방법을 보여 준다.

## 2026-10-12 대본 모델 기본값 Haiku 5.5, 생성 모델 추천값

- 결정: 대본 모델 기본값을 Claude Haiku 5.5(`claude-haiku-5-5`, 입력 $0.10 / 출력 $0.50 per 1M 토큰)로 바꾼다.
  Haiku 5.5 는 동적 필터링 웹 도구(`_20260209`)와 서버 측 대체 모델을 지원하지 않아, 모델에 맞춰 기본형 웹 도구
  (`web_search_20250305` / `web_fetch_20250910`)로 요청하고 `fallbacks` 를 보내지 않는다(`modelProfile`).
  ManyMotions 영상·이미지·음성은 설정을 "자동"으로 두면 가성비 추천 모델을 쓴다: Kling 3.0 Standard(5초 105크레딧),
  Seedream 4.5(장당 23), ElevenLabs v3(1회 75) — 기획서 5장의 크레딧표 기준. 목록에 없으면 세로 9:16·5초를 지원하는 첫 모델.
- 이유: 사용자 요청(기본값을 정해 두고 가성비 우선). 조사 품질이 부족하면 설정에서 Sonnet 5.5 / Opus 5.5 로 바로 올릴 수 있다.
- 검토한 대안(대본 생성에 다른 공급자 추가, 2026-10 공개 자료 기준이라 숫자는 바뀔 수 있음):
  - Gemini Flash 계열 + Google 검색 그라운딩: 토큰 단가는 Haiku 5.5 보다 높고(입력 약 $0.75 / 출력 $3.75),
    검색은 월 무료 한도 뒤 1,000회당 약 $14. 장점은 구글 검색 품질.
  - Grok(xAI) + 웹 검색 도구: 대표 모델 입력 약 $2 / 출력 $6, 검색 1,000회당 약 $5. X(트위터) 검색이 강점이지만
    건강 정보 근거 조사에는 이점이 적다.
  - 공통 비용: 새 API 키(GitHub Secrets), 공급자별 어댑터·도구 형식 차이 처리, 비교 테스트.
  - 판단: 비용만 보면 Haiku 5.5 가 가장 싸서 추가 이점이 작다. Haiku 결과 품질을 먼저 보고, 부족하면 같은 주제로
    Gemini 를 비교 실행해 보는 순서를 제안한다(미결).
- 영향: 새 환경변수 없음. 이미 설정에서 모델을 골라 저장한 경우 그 값이 우선한다.
  대본 생성 비용은 응답마다 모델 단가표(`src/pipeline/script/pricing.ts`)로 계산해 진행 메모·검토 화면에 "약 $" 로 보여 준다
  (실제 청구액과 조금 다를 수 있음, 단가가 바뀌면 표를 고친다).

## 2026-10-12 모델 목록 자동 갱신과 드롭다운

- 결정: ManyMotions·Claude 모델 목록은 Actions(probe)가 매일 03:17 KST 에 자동으로 가져오고, 설정 화면을 열었을 때
  목록이 없거나 하루 넘게 지났으면 자동으로 한 번 더 가져온다. 설정 화면은 저장된 목록을 바로 드롭다운으로 보여 준다
  (대본 모델 / 영상 텍스트→영상 / 이미지 생성 / 음성).
- 이유: 사용자 요청(버튼을 눌러야 보이는 대신 항상 로드). API 키를 GitHub Secrets 한 곳에만 두는 구조를 유지한다.
- 검토한 대안: 설정 화면 서버가 직접 조회(항상 최신이지만 Vercel 에도 키 2개를 둬야 함).
- 영향: Actions 하루 1회 약 1분. 수동 "지금 새로 가져오기" 버튼은 남김.

## 2026-10-11 대본 생성 방식

- 결정: Claude Opus 5.5(`claude-opus-5-5`, 설정에서 변경 가능)로 effort high, 웹 검색·웹 페이지 읽기 도구로 근거를 찾고
  `submit_script` 도구(strict 스키마)로 대본을 제출받는다. 안전 분류기가 거절하면 서버 측 대체 모델로 다시 시도한다
  (`fallbacks: "default"`, 베타 `server-side-fallback-2026-07-01`).
- 이유: 건강·화장품 정보라 근거 조사의 정확도가 가장 중요하다. 구조화 출력(output_config.format)은 인용(citations)과 함께 쓰면 400 이 나서 웹 검색 결과의 인용과 충돌할 수 있고,
  그래서 도구 제출 방식을 택했다. 금지 표현은 문맥(예: "근거 없음"을 말하는 문장)에 따라 정상일 수 있어 자동 반려하지 않고 경고만 한다.
- 검토한 대안: Claude Sonnet 5.5(더 저렴, 조사 품질은 실제 결과를 보고 판단 — 설정에서 바로 바꿀 수 있음).
- 영향: GitHub 시크릿 `ANTHROPIC_API_KEY`. 편당 비용은 토큰과 웹 검색 횟수로 검토 화면에 표시된다.

## 2026-10-11 쇼츠 파이프라인 구성 (기획서 확정 사항)

- 결정: 생성·합성·업로드 작업은 GitHub Actions 에서 실행하고, Vercel 에는 입력·승인용 화면만 둔다.
  영상 생성은 ManyMotions API(Starter, 월 4,500크레딧), 대본은 Claude API(웹 검색),
  합성은 ffmpeg, 영상 파일은 Vercel Blob, 업로드는 YouTube Data API(초기 비공개).
- 이유: Vercel 함수는 실행 시간 제한이 있고 ffmpeg 를 쓰기 어렵다. 모델을 직접 호출하면 편당
  약 331크레딧으로 Starter 안에서 월 9편이 가능하다. 자세한 근거는 `docs/plan.md`.
- 검토한 대안: ManyMotions 앱의 장면당 자동 제작(장면당 250크레딧), 전 장면 Kling 3.0 Pro(편당 약 915크레딧),
  Media Studio 내보내기(비용 비공개).
- 영향: 시크릿 `MANYMOTIONS_API_KEY`, `ANTHROPIC_API_KEY`, `BLOB_READ_WRITE_TOKEN`,
  `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET` / `YOUTUBE_REFRESH_TOKEN` (GitHub Secrets).
  비용 약 $30~32/월. 공급자 호출은 어댑터 한 곳에 모아 교체할 수 있게 한다.

## 2026-10-11 대시보드에서 모든 작업 진행 (MVP 범위 변경)

- 결정: 대본 생성·승인, 영상 확인·승인, 유튜브 업로드를 1단계부터 Vercel 대시보드에서 한다.
  생성 작업은 그대로 GitHub Actions 에서 돌고, 대시보드 버튼이 GitHub API 로 `pipeline.yml` 을 실행한다.
- 이유: 사용자 요청. Actions 화면을 직접 다루지 않고 휴대폰에서 버튼만 누르기 위해서.
- 검토한 대안: Actions 수동 실행 버튼으로 승인(처음 계획, 화면이 불편), Actions 가 주기적으로 DB 확인
  (토큰 불필요하지만 지연이 크고 무료 Actions 시간 초과).
- 영향: 1단계 기간 약 1주 → 1.5주. Vercel 환경변수 `GITHUB_DISPATCH_TOKEN`(fine-grained, 이 저장소 Actions 쓰기만).

## 2026-10-11 대시보드 인증: 비밀번호 1개

- 결정: Vercel 환경변수 `DASHBOARD_PASSWORD` 로 로그인하고, `SESSION_SECRET` 으로 서명한 httpOnly 쿠키로 유지한다.
- 이유: 사용자 1명. 무료, 외부 서비스·라이브러리 없음, 설정 1분, 락인 없음.
- 검토한 대안: GitHub 로그인(Auth.js + OAuth 앱), Google 로그인 — 비밀번호 관리가 필요 없지만 설정과 의존성이 늘어남.
- 영향: Vercel 환경변수 `DASHBOARD_PASSWORD`, `SESSION_SECRET`. 비밀번호를 바꾸면 다시 로그인하면 된다.

## 2026-10-11 기본 스택

- 결정: Next.js(App Router) + TypeScript, Vercel 배포, Neon Postgres(`pg` + SQL 마이그레이션)
- 이유: project-bootstrap 템플릿의 고정 스택. 무료 한도 안에서 프로젝트를 계속 찍어낼 수 있다.
- 영향: merge = 프로덕션 배포. PR 마다 Neon 프리뷰 브랜치 + Vercel 프리뷰.
