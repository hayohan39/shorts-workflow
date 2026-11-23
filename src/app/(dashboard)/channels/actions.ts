"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { createDispatcher, createWorkflowDispatcher, dispatchAvailability } from "@/lib/github";
import { getChannel, updateChannel, updateIdeaSettings } from "@/pipeline/channels";
import { setPoolKeywords } from "@/pipeline/clips/pool";
import { failAdopt, requestAdopt } from "@/pipeline/clips/store";
import { createEpisode } from "@/pipeline/episodes";
import { createStoryEpisode } from "@/pipeline/ideas/stories";
import { decideIdea, failIdeaRun, isEditablePromptKey, listCategories, requestIdeaRun, claimIdea } from "@/pipeline/ideas/store";
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
      defaultSeconds: Number(formData.get("defaultSeconds")),
      youtubeChannelId: String(formData.get("youtubeChannelId") ?? ""),
      descriptionFooter: String(formData.get("descriptionFooter") ?? ""),
      videoNotice: String(formData.get("videoNotice") ?? ""),
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
  if (channel.route !== "clips" && !(await listCategories(channel.slug)).length) {
    return { error: "이 채널은 카테고리가 없어 추천을 만들 수 없습니다." };
  }
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

/**
 * 기획안으로 에피소드를 만들고 대본 생성을 시작한다(근거 조사·대본 Claude 비용, 누르는 것이 확인).
 * 생성형 기획안은 생성형 에피소드로, 편집형 스토리 후보는 고른 소재가 장면 순서대로 들어간 편집형 에피소드로 만든다
 * (소재는 채택해서 저장하고, 대본은 그 화면에 맞춰 쓴다).
 */
export async function createFromIdeaAction(_prev: IdeaActionState, formData: FormData): Promise<IdeaActionState> {
  await requireSession();
  const id = positiveId(formData.get("id"));
  if (!id) return { error: "잘못된 요청입니다." };
  const title = String(formData.get("title") ?? "");
  const outline = String(formData.get("outline") ?? "");
  let episodeId = 0;
  let adoptCollection: number | null = null;
  try {
    await claimIdea(id, async (idea) => {
      if (idea.clipIds) {
        ({ episodeId, collectionId: adoptCollection } = await createStoryEpisode(idea, { title, outline }));
      } else {
        episodeId = (
          await createEpisode({
            topic: title,
            outline: `훅: ${idea.hook}\n${outline.trim()}`,
            route: "ai",
            channel: idea.channel,
            targetSeconds: Number(formData.get("targetSeconds")),
          })
        ).id;
      }
      return episodeId;
    });
  } catch (error) {
    refresh();
    if (error instanceof RangeError) return { error: error.message };
    throw error;
  }
  if (dispatchAvailability().ok) {
    // 스토리 소재를 내려받아 저장한다(무료). 대본과 같이 돌고, 대본 승인 뒤 장면을 채운다.
    if (adoptCollection && (await requestAdopt(adoptCollection))) {
      try {
        await createWorkflowDispatcher()({ step: "clips-adopt", collection_id: String(adoptCollection) });
      } catch (error) {
        await failAdopt(adoptCollection, error instanceof Error ? error.message : String(error));
      }
    }
    await triggerStep(episodeId, "script", createDispatcher());
  }
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

/** 추천·대본 프롬프트 저장(새 버전). 되돌리기도 예전 내용을 이 액션으로 다시 저장한다. */
export async function savePromptAction(_prev: IdeaActionState, formData: FormData): Promise<IdeaActionState> {
  await requireSession();
  const key = String(formData.get("key") ?? "");
  if (!(await isEditablePromptKey(key))) return { error: "잘못된 요청입니다." };
  try {
    await savePrompt(key, String(formData.get("body") ?? ""));
  } catch (error) {
    if (error instanceof RangeError) return { error: error.message };
    throw error;
  }
  refresh();
  return { saved: true };
}

/** 소재 풀 검색어 저장(편집형 채널). */
export async function savePoolKeywordsAction(_prev: IdeaActionState, formData: FormData): Promise<IdeaActionState> {
  await requireSession();
  const channel = await getChannel(String(formData.get("slug") ?? ""));
  if (!channel || channel.route !== "clips") return { error: "잘못된 요청입니다." };
  try {
    await setPoolKeywords(channel.slug, String(formData.get("keywords") ?? ""));
  } catch (error) {
    if (error instanceof RangeError) return { error: error.message };
    throw error;
  }
  refresh();
  return { saved: true };
}
