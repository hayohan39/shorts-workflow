-- provider_probes.models 는 예전 형식이라 더 쓰지 않는다(선택지는 listings 에서 매번 계산한다).
alter table provider_probes drop column models;
