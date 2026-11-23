-- 채널마다 다른 대본 지침·고지 문구. 지금까지는 피부·화장품 채널용 문구가 모든 편에 들어갔다.
--   description_footer : 유튜브 설명란 끝에 붙이는 문구(라쿤씨: 의학적 조언 아님 고지)
--   video_notice       : 영상 위쪽에 계속 띄우는 짧은 고지(라쿤씨: ※ 의학적 조언이 아닙니다). 비우면 띄우지 않는다.
alter table channels
  add column description_footer text not null default '' check (length(description_footer) <= 300),
  add column video_notice text not null default '' check (length(video_notice) <= 30);

update channels set
  description_footer = '※ 이 영상은 정보 제공용이며 의학적 조언이 아닙니다. 피부·건강 문제는 전문의와 상담하세요.',
  video_notice = '※ 의학적 조언이 아닙니다'
where slug = 'raccoon';

-- 대본 지침(채널 설정에서 고친다, prompts 에 버전으로). 공통 형식·근거 규칙은 코드의 시스템 프롬프트에 있다.
insert into prompts (key, version, body) values
  ('script:raccoon', 1,
   '건강·화장품 성분을 근거 중심으로 설명하는 페이스리스 정보 채널이다.
- 근거는 논문·임상시험·규제기관(식약처, FDA 등) 자료에서 찾는다.
- 의약품으로 오인될 표현(치료, 재생, 질병 개선 등)을 화장품 효과처럼 쓰지 않는다(식약처 화장품 표시·광고 관리 지침). 의약품 연구를 인용할 때는 의약품 연구라는 점을 분명히 한다.
- 내레이터를 의사·전문가로 소개하거나 전문가 행세를 시키지 않는다. 특정 제품을 추천하지 않는다.'),
  ('script:saesae', 1,
   '새(조류)에 관한 재밌는 지식을 전하는 채널 "새새 열매"다. 정보 + 귀여움 + 소소한 웃음.
- 반드시 새 이야기만 한다. 화면에 나오는 새와 다른 종의 이야기를 하지 않는다. 종 이름은 정확히 쓴다.
- 사실은 조류 도감·연구·자연 단체(Cornell Lab of Ornithology, Audubon, 국립생물자원관 등) 자료로 확인한다.
- 의인화·말장난은 재미로 쓰되, 사실과 상상이 구분되게 말한다. 새를 괴롭히거나 위험하게 다루는 장면을 권하지 않는다.'),
  ('ideas:saesae', 1,
   '채널 "새새 열매": 새(조류)에 관한 재밌는 지식. 정보 + 귀여움 + 소소한 웃음. 반드시 새 이야기만.
예: "귀여운 새의 귀여운 습관", "용맹한 새의 용맹한 모먼트", "엉뚱한 새의 엉뚱한 행동".');
