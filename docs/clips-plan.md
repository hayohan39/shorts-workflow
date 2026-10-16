# 무료 라이선스 영상 소스 수집 — 계획

> 2026-10-16 사용자 승인. 결정 기록은 [decisions.md](decisions.md) "무료 라이선스 영상 소스 수집".

## 무엇을

주제를 넣으면 무료 라이선스 영상 클립을 찾아 쇼츠 한 편 분량(60~120초)을 추천한다.
**채택**한 것만 내려받아 Blob 에 두고, 출처 표기 문구와 manifest(JSON)를 만든다.
나중에 에피소드 장면을 AI 생성 대신 이 클립으로 채운다(장면당 23~105크레딧 절약).

## 구조

```
대시보드 [수집] ─► Actions(pipeline.yml, step=clips)
                    한국어 주제 → Claude Haiku 로 영어 키워드 3~5개
                    → 소스별 search() → 라이선스 필터 → 선별 → DB
대시보드 [교체] ─► DB 의 교체 후보에서 고른다(API 다시 호출 안 함)
대시보드 [채택] ─► Actions: 다운로드 → ffmpeg 로 mp4(H.264) 변환 → Blob
매일 07:00 KST ─► 활성 태그 하나(최근 7일 안에 쓴 것 제외)로 같은 수집
```

키는 GitHub Secrets 에만 둔다(기존 방식). 키가 없는 소스는 자동으로 꺼지고 설정 화면에 표시한다.

## 코드 위치

| 파일 | 내용 |
| --- | --- |
| `src/pipeline/clips/types.ts` | `ClipCandidate`, `SourceAdapter { search(query, opts) }` |
| `src/pipeline/clips/license.ts` | CC·공공누리 판정. NC·ND·공공누리 2~4유형·불명확은 제외 |
| `src/pipeline/clips/select.ts` | 3~30초 클립, 합계 60~120초(90초에서 멈춤), 세로>정사각>가로, 중복 제거, 소스 번갈아 |
| `src/pipeline/clips/keywords.ts` | 주제 → 영어 키워드(Haiku 5.5, 구조화 출력, 1회 $0.001 미만) |
| `src/pipeline/clips/http.ts` | User-Agent, 429/503 Retry-After 백오프, 상태 기록 훅 |
| `src/pipeline/clips/sources/*.ts` | 소스별 어댑터(PR 마다 하나) |
| `migrations/*_create-clip-tables.sql` | 태그·수집·후보(라이선스 스냅샷)·소스 상태·응답 캐시 |

## 소스

공식 문서는 검색 발췌로만 확인했다(이 세션에서 도메인이 막혀 있음). 필드명은 첫 실제 응답으로 확인한다.

| 소스 | 키 | 한도 | 라이선스 | 주의 |
| --- | --- | --- | --- | --- |
| Pixabay | `PIXABAY_API_KEY`(무료) | 100회/분 | Pixabay Content License | 응답 24시간 캐시 필수, 핫링크 금지 → 채택 시 다운로드. 방향·길이 필터 없음 |
| NASA Image Library | 없음 | 미공개(초당 1회로 제한) | 저작권 없음 | 로고·보증 암시 금지, 외부 저작자 크레딧이 있으면 제외. 길이는 metadata.json 또는 ffprobe |
| Wikimedia Commons | 없음 | 미공개, 순차 호출·`maxlag=5` | CC0·PD·CC BY·CC BY-SA | 연락처 있는 User-Agent 필수. webm → 채택 때 변환 |
| Internet Archive | 없음 | 미공개, 지연 두고 호출 | `licenseurl` 이 PD·CC0·BY·BY-SA 인 것만(없으면 제외) | 업로더가 넣는 값이라 부정확할 수 있음 |
| 공유마당 | `GONGU_API_KEY`(즉시 발급) | 미확인 | 공공누리 제1유형·CC BY·CC BY-SA·CC0·만료 | XML, 영상 수 적음. 링크만 제공하는 "참고" |
| ~~Coverr~~ | — | 운영 사용은 유료 구독 | — | **보류**(사용자 결정) |

CC BY-SA 는 허용하되, 편집한 영상도 같은 조건으로 공개해야 한다는 해석이 있어 화면에 따로 표시한다.

## PR 순서

0. 기반(이 문서·타입·라이선스·선별·키워드·백오프·스키마)
1. Pixabay 어댑터
2. 기능 1: 주제 검색·결과 화면·교체·채택·출처 표기/manifest (Pixabay 만으로 먼저 써 본다)
3. NASA → 4. Wikimedia → 5. Internet Archive
6. 기능 2: 매일 07:00 자동 수집·태그 관리
7. 파이프라인 연동: 채택한 클립으로 장면 채우기(render 가 그 장면은 건너뜀), 출처 표기를 영상 검토·업로드 설명에
8. 공유마당(참고 링크)

## 비용

- 키워드 확장: 수집 1회당 Haiku 1회(< $0.001). 대시보드 [수집]은 누르는 것이 확인이다.
  매일 자동 수집(월 약 30회, 약 $0.03)은 2026-10-16 사용자가 승인했다.
- 소스 API 는 모두 무료. 채택한 클립만 Blob 에 저장한다(클립당 수~수십 MB).
