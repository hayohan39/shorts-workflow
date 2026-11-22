-- 사진 소재(iNaturalist·Pixabay·Wikimedia 사진). 사진은 합성 때 천천히 확대·이동해 영상처럼 쓴다.
alter table clip_candidates add column media text not null default 'video' check (media in ('video', 'image'));

-- 상업적 이용·편집이 되는 라이선스만 저장한다(코드의 COMMERCIAL_LICENSES 와 같은 목록).
-- 비영리(NC)·변경금지(ND)·저작권 보유(All rights reserved)는 저장 자체가 안 된다.
alter table clip_candidates
  add constraint clip_candidates_license_check
  check (license_code in ('pixabay', 'nasa', 'pd', 'cc0', 'cc-by', 'cc-by-sa'));
