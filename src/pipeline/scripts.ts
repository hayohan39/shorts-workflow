import { query } from "@/lib/db";
import { checkGuardrails } from "@/pipeline/script/guardrails";
import { toDraft, validateScript, type Problem, type ResearchItem, type Scene, type ScriptDraft } from "@/pipeline/script/schema";

// scripts 테이블: 에피소드별 대본 버전. 화면은 가장 최근 버전을 보여 준다.

export interface Script extends ScriptDraft {
  id: number;
  episodeId: number;
  version: number;
  source: "generated" | "edited";
  warnings: Problem[];
  reviewerNote: string | null;
  model: string | null;
  usage: Record<string, number> | null;
  createdAt: Date;
}

interface ScriptRow {
  id: number;
  episode_id: number;
  version: number;
  research: ResearchItem[];
  narration: string;
  scenes: Scene[];
  title: string;
  description: string;
  tags: string[];
  needs_ai_disclosure: boolean;
  reviewer_note: string | null;
  source: "generated" | "edited";
  warnings: Problem[];
  model: string | null;
  usage: Record<string, number> | null;
  created_at: Date;
}

const COLUMNS = `id, episode_id, version, research, narration, scenes, title, description, tags,
  needs_ai_disclosure, reviewer_note, source, warnings, model, usage, created_at`;
export const NOTE_MAX = 1000;

function toScript(row: ScriptRow): Script {
  return {
    id: row.id,
    episodeId: row.episode_id,
    version: row.version,
    research: row.research,
    narration: row.narration,
    scenes: row.scenes,
    title: row.title,
    description: row.description,
    tags: row.tags,
    needsAiDisclosure: row.needs_ai_disclosure,
    reviewerNote: row.reviewer_note,
    source: row.source,
    warnings: row.warnings,
    model: row.model,
    usage: row.usage,
    createdAt: row.created_at,
  };
}

export async function latestScript(episodeId: number): Promise<Script | null> {
  const [row] = await query<ScriptRow>(
    `select ${COLUMNS} from scripts where episode_id = $1 order by version desc limit 1`,
    [episodeId],
  );
  return row ? toScript(row) : null;
}

/** 다른 에피소드의 최근 대본(훅·장면 구성을 겹치지 않게 하려고 프롬프트에 넣는다). */
export async function recentScripts(excludeEpisodeId: number, limit = 5): Promise<Script[]> {
  const rows = await query<ScriptRow>(
    `select distinct on (episode_id) ${COLUMNS} from scripts
      where episode_id <> $1 order by episode_id desc, version desc limit $2`,
    [excludeEpisodeId, limit],
  );
  return rows.map(toScript);
}

export async function saveScript(
  episodeId: number,
  draft: ScriptDraft,
  meta: { source: "generated" | "edited"; warnings: Problem[]; model: string | null; usage: object | null },
): Promise<Script> {
  const [row] = await query<ScriptRow>(
    `insert into scripts (episode_id, version, research, narration, scenes, title, description, tags,
        needs_ai_disclosure, source, warnings, model, usage)
      values ($1, coalesce((select max(version) from scripts where episode_id = $1), 0) + 1,
        $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      returning ${COLUMNS}`,
    [
      episodeId,
      JSON.stringify(draft.research),
      draft.narration,
      JSON.stringify(draft.scenes),
      draft.title,
      draft.description,
      draft.tags,
      draft.needsAiDisclosure,
      meta.source,
      JSON.stringify(meta.warnings),
      meta.model,
      meta.usage ? JSON.stringify(meta.usage) : null,
    ],
  );
  return toScript(row);
}

/** 검토 메모를 해당 버전에 남긴다(반려 사유는 다음 생성에 쓰인다). */
export async function setReviewerNote(scriptId: number, note: string | null): Promise<void> {
  await query("update scripts set reviewer_note = $2 where id = $1", [scriptId, note?.slice(0, NOTE_MAX) || null]);
}

export interface ScriptEdit {
  narrations: string[];
  title: string;
  description: string;
  tags: string;
}

/**
 * 사람이 고친 내용으로 새 버전을 만든다. 장면 구성·프롬프트·근거는 그대로 두고
 * 내레이션·제목·설명란·해시태그만 바꾼다. 형식 오류면 RangeError.
 */
export async function saveEditedScript(base: Script, edit: ScriptEdit): Promise<Script> {
  if (edit.narrations.length !== base.scenes.length) throw new RangeError("장면 수가 맞지 않습니다.");
  const draft: ScriptDraft = {
    ...toDraft({
      research: base.research,
      scenes: base.scenes.map((scene, i) => ({ ...scene, narration: edit.narrations[i] ?? "" })),
      title: edit.title,
      summary: "",
      tags: edit.tags.split(/[\s,]+/),
    }),
    // 설명란은 사람이 쓴 그대로 둔다(출처·고지 포함 여부는 경고로 알린다).
    description: edit.description.trim(),
  };
  const { errors, warnings } = validateScript(draft);
  if (errors.length) throw new RangeError(errors.map((p) => p.message).join(" / "));
  if (!draft.description.includes("의학적 조언이 아닙니다")) {
    warnings.push({ field: "description", message: "설명란에 의학적 조언이 아니라는 고지가 없습니다." });
  }
  return saveScript(base.episodeId, draft, {
    source: "edited",
    warnings: [...warnings, ...checkGuardrails(draft)],
    model: base.model,
    usage: null,
  });
}
