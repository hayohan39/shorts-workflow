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

- 고정 내레이션 목소리 (ManyMotions `probe` 결과를 보고 결정)
- PDRN 첫 편 실측 크레딧에 따른 장면 구성(영상/이미지 비율) 조정

---

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
