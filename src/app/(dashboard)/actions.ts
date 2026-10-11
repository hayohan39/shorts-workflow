"use server";

import { refresh } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { createDispatcher, createWorkflowDispatcher, dispatchAvailability } from "@/lib/github";
import { SESSION_COOKIE } from "@/lib/session";
import { createEpisode } from "@/pipeline/episodes";
import { failProbe, requestProbe } from "@/pipeline/probe";
import { updateSettings } from "@/pipeline/settings";
import { isStep, TransitionError } from "@/pipeline/status";
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
    });
  } catch (error) {
    if (error instanceof RangeError) return { error: error.message };
    throw error;
  }
  refresh();
  return { saved: true };
}
