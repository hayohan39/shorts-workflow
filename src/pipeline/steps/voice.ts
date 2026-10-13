import type { Episode } from "@/pipeline/episodes";
import { saveAsset } from "@/pipeline/assets";
import { monthlyCredits } from "@/pipeline/credits";
import { copyToBlob, createBlobPut, readBlobToken, type BlobPut } from "@/pipeline/providers/blob";
import {
  createManyMotionsClient,
  fetchManyMotionsAccount,
  numericFields,
  pickRemainingCredits,
  readManyMotionsKey,
} from "@/pipeline/providers/manymotions";
import type { McpClient } from "@/pipeline/providers/mcp";
import { latestScript } from "@/pipeline/scripts";
import { getSettings } from "@/pipeline/settings";
import {
  DEFAULT_VOICE_ID,
  DEFAULT_VOICE_MODEL,
  findVoice,
  isVoiceModel,
  NARRATION_CREDITS,
  type Voice,
  type VoiceModel,
} from "@/pipeline/voices";

// 내레이션 생성(⑤-1). ManyMotions 영상 편집 에이전트에게 ElevenLabs 음성 하나만 만들게 하고,
// 받은 음성 파일을 Vercel Blob 으로 옮겨 assets(kind=voice)에 남긴다.
// 에이전트는 지시 1회에 5크레딧 + 음성 75크레딧(2026-10-14 실측 합계 80). 확인 질문으로 끝나면 한 번만 더 지시한다.

const MANYMOTIONS_ORIGIN = "https://manymotions.com";
const MAX_TURNS = 2;

export interface VoiceStepDeps {
  editor: Pick<McpClient, "callTool">;
  /** 지금 남은 ManyMotions 크레딧(실제 차감액 계산용). 모르면 null. */
  readBalance: () => Promise<number | null>;
  put: BlobPut;
  fetchImpl?: typeof fetch;
  /** ManyMotions 주소의 파일을 받을 때 붙일 인증 헤더. */
  authHeaders?: Record<string, string>;
}

export function defaultVoiceDeps(): VoiceStepDeps {
  const key = readManyMotionsKey();
  return {
    editor: createManyMotionsClient(key),
    readBalance: async () => {
      try {
        return pickRemainingCredits(numericFields(await fetchManyMotionsAccount(key)))?.credits ?? null;
      } catch {
        return null;
      }
    },
    put: createBlobPut(readBlobToken()),
    authHeaders: { Authorization: `Bearer ${key}` },
  };
}

export function narrationInstruction(voice: Voice, model: VoiceModel, text: string): string {
  return [
    `ElevenLabs ${model} 모델, voice_id ${voice.id} (${voice.name}) 목소리로 아래 한국어 내레이션 전체를 음성 파일 하나로 생성해 voice 트랙에 넣어 주세요.`,
    "문장을 바꾸거나 줄이지 말고 그대로 읽어 주세요. 영상·이미지·음악·효과음은 만들지 마세요. 확인 질문 없이 바로 진행하세요.",
    "",
    "내레이션:",
    `"""${text}"""`,
  ].join("\n");
}

interface EditorReply {
  assistant_text?: string;
  assets_created?: { id?: string; kind?: string; url?: string }[];
}

function findAudio(reply: EditorReply): { id: string | null; url: string } | null {
  const asset = (reply.assets_created ?? []).find((a) => (a.kind === "audio" || a.kind === "voice") && a.url);
  return asset?.url ? { id: asset.id ?? null, url: asset.url } : null;
}

export async function runVoiceStep(
  episode: Episode,
  options: { progress?: (text: string) => Promise<void>; deps?: VoiceStepDeps } = {},
): Promise<{ assetId: number; credits: number }> {
  const progress = options.progress ?? (async () => {});
  const script = await latestScript(episode.id);
  if (!script) throw new Error("대본이 없습니다. 대본을 먼저 만들고 승인하세요.");

  const settings = await getSettings();
  const voice = findVoice(episode.voiceId) ?? findVoice(settings.voice) ?? findVoice(DEFAULT_VOICE_ID)!;
  const model: VoiceModel = isVoiceModel(episode.voiceModel)
    ? episode.voiceModel
    : isVoiceModel(settings.voiceModel)
      ? settings.voiceModel
      : DEFAULT_VOICE_MODEL;

  const credits = await monthlyCredits();
  if (credits.used + NARRATION_CREDITS > credits.limit) {
    throw new Error(
      `이번 달 크레딧 한도를 넘습니다(사용 ${credits.used.toLocaleString("ko-KR")} + 예상 ${NARRATION_CREDITS} > 한도 ${credits.limit.toLocaleString("ko-KR")}). 설정에서 한도를 올리거나 다음 달에 하세요.`,
    );
  }

  const deps = options.deps ?? defaultVoiceDeps();
  const before = await deps.readBalance();
  await progress(`${voice.name} 목소리로 내레이션 만드는 중`);
  const project = (await deps.editor.callTool("video_editor_create_project", {
    name: `episode-${episode.id}-narration`,
    aspect_ratio: "9:16",
  })) as { project_id?: string };
  if (!project.project_id) throw new Error("ManyMotions 편집 프로젝트를 만들지 못했습니다.");

  let instruction = narrationInstruction(voice, model, script.narration);
  let audio: { id: string | null; url: string } | null = null;
  let lastText = "";
  for (let turn = 0; turn < MAX_TURNS && !audio; turn++) {
    const reply = (await deps.editor.callTool("video_editor_instruct", {
      project_id: project.project_id,
      instruction,
    })) as EditorReply;
    lastText = reply.assistant_text ?? "";
    audio = findAudio(reply);
    instruction = "네, 확인 없이 바로 진행하세요. 위 내레이션 음성 하나만 만들고 다른 것은 만들지 마세요.";
  }
  if (!audio) {
    throw new Error(`내레이션 음성을 받지 못했습니다. 에이전트 답: ${lastText.slice(0, 300) || "(없음)"}`);
  }

  await progress("음성 파일 저장 중");
  const sourceUrl = new URL(audio.url, MANYMOTIONS_ORIGIN).toString();
  const stored = await copyToBlob(sourceUrl, `episodes/${episode.id}/narration-${voice.id}.mp3`, {
    put: deps.put,
    fetchImpl: deps.fetchImpl,
    headers: new URL(sourceUrl).origin === MANYMOTIONS_ORIGIN ? deps.authHeaders : undefined,
  });

  // 실제 차감액은 잔액 차이로 잰다. 잔액을 못 읽으면 실측 평균으로 적고 추정이라고 남긴다.
  const after = await deps.readBalance();
  const measured = before !== null && after !== null && before >= after ? before - after : null;
  const used = measured ?? NARRATION_CREDITS;
  const asset = await saveAsset({
    episodeId: episode.id,
    kind: "voice",
    model,
    mmJobId: audio.id,
    credits: used,
    url: stored.url,
    meta: {
      voiceId: voice.id,
      voiceName: voice.name,
      voiceModel: model,
      text: script.narration,
      scriptVersion: script.version,
      projectId: project.project_id,
      sourceUrl,
      creditsEstimated: measured === null,
      agentText: lastText.slice(0, 500),
    },
  });
  await progress(`내레이션 저장 · ${used}크레딧`);
  return { assetId: asset.id, credits: used };
}
