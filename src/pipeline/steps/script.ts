import Anthropic from "@anthropic-ai/sdk";
import { listPicks, PICK_COUNT } from "@/pipeline/clips/picks";
import type { Episode } from "@/pipeline/episodes";
import { readAnthropicKey } from "@/pipeline/providers/anthropic";
import {
  createSender,
  describeUsage,
  generateScript,
  ScriptGenerationError,
  type SendMessage,
} from "@/pipeline/script/generate";
import { DEFAULT_SCRIPT_MODEL } from "@/pipeline/script/model";
import { latestScript, recentScripts, saveScript } from "@/pipeline/scripts";
import { getSettings } from "@/pipeline/settings";

/** 대본 생성 단계: 이전 버전의 반려 메모와 최근 편을 참고해 새 버전을 만든다. */
export async function runScriptStep(
  episode: Episode,
  options: { send?: SendMessage; progress?: (text: string) => Promise<void> } = {},
): Promise<void> {
  const progress = options.progress ?? (async () => {});
  const [previous, recent, settings, picks] = await Promise.all([
    latestScript(episode.id),
    recentScripts(episode),
    getSettings(),
    episode.route === "clips" ? listPicks(episode.id) : [],
  ]);
  if (episode.route === "clips" && picks.length !== PICK_COUNT) {
    throw new Error(`장면에 쓸 클립 ${PICK_COUNT}개를 먼저 고르세요(지금 ${picks.length}개).`);
  }
  const sender = options.send ?? createSender(new Anthropic({ apiKey: readAnthropicKey() }));
  const model = settings.scriptModel || DEFAULT_SCRIPT_MODEL;
  await progress(`자료 조사·대본 작성 중 (${model})`);
  const result = await generateScript(
    {
      topic: episode.topic,
      outline: episode.outline,
      reviewerNote: previous?.reviewerNote ?? null,
      previousNarration: previous?.reviewerNote ? previous.narration : null,
      recentEpisodes: recent.map((script) => ({
        title: script.title,
        hook: script.scenes[0]?.narration ?? "",
        sceneKinds: script.scenes.map((scene) => scene.kind).join("·"),
      })),
      clips: picks.map((clip) => ({ title: clip.title, keyword: clip.keyword, seconds: clip.durationSec })),
    },
    { model, send: sender, onProgress: progress },
  ).catch((error: unknown) => {
    // 실패한 시도에도 비용이 들었으면 오류 메시지에 함께 남긴다(대시보드에 보임).
    if (error instanceof ScriptGenerationError && error.usage?.rounds) {
      error.message = `${error.message}\n(이번 시도: ${describeUsage(error.usage)})`;
    }
    throw error;
  });
  await progress(`대본 저장 중 · ${describeUsage(result.usage)}`);
  await saveScript(episode.id, result.draft, {
    source: "generated",
    warnings: result.warnings,
    model: result.model,
    usage: result.usage,
  });
}
