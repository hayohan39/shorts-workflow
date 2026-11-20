"use server";

import { refresh } from "next/cache";
import { requireSession } from "@/lib/auth";
import { updateChannel } from "@/pipeline/channels";

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
