"use server";

import { refresh } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { createDispatcher, createWorkflowDispatcher, dispatchAvailability } from "@/lib/github";
import { SESSION_COOKIE } from "@/lib/session";
import { createEpisode, decide, getEpisode } from "@/pipeline/episodes";
import { latestScript, NOTE_MAX, saveEditedScript, setReviewerNote } from "@/pipeline/scripts";
import { failProbe, requestProbe } from "@/pipeline/probe";
import { updateSettings } from "@/pipeline/settings";
import { isBusy, isStep, TransitionError } from "@/pipeline/status";
import { triggerStep } from "@/pipeline/trigger";

export async function logoutAction(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

export type NewEpisodeState = { error?: string; topic?: string; outline?: string };

/** 새 에피소드를 만들고 바로 대본 생성을 시작한다(프로덕션에서만). */
export async function createEpisodeAction(_prev: NewEpisodeState, formData: FormData): Promise<NewEpisodeState> {
  await requireSession();
  const topic = String(formData.get("topic") ?? "");
  const outline = String(formData.get("outline") ?? "");

  let id: number;
  try {
    id = (await createEpisode({ topic, outline })).id;
  } catch (error) {
    if (error instanceof RangeError) return { error: error.message, topic, outline };
    throw error;
  }
  if (dispatchAvailability().ok) {
    await triggerStep(id, "script", createDispatcher());
  }
  redirect(`/episodes/${id}`);
}

export type RunStepState = { error?: string };

/** 에피소드 화면의 "실행" · "다시 시도" 버튼. */
export async function runStepAction(_prev: RunStepState, formData: FormData): Promise<RunStepState> {
  await requireSession();
  const id = Number(formData.get("id"));
  const step = formData.get("step");
  if (!Number.isInteger(id) || id <= 0 || !isStep(step)) return { error: "잘못된 요청입니다." };

  const availability = dispatchAvailability();
  if (!availability.ok) return { error: availability.reason };
  try {
    await triggerStep(id, step, createDispatcher());
  } catch (error) {
    // 다른 탭에서 이미 시작했거나 상태가 바뀐 경우. 화면을 새로 고쳐 최신 상태를 보여 준다.
    if (error instanceof TransitionError) {
      refresh();
      return { error: error.message };
    }
    throw error;
  }
  refresh();
  return {};
}

export type SimpleState = { error?: string; saved?: boolean };

/** 설정 화면의 "모델 조회". */
export async function requestProbeAction(): Promise<SimpleState> {
  await requireSession();
  const availability = dispatchAvailability();
  if (!availability.ok) return { error: availability.reason };
  const probe = await requestProbe();
  if (!probe) {
    refresh();
    return { error: "이미 조회 중입니다. 잠시 후 결과가 표시됩니다." };
  }
  try {
    await createWorkflowDispatcher()({ step: "probe", episode_id: "" });
  } catch (error) {
    await failProbe(error instanceof Error ? error.message : String(error), probe.id);
  }
  refresh();
  return {};
}

export async function saveSettingsAction(_prev: SimpleState, formData: FormData): Promise<SimpleState> {
  await requireSession();
  const field = (name: string) => String(formData.get(name) ?? "");
  try {
    await updateSettings({
      videoModel: field("videoModel"),
      imageModel: field("imageModel"),
      voiceModel: field("voiceModel"),
      voice: field("voice"),
      monthlyCreditLimit: field("monthlyCreditLimit"),
      scriptModel: field("scriptModel"),
    });
  } catch (error) {
    if (error instanceof RangeError) return { error: error.message };
    throw error;
  }
  refresh();
  return { saved: true };
}

function episodeId(formData: FormData): number | null {
  const id = Number(formData.get("id"));
  return Number.isInteger(id) && id > 0 ? id : null;
}

function note(formData: FormData): string {
  return String(formData.get("note") ?? "").trim().slice(0, NOTE_MAX);
}

/** 대본 승인(메모 선택). 승인한 대본 버전에 메모를 남긴다. */
export async function approveScriptAction(_prev: SimpleState, formData: FormData): Promise<SimpleState> {
  await requireSession();
  const id = episodeId(formData);
  const script = id ? await latestScript(id) : null;
  if (!id || !script) return { error: "대본을 찾을 수 없습니다." };
  try {
    await decide(id, "approve-script");
  } catch (error) {
    refresh();
    if (error instanceof TransitionError) return { error: error.message };
    throw error;
  }
  await setReviewerNote(script.id, note(formData) || null);
  refresh();
  return {};
}

/** 대본 반려: 메모(필수)를 남기고 메모를 반영한 새 대본 생성을 시작한다. */
export async function rejectScriptAction(_prev: SimpleState, formData: FormData): Promise<SimpleState> {
  await requireSession();
  const id = episodeId(formData);
  const text = note(formData);
  if (!text) return { error: "무엇을 고쳐야 하는지 메모를 남겨 주세요. 다음 대본에 반영됩니다." };
  const script = id ? await latestScript(id) : null;
  if (!id || !script) return { error: "대본을 찾을 수 없습니다." };
  try {
    await decide(id, "reject-script");
  } catch (error) {
    refresh();
    if (error instanceof TransitionError) return { error: error.message };
    throw error;
  }
  await setReviewerNote(script.id, text);
  if (dispatchAvailability().ok) await triggerStep(id, "script", createDispatcher());
  refresh();
  return {};
}

/** 대본 직접 수정: 내레이션·제목·설명란·해시태그를 고친 새 버전을 저장한다(승인은 따로). */
export async function editScriptAction(_prev: SimpleState, formData: FormData): Promise<SimpleState> {
  await requireSession();
  const id = episodeId(formData);
  const [episode, script] = id ? await Promise.all([getEpisode(id), latestScript(id)]) : [null, null];
  if (!id || !episode || !script) return { error: "대본을 찾을 수 없습니다." };
  if (episode.status !== "script_review" || isBusy(episode)) {
    refresh();
    return { error: "대본 검토 중일 때만 수정할 수 있습니다." };
  }
  try {
    await saveEditedScript(script, {
      narrations: script.scenes.map((scene) => String(formData.get(`narration_${scene.no}`) ?? "")),
      title: String(formData.get("title") ?? ""),
      description: String(formData.get("description") ?? ""),
      tags: String(formData.get("tags") ?? ""),
    });
  } catch (error) {
    if (error instanceof RangeError) return { error: error.message };
    throw error;
  }
  refresh();
  return { saved: true };
}
