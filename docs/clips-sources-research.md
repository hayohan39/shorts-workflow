# 추가 무료 영상 소스 리서치

> 2026-11-01 작성, 11-02 갱신(Pexels 신규 키 발급 중단). 연동한 소스: Pixabay · NASA · Wikimedia Commons · Internet Archive.
> 보류: 공유마당(명세 확인 필요, 아래), Coverr(유료), Pexels(신규 키 발급 중단).
> 기준: ① 공식 API 가 있는가(스크래핑 금지) ② 상업적 이용·편집이 되는 라이선스인가 ③ 키·한도·비용 ④ 쇼츠(세로·실사)에 쓸 만한 영상이 많은가.
> 아래 수치는 검색으로 확인한 것이라, 연동하는 PR 에서 실제 응답·약관으로 다시 확인한다.

## 추천 순위

| 순위 | 소스 | 키 / 한도 | 라이선스 | 판단 |
| --- | --- | --- | --- | --- |
| — | ~~Pexels Videos API~~ | **신규 키 발급 중단**(2026-11 공식 API 페이지 "New API key issuance is currently paused") | Pexels License | 품질은 가장 좋지만 지금은 키를 받을 수 없다. 어댑터는 `claude/clips-pexels` 브랜치(#31, 닫음)에 남겨 두었다. 발급이 다시 열리면 키만 넣고 다시 연다 |
| 1 | **공유마당(한국저작권위원회)** | 무료 키, 신청 즉시 발급. XML 응답 | 저작물마다 다름: 공공누리 제1유형·CC0·CC BY·CC BY-SA 만 사용(공공누리 2~4유형·NC·ND 는 제외, license.ts 가 이미 판정) | 한국 주제(지역·문화·공공기관 영상)에 강하다. 공공누리 제1유형은 출처(기관명·URL 등) 표시 필수 → 출처 표기로 채운다. 요청 명세는 키 발급 후 확인 필요 |
| 2 | **Europeana Search API** | 무료 키 | `reusability=open` 으로 PD·CC0·CC BY·CC BY-SA 만 걸러 받을 수 있음 | 유럽 기관의 기록 영상이라 역사·문화 주제에 좋다. 영상 비율과 API 의 영상 필터는 첫 응답으로 확인 필요 |
| 3 | **Library of Congress (loc.gov JSON API)** | 키 없음, 한도 있음(미공개) | 항목마다 권리 표기가 다름(초기 영화는 퍼블릭 도메인이 많음) | 키 없이 바로 된다. 권리 표기가 명확한 항목만 받는 보수적 판정이 필요하다 |
| 4 | **National Archives Catalog API v2** | 키 없이 조회 가능, 키는 메일로 무료 발급. 키당 월 10,000회 | 미국 연방 정부 기록은 대부분 퍼블릭 도메인(항목별 확인) | 기록 영상이 많다. API 로 영상 파일 주소를 받을 수 있는지는 확인 필요 |
| 5 | **DVIDS (미 국방부 공개 미디어)** | 무료 키(가입) | 미국 정부 저작물이라 대체로 퍼블릭 도메인이지만 약관 확인 필요. NASA 처럼 외부 크레딧은 빼야 함 | 항공·우주·재난 대응 영상이 많다. 주제가 맞을 때만 가치가 있다 |
| 6 | Smithsonian Open Access | api.data.gov 무료 키 | CC0 | 대부분 이미지라 영상은 적을 것으로 보인다. 낮은 우선순위 |

## 제외

| 소스 | 이유 |
| --- | --- |
| Flickr | CC 영상은 있지만 API 를 상업적 목적으로 쓰려면 Flickr 승인이 필요하다(유료일 수 있음) |
| Coverr | 운영에서 API 를 쓰려면 유료 구독(이미 보류 결정) |
| Mixkit · Videvo · Videezy 등 | 공개 API 가 없다. 사이트 수집(스크래핑)은 약관 위반 소지가 있어 하지 않는다 |
| Unsplash · Openverse | 이미지·오디오만 있고 영상이 없다 |

## 제안

- 다음 연동은 **공유마당**을 추천한다(무료 키, 한국 주제). 키 발급 → GitHub Secrets `GONGU_API_KEY`,
  그리고 세션 네트워크에 `gongu.copyright.or.kr` 를 허용해 API 명세를 확인한 뒤 만든다.
- Pexels 는 키 발급이 다시 열리면 #31 을 다시 연다.
- Europeana·LoC·NARA 는 역사 주제 영상을 자주 만들게 되면 검토한다(실사 B-roll 용도로는 Pexels·Pixabay 가 낫다).

## 참고

- Pexels API(신규 키 발급 중단 공지): https://www.pexels.com/api/
- 공유마당 API 연계: https://gongu.copyright.or.kr/gongu/useReqst/apiKey/info.do?menuNo=200245
- 공공누리 유형: https://www.kogl.or.kr/info/license.do
- Europeana `reusability`: https://pro.europeana.eu/page/apis
- loc.gov JSON API: https://libraryofcongress.github.io/data-exploration/
- NARA Catalog API: https://www.archives.gov/research/catalog/help/api-getting-started
- DVIDS API: https://api.dvidshub.net/docs
- Smithsonian Open Access: https://www.si.edu/openaccess
- Flickr API 약관: https://www.flickr.com/services/api/tos/
