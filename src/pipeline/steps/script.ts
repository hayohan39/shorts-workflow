import Anthropic from "@anthropic-ai/sdk";
import type { Episode } from "@/pipeline/episodes";
import { readAnthropicKey } from "@/pipeline/providers/anthropic";
import { createSender, generateScript, type SendMessage } from "@/pipeline/script/generate";
import { DEFAULT_SCRIPT_MODEL } from "@/pipeline/script/model";
import { latestScript, recentScripts, saveScript } from "@/pipeline/scripts";
import { getSettings } from "@/pipeline/settings";

/** 대본 생성 단계: 이전 버전의 반려 메모와 최근 편을 참고해 새 버전을 만든다. */
export async function runScriptStep(
  episode: Episode,
  options: { send?: SendMessage; progress?: (text: string) => Promise<void> } = {},
): Promise<void> {
  const progress = options.progress ?? (async () => {});
  const [previous, recent, settings] = await Promise.all([
    latestScript(episode.id),
    recentScripts(episode.id),
    getSettings(),
  ]);
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
    },
    { model, send: sender, onProgress: progress },
  );
  await progress("대본 저장 중");
  await saveScript(episode.id, result.draft, {
    source: "generated",
    warnings: result.warnings,
    model: result.model,
    usage: result.usage,
  });
}
