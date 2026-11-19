# Shorts Workflow 개인정보처리방침 (Privacy Policy)

> 시행일: 2026-11-19

Shorts Workflow 는 저장소 주인 한 명이 자기 YouTube 채널에 쇼츠를 올리려고 쓰는 개인용 도구입니다.
다른 사람에게 서비스하지 않으며, 다른 사용자의 계정으로 로그인하지 않습니다.

## 접근하는 Google 사용자 데이터

| 권한(범위) | 쓰는 곳 |
| --- | --- |
| `youtube.upload` | 대시보드에서 승인한 영상을 주인의 채널에 올린다(제목·설명·태그·공개 상태 포함) |
| `youtube.readonly` | 토큰을 발급할 때, 그 토큰이 올릴 채널의 이름·ID 를 한 번 보여 준다 |

그 밖의 YouTube·Google 데이터(구독자, 시청 기록, 댓글, 이메일 등)는 읽지 않습니다.

## 저장과 보관

- OAuth 리프레시 토큰과 클라이언트 정보는 이 저장소의 GitHub Actions 비밀값(Secrets)에만 암호화되어 저장됩니다.
- 업로드 결과로 받은 영상 ID·링크·공개 상태만 이 도구의 데이터베이스에 남깁니다.
- 위 데이터를 제3자에게 팔거나 공유하지 않고, 광고·분석·AI 모델 학습에 쓰지 않습니다.

## Google API 서비스 사용자 데이터 정책 준수

Shorts Workflow 가 Google API 로 받은 정보의 사용과 다른 앱으로의 전송은
[Google API 서비스 사용자 데이터 정책](https://developers.google.com/terms/api-services-user-data-policy)과
그 제한적 사용(Limited Use) 요건을 따릅니다. YouTube API 를 쓰므로
[YouTube 서비스 약관](https://www.youtube.com/t/terms)과 [Google 개인정보처리방침](https://policies.google.com/privacy)도 적용됩니다.

## 권한 철회와 삭제

- [Google 계정 → 보안 → 서드 파티 연결](https://myaccount.google.com/connections)에서 Shorts Workflow 의 접근 권한을 언제든 없앨 수 있습니다.
  철회하면 저장된 리프레시 토큰은 더 이상 쓸 수 없습니다.
- GitHub Secrets 의 `YOUTUBE_*` 값을 지우면 저장된 토큰도 삭제됩니다.

## 문의

이 저장소의 [Issues](https://github.com/hayohan39/shorts-workflow/issues) 로 문의할 수 있습니다.

---

**English summary.** Shorts Workflow is a personal tool used only by the repository owner to upload their own videos to their own
YouTube channel. It requests `youtube.upload` (to upload approved videos) and `youtube.readonly` (to show the channel name once when
issuing the token). Tokens are stored only as encrypted GitHub Actions secrets; only the resulting video ID, link and privacy status are
stored. No Google user data is sold, shared, used for advertising, or used to train AI models. Use of information received from Google
APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements. Access can be revoked at
https://myaccount.google.com/connections. Contact: https://github.com/hayohan39/shorts-workflow/issues
