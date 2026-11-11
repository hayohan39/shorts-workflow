# 연결된 API 정리

> 2026-11-11 기준(main, #30 까지). 키는 모두 GitHub Secrets(Actions) 또는 Vercel 환경변수에 있고, 저장소에는 없다.
> 결정 기록은 [decisions.md](decisions.md), 영상 소스 자세한 내용은 [clips-plan.md](clips-plan.md).

## 1. 영상 제작 (유료)

| 서비스 | 앱에서 하는 일 | 대시보드에서 고르는 것 | 비용 | 키 |
| --- | --- | --- | --- | --- |
| **Claude API** (Anthropic) | ① 대본 생성(웹 검색으로 근거 조사) ② 영상 소스 검색 키워드 | 설정 → 대본 모델: Haiku 5.5(기본) · Sonnet · Opus. 키워드는 Haiku 고정 | 대본 1회 수 센트, 키워드 1회 < $0.001 | `ANTHROPIC_API_KEY` (GitHub) |
| **ManyMotions** | ① 장면 영상 ② 장면 이미지 ③ 내레이션(ElevenLabs 목소리) | 설정 → 영상·이미지·음성 모델(목록 자동 조회). 에피소드 → 목소리 11종, 음성 모델 eleven_v3 · multilingual_v2 | 추천 모델 기준 영상 장면 105, 이미지 23, 내레이션 약 80크레딧. 월 한도는 설정에서 | `MANYMOTIONS_API_KEY` (GitHub) |

- 추천(기본) 모델: 영상 Kling 3.0 Standard · 이미지 Seedream 4.5 · 음성 ElevenLabs v3 (`src/pipeline/recommended.ts`).
- 잔여 크레딧·모델 목록은 매일 03:17 KST 자동 조회, 설정 화면에서 새로 고칠 수 있다.

## 2. 무료 영상 소스 (영상 소스 화면 → [수집])

| 소스 | 영상 성격 | 라이선스 | 키 |
| --- | --- | --- | --- |
| **Pixabay** | 일반 스톡 실사(세로 포함) | Pixabay Content License | `PIXABAY_API_KEY` (GitHub) |
| **NASA** | 우주·지구·로켓 | 저작권 없음(외부 촬영자 표기 항목 제외) | 없음 |
| **Wikimedia Commons** | 자연·도시·기록 | CC0 · PD · CC BY · CC BY-SA | 없음 |
| **Internet Archive** | 기록 영상·옛 필름 | CC0 · PD · CC BY · CC BY-SA(업로더 표기 기준) | 없음 |

- 흐름: [수집] → 60~120초 분량 추천 → [교체] → [채택](mp4 변환 후 Blob 저장) → 에피소드 장면에 넣기(그 장면은 크레딧 0).
- 출처 표기 자동 생성, CC BY-SA 가 섞이면 경고. 매일 자동 수집은 기본 꺼짐(영상 소스 화면에서 켜고 태그 등록).
- 제외: 공유마당, Coverr(유료). 보류: Pexels(신규 키 발급 중단 — 다시 열리면 #31 을 다시 연다).

## 3. 운영용 연결

| 연결 | 용도 | 키·설정 |
| --- | --- | --- |
| **Vercel Blob** | 장면·내레이션·완성 영상·채택 클립 저장(Hobby 무료 1GB) | `BLOB_READ_WRITE_TOKEN` (GitHub) |
| **Neon Postgres** | DB | `DATABASE_URL` (Vercel·GitHub), `NEON_API_KEY` (프리뷰 DB 복제, GitHub) |
| **GitHub Actions** | 대시보드 버튼 → 작업 실행(workflow_dispatch) | `GITHUB_DISPATCH_TOKEN` (Vercel) |
| **Anthropic Admin API** | 이번 달 Claude 실제 청구 비용(선택) | `ANTHROPIC_ADMIN_KEY` (GitHub) |
| **Vercel 배포 · Claude 리뷰** | merge 후 배포, PR 리뷰·자동 수정 | `VERCEL_TOKEN` 등, `CLAUDE_CODE_OAUTH_TOKEN` (GitHub) |
| 대시보드 로그인 | 비밀번호 1개 + 서명 쿠키 | `DASHBOARD_PASSWORD`, `SESSION_SECRET` (Vercel) |

## 아직 없는 것

- **유튜브 업로드**(보류된 ⑦): Google Cloud OAuth → `YOUTUBE_CLIENT_ID` · `YOUTUBE_CLIENT_SECRET` · `YOUTUBE_REFRESH_TOKEN`.
  그동안은 완성 영상을 내려받아 직접 올린다(설명란 미리보기에 출처 표기 포함).
