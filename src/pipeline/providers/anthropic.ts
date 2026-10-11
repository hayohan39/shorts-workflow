import Anthropic from "@anthropic-ai/sdk";

export function readAnthropicKey(env: Record<string, string | undefined> = process.env): string {
  const key = env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error("ANTHROPIC_API_KEY 가 없습니다. GitHub → Settings → Secrets → Actions 에 등록하세요.");
  }
  return key;
}

/** 사용 가능한 Claude 모델 목록(Models API). 설정 화면의 대본 모델 드롭다운에 쓴다. */
export async function listClaudeModels(client: Anthropic): Promise<{ id: string; label: string }[]> {
  const models: { id: string; label: string }[] = [];
  for await (const model of client.models.list()) {
    models.push({ id: model.id, label: model.display_name });
  }
  return models;
}
