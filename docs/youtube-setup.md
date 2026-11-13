# 유튜브 업로드 설정

> 2026-11-13. 대시보드의 **유튜브에 업로드 (비공개)** 버튼이 쓰는 키 3개를 준비하는 방법.
> 키는 GitHub Secrets 에만 넣는다(Vercel 에는 넣지 않는다). 채팅·문서에 붙여 넣지 않는다.

## 먼저 알아 둘 것: 감사 전에는 "비공개로 잠김"

- 2020-07-28 이후에 만든 Google Cloud 프로젝트는 **YouTube API 감사(audit)를 통과하기 전까지** API 로 올린 영상이
  **비공개로 잠긴다.** YouTube Studio 에서도 공개로 바꿀 수 없고, 이의 제기도 안 된다(공개하려면 다시 올려야 한다).
- 그래서 지금 버튼은 **비공개 업로드**만 한다. 업로드 결과를 Studio 에서 확인하는 용도로 쓰고,
  공개할 영상은 대시보드에서 완성 영상을 내려받아 YouTube 앱·사이트에서 직접 올린다.
- 공개 업로드까지 자동으로 하려면 **YouTube API Services 감사 신청**이 필요하다(아래 "감사 신청").
- 비용: 무료. 하루 업로드 한도는 프로젝트당 기본 약 100회(2026-06 부터 업로드 전용 한도).

## 1. Google Cloud 준비 (한 번, PC 권장)

1. https://console.cloud.google.com 에서 업로드할 채널의 구글 계정으로 새 프로젝트를 만든다(예: `shorts-workflow`).
2. **API 및 서비스 → 라이브러리** → "YouTube Data API v3" → **사용**.
3. **API 및 서비스 → OAuth 동의 화면**(Google Auth Platform)
   - 사용자 유형 **외부**, 앱 이름·지원 이메일 입력
   - 범위는 비워 둬도 된다(토큰 발급 때 `youtube.upload` 를 요청한다)
   - **게시 상태를 "프로덕션"(In production)으로** 바꾼다. "테스트" 로 두면 리프레시 토큰이 **7일 뒤 만료**된다.
     본인만 쓰는 앱이라 "확인되지 않은 앱" 경고가 나와도 그대로 쓸 수 있다.
4. **사용자 인증 정보 → 사용자 인증 정보 만들기 → OAuth 클라이언트 ID**
   - 아래 2단계에서 A 방법이면 유형 **데스크톱 앱**, B 방법이면 **웹 애플리케이션**
   - 만든 뒤 나오는 **클라이언트 ID**·**클라이언트 보안 비밀번호**를 따로 적어 둔다.

## 2. 리프레시 토큰 발급 (둘 중 하나)

### A. 내 PC 에서 도우미 실행 (Node 필요)

```bash
node scripts/youtube-auth.mjs
```

- 저장소가 없으면 `scripts/youtube-auth.mjs` 파일 하나만 내려받아 실행해도 된다(다른 패키지 필요 없음).
- 클라이언트 ID·보안 비밀번호를 물어보면 입력 → 나오는 주소를 브라우저에서 열고 채널 계정으로 로그인·허용
  ("확인되지 않은 앱" 이 나오면 **고급 → (앱 이름)(으)로 이동**) → 터미널에 리프레시 토큰이 나온다.

### B. 브라우저만으로 (OAuth 2.0 Playground)

1. 1-4 의 OAuth 클라이언트를 **웹 애플리케이션**으로 만들고, **승인된 리디렉션 URI** 에
   `https://developers.google.com/oauthplayground` 를 넣는다.
2. https://developers.google.com/oauthplayground 를 열고 오른쪽 위 톱니바퀴 →
   **Use your own OAuth credentials** 체크 → 클라이언트 ID·보안 비밀번호 입력.
3. 왼쪽 Step 1 입력칸에 `https://www.googleapis.com/auth/youtube.upload` 를 넣고 **Authorize APIs** →
   채널 계정으로 로그인·허용.
4. Step 2 에서 **Exchange authorization code for tokens** → 나오는 **Refresh token** 을 복사.

## 3. GitHub Secrets 에 넣기

GitHub → `shorts-workflow` → Settings → Secrets and variables → Actions → New repository secret

| 이름 | 값 |
| --- | --- |
| `YOUTUBE_CLIENT_ID` | 클라이언트 ID |
| `YOUTUBE_CLIENT_SECRET` | 클라이언트 보안 비밀번호 |
| `YOUTUBE_REFRESH_TOKEN` | 2단계에서 받은 리프레시 토큰 |

## 4. 써 보기

영상 승인까지 끝난 에피소드(상태 "업로드 대기") → **유튜브에 업로드 (비공개)** → 끝나면 화면에 나오는
**YouTube Studio 에서 열기** 로 확인한다.

- 실패하면 화면에 이유가 나온다. "인증 실패 … invalid_grant" 면 리프레시 토큰이 만료·취소된 것이다:
  동의 화면이 "프로덕션" 인지 확인하고 2단계를 다시 한다.

## 업로드되는 내용

- 제목: 대본 제목(100자까지)
- 설명: 대본 설명(요약·근거 출처·고지) + 무료 클립 출처 표기 + 해시태그(#shorts …)
- 태그: 해시태그에서 # 를 뺀 것, 카테고리: 교육, 언어: 한국어, 아동용 아님
- **변경되었거나 합성된 콘텐츠(AI) 표시**: AI 로 만든 장면이 하나라도 있으면 켠다(무료 클립만으로 채운 영상은 끈다)
- 공개 상태: 비공개

## 감사 신청 (공개 업로드를 원할 때)

- "YouTube API Services - Audit and Quota Extension Form" 으로 신청한다. 앱 설명, 사용 화면, 개인정보 처리방침 등을 요구한다.
- 통과하면 이후 업로드는 공개·예약 공개가 가능해진다(이미 잠긴 영상은 다시 올려야 한다).
- 신청이 필요해지면 Claude 에게 요청하면 제출용 설명과 화면 캡처 목록을 준비한다.
