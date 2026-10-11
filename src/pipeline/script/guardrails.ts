import { FORBIDDEN_EXPRESSIONS } from "@/pipeline/script/forbidden-expressions";
import type { Problem, ScriptDraft } from "@/pipeline/script/schema";

const compiled = FORBIDDEN_EXPRESSIONS.map((item) => ({ ...item, regex: new RegExp(item.pattern, "giu") }));

/** 한 텍스트에서 걸린 표현들. 겹치는 부분은 더 긴(구체적인) 표현 하나만 남긴다. */
export function findForbidden(text: string): { match: string; reason: string }[] {
  const found: { start: number; end: number; match: string; reason: string }[] = [];
  for (const item of compiled) {
    for (const match of text.matchAll(item.regex)) {
      found.push({ start: match.index, end: match.index + match[0].length, match: match[0], reason: item.reason });
    }
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: typeof found = [];
  for (const item of found) {
    if (kept.length && item.start < kept[kept.length - 1].end) continue;
    kept.push(item);
  }
  return kept.map(({ match, reason }) => ({ match, reason }));
}

/** 사람에게 보이는 글(내레이션·제목·설명란·해시태그)을 검사해 경고 목록으로. */
export function checkGuardrails(draft: ScriptDraft): Problem[] {
  const fields: [string, string][] = [
    ...draft.scenes.map((scene): [string, string] => [`scenes.${scene.no}`, scene.narration]),
    ["title", draft.title],
    ["description", draft.description],
    ["tags", draft.tags.join(" ")],
  ];
  const problems: Problem[] = [];
  for (const [field, text] of fields) {
    for (const { match, reason } of findForbidden(text)) {
      problems.push({ field, message: `"${match}" — ${reason}` });
    }
  }
  return problems;
}
