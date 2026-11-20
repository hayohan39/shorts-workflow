"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { createDispatcher, createWorkflowDispatcher, dispatchAvailability } from "@/lib/github";
import { getChannel, updateChannel, updateIdeaSettings } from "@/pipeline/channels";
import { createEpisode } from "@/pipeline/episodes";
import { decideIdea, failIdeaRun, isIdeaPromptKey, listCategories, requestIdeaRun, claimIdea } from "@/pipeline/ideas/store";
import { savePrompt } from "@/pipeline/prompts";
import { triggerStep } from "@/pipeline/trigger";

export type ChannelSettingsState = { error?: string; saved?: boolean };

/** 채널 설정 저장: 이름·아이콘·기본 제작 방식·유튜브 채널 ID. */
export async function updateChannelAction(_prev: ChannelSettingsState, formData: FormData): Promise<ChannelSettingsState> {
  await requireSession();
  try {
    await updateChannel(String(formData.get("slug") ?? ""), {
      name: String(formData.get("name") ?? ""),
      emoji: String(formData.get("emoji") ?? ""),
      route: formData.get("route") === "clips" ? "clips" : "ai",
      defaultSeconds: Number(formData.get("defaultSeconds")),
      youtubeChannelId: String(formData.get("youtubeChannelId") ?? ""),
    });
  } catch (error) {
    if (error instanceof RangeError) return { error: error.message };
    throw error;
  }
  refresh();
  return { saved: true };
}

// ── 추천(기획안) ─────────────────────────────────────────

export type IdeaActionState = { error?: string; saved?: boolean };

function positiveId(value: FormDataEntryValue | null): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** "지금 추천 받기": 추천 실행을 요청하고 Actions 를 부른다(Claude 비용, 누르는 것이 확인). */
export async function requestIdeasAction(_prev: IdeaActionState, formData: FormData): Promise<IdeaActionState> {
  await requireSession();
  const channel = await getChannel(String(formData.get("slug") ?? ""));
  if (!channel) return { error: "채널을 찾을 수 없습니다." };
  if (!(await listCategories(channel.slug)).length) return { error: "이 채널은 카테고리가 없어 추천을 만들 수 없습니다." };
  const availability = dispatchAvailability();
  if (!availability.ok) return { error: availability.reason };
  let runId: number;
  try {
    runId = (await requestIdeaRun(channel.slug, "manual")).id;
  } catch (error) {
    refresh();
    if (error instanceof RangeError) return { error: error.message };
    throw error;
  }
  try {
    await createWorkflowDispatcher()({ step: "ideas", idea_run_id: String(runId) });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await failIdeaRun(runId, reason);
    refresh();
    return { error: reason };
  }
  refresh();
  return {};
}

/** 저장·폐기(폐기한 것 되살리기는 저장). */
export async function decideIdeaAction(_prev: IdeaActionState, formData: FormData): Promise<IdeaActionState> {
  await requireSession();
  const id = positiveId(formData.get("id"));
  const decision = formData.get("decision");
  if (!id || (decision !== "saved" && decision !== "discarded")) return { error: "잘못된 요청입니다." };
  try {
    await decideIdea(id, decision);
  } catch (error) {
    refresh();
    if (error instanceof RangeError) return { error: error.message };
    throw error;
  }
  refresh();
  return {};
}

/** 기획안으로 에피소드를 만들고 대본 생성을 시작한다(근거 조사·대본 Claude 비용, 누르는 것이 확인). */
export async function createFromIdeaAction(_prev: IdeaActionState, formData: FormData): Promise<IdeaActionState> {
  await requireSession();
  const id = positiveId(formData.get("id"));
  if (!id) return { error: "잘못된 요청입니다." };
  let episodeId: number;
  try {
    episodeId = await claimIdea(id, async (idea) => {
      const episode = await createEpisode({
        topic: String(formData.get("title") ?? ""),
        outline: `훅: ${idea.hook}\n${String(formData.get("outline") ?? "").trim()}`,
        route: "ai",
        channel: idea.channel,
        targetSeconds: Number(formData.get("targetSeconds")),
      });
      return episode.id;
    });
  } catch (error) {
    refresh();
    if (error instanceof RangeError) return { error: error.message };
    throw error;
  }
  if (dispatchAvailability().ok) await triggerStep(episodeId, "script", createDispatcher());
  redirect(`/episodes/${episodeId}`);
}

/** 자동 추천 켜기·끄기와 주기. 켜는 것이 매일 실행의 비용 승인이다. */
export async function ideaSettingsAction(_prev: IdeaActionState, formData: FormData): Promise<IdeaActionState> {
  await requireSession();
  try {
    await updateIdeaSettings(String(formData.get("slug") ?? ""), {
      auto: formData.get("auto") === "on",
      everyDays: Number(formData.get("everyDays")),
    });
  } catch (error) {
    if (error instanceof RangeError) return { error: error.message };
    throw error;
  }
  refresh();
  return { saved: true };
}

/** 추천 프롬프트 저장(새 버전). 되돌리기도 예전 내용을 이 액션으로 다시 저장한다. */
export async function savePromptAction(_prev: IdeaActionState, formData: FormData): Promise<IdeaActionState> {
  await requireSession();
  const key = String(formData.get("key") ?? "");
  if (!(await isIdeaPromptKey(key))) return { error: "잘못된 요청입니다." };
  try {
    await savePrompt(key, String(formData.get("body") ?? ""));
  } catch (error) {
    if (error instanceof RangeError) return { error: error.message };
    throw error;
  }
  refresh();
  return { saved: true };
}
