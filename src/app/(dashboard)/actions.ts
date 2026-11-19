"use server";

import { refresh } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { createDispatcher, createWorkflowDispatcher, dispatchAvailability } from "@/lib/github";
import { SESSION_COOKIE } from "@/lib/session";
import { fillScenesFromPicks } from "@/pipeline/clips/picks";
import { createEpisode, decide, getEpisode, saveUpload, setUploadPlan, setVoiceSelection } from "@/pipeline/episodes";
import { latestScript, NOTE_MAX, saveEditedScript, setReviewerNote } from "@/pipeline/scripts";
import { failProbe, requestProbe } from "@/pipeline/probe";
import { updateSettings } from "@/pipeline/settings";
import { isBusy, isStep, TransitionError } from "@/pipeline/status";
import { triggerStep } from "@/pipeline/trigger";
import { findVoice, isVoiceModel } from "@/pipeline/voices";
import { parseVideoId } from "@/pipeline/youtube/links";

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
  let approved;
  try {
    approved = await decide(id, "approve-script");
  } catch (error) {
    refresh();
    if (error instanceof TransitionError) return { error: error.message };
    throw error;
  }
  await setReviewerNote(script.id, note(formData) || null);
  // 영상 먼저 찾기(clips 길): 고른 클립으로 장면을 채운다. 채택이 아직이면 채택이 끝날 때 채운다.
  await fillScenesFromPicks(approved).catch((error: unknown) => {
    console.warn(`장면 채우기 실패: ${error instanceof Error ? error.message : String(error)}`);
  });
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

/** 고른 목소리로 내레이션 생성을 시작한다(목소리를 바꿔 다시 만들 때도 같은 버튼). */
export async function narrationAction(_prev: RunStepState, formData: FormData): Promise<RunStepState> {
  await requireSession();
  const id = Number(formData.get("id"));
  const voice = findVoice(String(formData.get("voiceId") ?? ""));
  const model = formData.get("voiceModel");
  if (!Number.isInteger(id) || id <= 0 || !voice || !isVoiceModel(model)) return { error: "잘못된 요청입니다." };

  const availability = dispatchAvailability();
  if (!availability.ok) return { error: availability.reason };
  const episode = await getEpisode(id);
  if (!episode) return { error: "에피소드를 찾을 수 없습니다." };
  if (isBusy(episode)) return { error: "진행 중인 단계가 끝난 뒤에 다시 시도하세요." };

  await setVoiceSelection(id, voice.id, model);
  try {
    await triggerStep(id, "voice", createDispatcher());
  } catch (error) {
    if (error instanceof TransitionError) {
      refresh();
      return { error: error.message };
    }
    throw error;
  }
  refresh();
  return {};
}

/** 합성된 영상을 승인한다(영상 검토 → 업로드 대기). */
export async function approveVideoAction(_prev: SimpleState, formData: FormData): Promise<SimpleState> {
  await requireSession();
  const id = episodeId(formData);
  if (!id) return { error: "잘못된 요청입니다." };
  try {
    await decide(id, "approve-video");
  } catch (error) {
    refresh();
    if (error instanceof TransitionError) return { error: error.message };
    throw error;
  }
  refresh();
  return {};
}

/** 유튜브에 직접 올린 뒤 "올렸어요": 업로드 대기 → 업로드 완료. 영상 링크를 주면 함께 기록한다. */
export async function markUploadedAction(_prev: SimpleState, formData: FormData): Promise<SimpleState> {
  await requireSession();
  const id = episodeId(formData);
  if (!id) return { error: "잘못된 요청입니다." };
  const link = String(formData.get("link") ?? "").trim();
  const videoId = link ? parseVideoId(link) : null;
  if (link && !videoId) return { error: "유튜브 영상 링크가 아닙니다. 비워 두거나 공유 링크(youtu.be/…)를 넣으세요." };
  try {
    await decide(id, "mark-uploaded");
  } catch (error) {
    refresh();
    if (error instanceof TransitionError) return { error: error.message };
    throw error;
  }
  if (videoId) await saveUpload(id, videoId, "public");
  refresh();
  return {};
}

const UPLOAD_CHOICES = { public: "public", unlisted: "unlisted", private: "private", scheduled: "private" } as const;

/**
 * 유튜브 자동 업로드: 공개 상태(공개·일부 공개·비공개·예약 공개)를 정하고 업로드를 시작한다(무료, 누르는 것이 확인).
 * 예약 시각은 한국 시간(datetime-local)으로 받는다.
 */
export async function uploadAction(_prev: SimpleState, formData: FormData): Promise<SimpleState> {
  await requireSession();
  const id = episodeId(formData);
  const choice = String(formData.get("privacy") ?? "");
  if (!id || !(choice in UPLOAD_CHOICES)) return { error: "공개 상태를 고르세요." };
  const privacy = UPLOAD_CHOICES[choice as keyof typeof UPLOAD_CHOICES];
  const when = String(formData.get("publishAt") ?? "");
  const scheduledAt = choice === "scheduled" ? new Date(`${when}:00+09:00`) : null;
  if (scheduledAt && Number.isNaN(scheduledAt.getTime())) return { error: "예약 공개 시각을 고르세요." };

  const availability = dispatchAvailability();
  if (!availability.ok) return { error: availability.reason };
  try {
    await setUploadPlan(id, privacy, scheduledAt);
    await triggerStep(id, "upload", createDispatcher());
  } catch (error) {
    refresh();
    if (error instanceof RangeError || error instanceof TransitionError) return { error: error.message };
    throw error;
  }
  refresh();
  return {};
}
