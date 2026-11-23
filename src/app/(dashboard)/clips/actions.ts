"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { createDispatcher, createWorkflowDispatcher, dispatchAvailability } from "@/lib/github";
import { fillSceneWithClip, removeSceneClip } from "@/pipeline/clips/episode";
import { pickCount, savePicks } from "@/pipeline/clips/picks";
import { getChannel } from "@/pipeline/channels";
import { createEpisode, getEpisode, setOutline } from "@/pipeline/episodes";
import { TransitionError } from "@/pipeline/status";
import { triggerStep } from "@/pipeline/trigger";
import {
  addTag,
  createSearchCollection,
  deleteTag,
  failAdopt,
  failCollection,
  requestAdopt,
  requeueCollection,
  setDailyEnabled,
  setTagActive,
  swapClip,
  TOPIC_MAX,
} from "@/pipeline/clips/store";

export type ClipActionState = { error?: string; topic?: string };

function positiveId(value: FormDataEntryValue | null): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function dispatchClips(step: "clips" | "clips-adopt", id: number): Promise<string | null> {
  try {
    await createWorkflowDispatcher()({ step, collection_id: String(id) });
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** 실패했거나 멈춘 수집을 다시 실행한다. */
export async function retryCollectAction(_prev: ClipActionState, formData: FormData): Promise<ClipActionState> {
  await requireSession();
  const id = positiveId(formData.get("id"));
  if (!id) return { error: "잘못된 요청입니다." };
  const availability = dispatchAvailability();
  if (!availability.ok) return { error: availability.reason };
  if (!(await requeueCollection(id))) {
    refresh();
    return { error: "이미 진행 중이거나 끝난 수집입니다." };
  }
  const failure = await dispatchClips("clips", id);
  if (failure) await failCollection(id, failure);
  refresh();
  return {};
}

/** [교체]: 선택된 클립을 교체 후보로 바꾼다(소스 API 를 다시 부르지 않는다). */
export async function swapClipAction(_prev: ClipActionState, formData: FormData): Promise<ClipActionState> {
  await requireSession();
  const id = positiveId(formData.get("id"));
  const selected = positiveId(formData.get("selected"));
  const alternate = positiveId(formData.get("alternate"));
  if (!id || !selected || !alternate) return { error: "잘못된 요청입니다." };
  try {
    await swapClip(id, selected, alternate);
  } catch (error) {
    refresh();
    if (error instanceof RangeError) return { error: error.message };
    throw error;
  }
  refresh();
  return {};
}

/** [채택]: 선택된 클립을 내려받아 mp4 로 바꾼 뒤 Blob 에 저장한다(Actions). */
export async function adoptClipsAction(_prev: ClipActionState, formData: FormData): Promise<ClipActionState> {
  await requireSession();
  const id = positiveId(formData.get("id"));
  if (!id) return { error: "잘못된 요청입니다." };
  const availability = dispatchAvailability();
  if (!availability.ok) return { error: availability.reason };
  if (!(await requestAdopt(id))) {
    refresh();
    return { error: "수집이 끝나지 않았거나 이미 채택 중입니다." };
  }
  const failure = await dispatchClips("clips-adopt", id);
  if (failure) await failAdopt(id, failure);
  refresh();
  return {};
}

/** 매일 자동 수집 켜기/끄기. 켜면 매일 Claude Haiku 1회(< $0.001)가 쓰인다(2026-10-16 승인). */
export async function setDailyAction(_prev: ClipActionState, formData: FormData): Promise<ClipActionState> {
  await requireSession();
  await setDailyEnabled(formData.get("enabled") === "1");
  refresh();
  return {};
}

export async function addTagAction(_prev: ClipActionState, formData: FormData): Promise<ClipActionState> {
  await requireSession();
  try {
    await addTag(String(formData.get("name") ?? ""));
  } catch (error) {
    if (error instanceof RangeError) return { error: error.message };
    throw error;
  }
  refresh();
  return {};
}

export async function setTagActiveAction(_prev: ClipActionState, formData: FormData): Promise<ClipActionState> {
  await requireSession();
  const id = positiveId(formData.get("id"));
  if (!id) return { error: "잘못된 요청입니다." };
  await setTagActive(id, formData.get("active") === "1");
  refresh();
  return {};
}

export async function deleteTagAction(_prev: ClipActionState, formData: FormData): Promise<ClipActionState> {
  await requireSession();
  const id = positiveId(formData.get("id"));
  if (!id) return { error: "잘못된 요청입니다." };
  await deleteTag(id);
  refresh();
  return {};
}

/** 에피소드 장면을 채택한 클립으로 채운다(크레딧 없음). */
export async function fillSceneAction(_prev: ClipActionState, formData: FormData): Promise<ClipActionState> {
  await requireSession();
  const id = positiveId(formData.get("id"));
  const sceneNo = positiveId(formData.get("scene"));
  const clipId = positiveId(formData.get("clip"));
  const episode = id ? await getEpisode(id) : null;
  if (!episode || !sceneNo || !clipId) return { error: "잘못된 요청입니다." };
  try {
    await fillSceneWithClip(episode, sceneNo, clipId);
  } catch (error) {
    refresh();
    if (error instanceof RangeError) return { error: error.message };
    throw error;
  }
  refresh();
  return {};
}

export async function removeSceneClipAction(_prev: ClipActionState, formData: FormData): Promise<ClipActionState> {
  await requireSession();
  const id = positiveId(formData.get("id"));
  const assetId = positiveId(formData.get("asset"));
  const episode = id ? await getEpisode(id) : null;
  if (!episode || !assetId) return { error: "잘못된 요청입니다." };
  try {
    await removeSceneClip(episode, assetId);
  } catch (error) {
    refresh();
    if (error instanceof RangeError) return { error: error.message };
    throw error;
  }
  refresh();
  return {};
}

// ── 편집형(clips 길) ─────────────────────────────────────────

export type ClipsEpisodeState = { error?: string; topic?: string; related?: string; targetSeconds?: number };

/** 편집형: 에피소드를 만들고 주제·연관 단어로 무료 영상을 찾는다(Claude Haiku 키워드 1회, 누르는 것이 확인). */
export async function createClipsEpisodeAction(_prev: ClipsEpisodeState, formData: FormData): Promise<ClipsEpisodeState> {
  await requireSession();
  const topic = String(formData.get("topic") ?? "");
  const related = String(formData.get("related") ?? "");
  const targetSeconds = Number(formData.get("targetSeconds"));
  // 에피소드를 만들기 전에 수집 쪽 길이 제한을 먼저 본다(에피소드만 남지 않게).
  const kept = { topic, related, targetSeconds };
  if (topic.trim().length > TOPIC_MAX) return { error: `주제는 ${TOPIC_MAX}자 이내로 입력하세요.`, ...kept };
  if (related.trim().length > TOPIC_MAX) return { error: `연관 단어는 ${TOPIC_MAX}자 이내로 입력하세요.`, ...kept };
  const channel = await getChannel(String(formData.get("channel") ?? ""));
  if (!channel) return { error: "채널을 찾을 수 없습니다.", ...kept };
  if (channel.route === "music") return { error: "음악형 채널은 음원으로 에피소드를 만듭니다.", ...kept };

  let episodeId: number;
  let collectionId: number;
  try {
    episodeId = (await createEpisode({ topic, outline: "", route: "clips", channel: channel.slug, targetSeconds })).id;
    collectionId = (await createSearchCollection(topic, { related, episodeId })).id;
  } catch (error) {
    if (error instanceof RangeError) return { error: error.message, ...kept };
    throw error;
  }
  // 실행할 수 없는 환경(프리뷰·로컬)이면 이유를 남겨 둔다. 화면에서 다시 시도할 수 있다.
  const availability = dispatchAvailability();
  const failure = availability.ok ? await dispatchClips("clips", collectionId) : availability.reason;
  if (failure) await failCollection(collectionId, failure);
  redirect(`/episodes/${episodeId}`);
}

export type PickState = { error?: string; concept?: string; outline?: string; scenes?: Record<string, string> };

/**
 * 소재 찾기 결과에서 장면마다 쓸 클립을 고르고 컨셉·목차를 적는다.
 * 고른 클립만 채택(내려받아 저장, 무료)하고 대본 생성을 시작한다(Claude 비용, 누르는 것이 확인).
 */
export async function pickClipsAction(_prev: PickState, formData: FormData): Promise<PickState> {
  await requireSession();
  const id = positiveId(formData.get("id"));
  const concept = String(formData.get("concept") ?? "").trim();
  const outline = String(formData.get("outline") ?? "").trim();
  const episode = id ? await getEpisode(id) : null;
  if (!episode) return { error: "에피소드를 찾을 수 없습니다." };
  const count = pickCount(episode);
  const scenes: Record<string, string> = {};
  const order: number[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("scene-") || !value) continue;
    scenes[key] = String(value);
    const sceneNo = Number(value);
    const clipId = positiveId(key.slice("scene-".length));
    if (!clipId || !Number.isInteger(sceneNo) || sceneNo < 1 || sceneNo > count) return { error: "잘못된 요청입니다." };
    if (order[sceneNo - 1]) return { error: `장면 ${sceneNo}에 클립이 두 개 골라졌습니다.`, concept, outline, scenes };
    order[sceneNo - 1] = clipId;
  }
  const kept = { concept, outline, scenes };
  const missing = Array.from({ length: count }, (_, i) => i + 1).filter((no) => !order[no - 1]);
  if (missing.length) return { error: `장면 ${missing.join(", ")}에 쓸 클립을 고르세요.`, ...kept };
  if (!concept && !outline) return { error: "영상 컨셉이나 목차를 적어 주세요.", ...kept };

  const availability = dispatchAvailability();
  if (!availability.ok) return { error: availability.reason, ...kept };

  let picks;
  try {
    picks = await savePicks(episode, order);
    await setOutline(episode.id, [concept && `컨셉: ${concept}`, outline].filter(Boolean).join("\n\n"));
  } catch (error) {
    refresh();
    if (error instanceof RangeError) return { error: error.message, ...kept };
    throw error;
  }

  // 고른 클립 중 아직 저장하지 않은 것만 채택한다(채택 중이면 그 실행이 이어서 받는다).
  if (picks.some((clip) => !clip.blobUrl) && (await requestAdopt(picks[0].collectionId))) {
    const failure = await dispatchClips("clips-adopt", picks[0].collectionId);
    if (failure) await failAdopt(picks[0].collectionId, failure);
  }
  try {
    await triggerStep(episode.id, "script", createDispatcher());
  } catch (error) {
    refresh();
    if (error instanceof TransitionError) return { error: error.message, ...kept };
    throw error;
  }
  refresh();
  return {};
}
