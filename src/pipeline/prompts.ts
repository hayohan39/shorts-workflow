import { query } from "@/lib/db";

// 화면에서 고치는 프롬프트. key 마다 버전을 쌓고 가장 최근 버전을 쓴다(되돌리기 = 예전 내용을 새 버전으로 저장).

export const PROMPT_MAX = 4000;

export interface PromptVersion {
  key: string;
  version: number;
  body: string;
  createdAt: Date;
}

interface PromptRow {
  key: string;
  version: number;
  body: string;
  created_at: Date;
}

const toVersion = (row: PromptRow): PromptVersion => ({
  key: row.key,
  version: row.version,
  body: row.body,
  createdAt: row.created_at,
});

/** 여러 key 의 지금 값(없는 key 는 빠진다). */
export async function currentPrompts(keys: string[]): Promise<Map<string, PromptVersion>> {
  const rows = await query<PromptRow>(
    `select distinct on (key) key, version, body, created_at from prompts where key = any($1) order by key, version desc`,
    [keys],
  );
  return new Map(rows.map((row) => [row.key, toVersion(row)]));
}

/** 최근 버전부터. */
export async function promptHistory(key: string, limit = 10): Promise<PromptVersion[]> {
  const rows = await query<PromptRow>(
    "select key, version, body, created_at from prompts where key = $1 order by version desc limit $2",
    [key, limit],
  );
  return rows.map(toVersion);
}

/** 새 버전으로 저장한다. 지금 값과 같으면 저장하지 않는다(null). 잘못된 값은 RangeError. */
export async function savePrompt(key: string, body: string): Promise<PromptVersion | null> {
  const text = body.trim();
  if (!text) throw new RangeError("프롬프트를 비울 수 없습니다.");
  if (text.length > PROMPT_MAX) throw new RangeError(`프롬프트는 ${PROMPT_MAX}자 이내로 입력하세요.`);
  const [row] = await query<PromptRow>(
    `insert into prompts (key, version, body)
      select $1, coalesce(max(version), 0) + 1, $2 from prompts where key = $1
      having coalesce((select body from prompts where key = $1 order by version desc limit 1), '') <> $2
      returning key, version, body, created_at`,
    [key, text],
  );
  return row ? toVersion(row) : null;
}

export const channelIdeaPromptKey = (channel: string) => `ideas:${channel}`;
export const categoryIdeaPromptKey = (categoryId: number) => `ideas:category:${categoryId}`;
