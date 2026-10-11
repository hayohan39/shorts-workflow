import Anthropic from "@anthropic-ai/sdk";
import type { Episode } from "@/pipeline/episodes";
import { createSender, generateScript, type SendMessage } from "@/pipeline/script/generate";
import { DEFAULT_SCRIPT_MODEL } from "@/pipeline/script/model";
import { latestScript, recentScripts, saveScript } from "@/pipeline/scripts";
import { getSettings } from "@/pipeline/settings";

export function readAnthropicKey(env: Record<string, string | undefined> = process.env): string {
  const key = env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error("ANTHROPIC_API_KEY 가 없습니다. GitHub → Settings → Secrets → Actions 에 등록하세요.");
  }
  return key;
}

/** 대본 생성 단계: 이전 버전의 반려 메모와 최근 편을 참고해 새 버전을 만든다. */
export async function runScriptStep(episode: Episode, send?: SendMessage): Promise<void> {
  const [previous, recent, settings] = await Promise.all([
    latestScript(episode.id),
    recentScripts(episode.id),
    getSettings(),
  ]);
  const sender = send ?? createSender(new Anthropic({ apiKey: readAnthropicKey() }));
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
    { model: settings.scriptModel || DEFAULT_SCRIPT_MODEL, send: sender },
  );
  await saveScript(episode.id, result.draft, {
    source: "generated",
    warnings: result.warnings,
    model: result.model,
    usage: result.usage,
  });
}
