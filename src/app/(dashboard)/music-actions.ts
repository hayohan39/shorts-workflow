"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { getChannel } from "@/pipeline/channels";
import { createEpisode } from "@/pipeline/episodes";
import { saveMusicTrack, setMusicStart } from "@/pipeline/music/track";

// 음악형 에피소드(직접 만든 음원). 크레딧·유료 API 를 쓰지 않는다.

export type MusicEpisodeState = { error?: string; topic?: string; outline?: string; targetSeconds?: number };

/** 음악형 에피소드를 만들고 음원 올리기 화면으로 간다. */
export async function createMusicEpisodeAction(_prev: MusicEpisodeState, formData: FormData): Promise<MusicEpisodeState> {
  await requireSession();
  const topic = String(formData.get("topic") ?? "");
  const outline = String(formData.get("outline") ?? "");
  const targetSeconds = Number(formData.get("targetSeconds"));
  const kept = { topic, outline, targetSeconds };
  const channel = await getChannel(String(formData.get("channel") ?? ""));
  if (!channel || channel.route !== "music") return { error: "음악형 채널을 찾을 수 없습니다.", ...kept };
  let id: number;
  try {
    id = (await createEpisode({ topic, outline, route: "music", channel: channel.slug, targetSeconds })).id;
  } catch (error) {
    if (error instanceof RangeError) return { error: error.message, ...kept };
    throw error;
  }
  redirect(`/episodes/${id}?tab=audio`);
}

export type MusicActionState = { error?: string; saved?: boolean };

/** 브라우저가 Blob 에 올린 음원을 에피소드에 저장한다(주소는 이 에피소드 폴더의 것만 받는다). */
export async function saveMusicAudioAction(input: {
  episodeId: number;
  url: string;
  fileName: string;
  durationSeconds: number;
}): Promise<MusicActionState> {
  await requireSession();
  if (!Number.isInteger(input.episodeId) || input.episodeId <= 0) return { error: "잘못된 요청입니다." };
  try {
    await saveMusicTrack(input.episodeId, {
      audioUrl: String(input.url),
      fileName: String(input.fileName),
      durationSeconds: Number(input.durationSeconds),
    });
  } catch (error) {
    if (error instanceof RangeError) return { error: error.message };
    throw error;
  }
  refresh();
  return { saved: true };
}

/** 영상에 쓸 구간의 시작 시각. */
export async function setMusicStartAction(_prev: MusicActionState, formData: FormData): Promise<MusicActionState> {
  await requireSession();
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id) || id <= 0) return { error: "잘못된 요청입니다." };
  try {
    await setMusicStart(id, Number(formData.get("start")));
  } catch (error) {
    if (error instanceof RangeError) return { error: error.message };
    throw error;
  }
  refresh();
  return { saved: true };
}
