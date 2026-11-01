"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { createWorkflowDispatcher, dispatchAvailability } from "@/lib/github";
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

/** [수집]: 주제로 수집을 만들고 Actions 를 실행한다(Claude Haiku 키워드 1회, 누르는 것이 확인). */
export async function collectClipsAction(_prev: ClipActionState, formData: FormData): Promise<ClipActionState> {
  await requireSession();
  const topic = String(formData.get("topic") ?? "");
  const availability = dispatchAvailability();
  if (!availability.ok) return { error: availability.reason, topic };

  let id: number;
  try {
    id = (await createSearchCollection(topic)).id;
  } catch (error) {
    if (error instanceof RangeError) return { error: error.message, topic };
    throw error;
  }
  const failure = await dispatchClips("clips", id);
  if (failure) await failCollection(id, failure);
  redirect(`/clips/${id}`);
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
