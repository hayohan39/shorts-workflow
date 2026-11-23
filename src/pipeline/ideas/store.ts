import { query, transaction } from "@/lib/db";
import { redact } from "@/lib/health";

// 채널 추천(기획안)과 그 실행 기록. 생성은 ideas/run.ts, 화면은 /channels/<채널>/ideas.

export type IdeaStatus = "new" | "saved" | "discarded" | "used";
export type IdeaRunStatus = "queued" | "running" | "done" | "failed";

export interface Category {
  id: number;
  channel: string;
  name: string;
}

export interface Idea {
  id: number;
  runId: number | null;
  channel: string;
  categoryId: number | null;
  title: string;
  hook: string;
  outline: string;
  reason: string;
  targetSeconds: number;
  status: IdeaStatus;
  episodeId: number | null;
  createdAt: Date;
}

export interface IdeaRun {
  id: number;
  channel: string;
  trigger: "manual" | "schedule";
  status: IdeaRunStatus;
  progress: string | null;
  error: string | null;
  model: string | null;
  costUsd: number | null;
  runUrl: string | null;
  createdAt: Date;
  finishedAt: Date | null;
}

/** 새로 만든 기획안(카테고리 이름으로 받는다). */
export interface NewIdea {
  category: string;
  title: string;
  hook: string;
  outline: string;
  reason: string;
  targetSeconds: number;
}

/** 대기·실행 중인 실행이 이보다 오래되면 멈춘 것으로 보고 새로 요청할 수 있다. */
export const RUN_STALE_MS = 30 * 60_000;
/** 아직 보지 않은 새 기획안이 이만큼 쌓여 있으면 자동 추천을 건너뛴다(낭비 방지). */
export const MAX_UNREVIEWED = 7;
const ERROR_MAX = 1000;

interface IdeaRow {
  id: number;
  run_id: number | null;
  channel: string;
  category_id: number | null;
  title: string;
  hook: string;
  outline: string;
  reason: string;
  target_seconds: number;
  status: IdeaStatus;
  episode_id: number | null;
  created_at: Date;
}

interface RunRow {
  id: number;
  channel: string;
  trigger: "manual" | "schedule";
  status: IdeaRunStatus;
  progress: string | null;
  error: string | null;
  model: string | null;
  cost_usd: string | null;
  run_url: string | null;
  created_at: Date;
  finished_at: Date | null;
}

const IDEA_COLUMNS =
  "id, run_id, channel, category_id, title, hook, outline, reason, target_seconds, status, episode_id, created_at";
const RUN_COLUMNS = "id, channel, trigger, status, progress, error, model, cost_usd, run_url, created_at, finished_at";

const toIdea = (row: IdeaRow): Idea => ({
  id: row.id,
  runId: row.run_id,
  channel: row.channel,
  categoryId: row.category_id,
  title: row.title,
  hook: row.hook,
  outline: row.outline,
  reason: row.reason,
  targetSeconds: row.target_seconds,
  status: row.status,
  episodeId: row.episode_id,
  createdAt: row.created_at,
});

const toRun = (row: RunRow): IdeaRun => ({
  id: row.id,
  channel: row.channel,
  trigger: row.trigger,
  status: row.status,
  progress: row.progress,
  error: row.error,
  model: row.model,
  costUsd: row.cost_usd === null ? null : Number(row.cost_usd),
  runUrl: row.run_url,
  createdAt: row.created_at,
  finishedAt: row.finished_at,
});

/** 화면에서 고칠 수 있는 프롬프트 key 인가(있는 채널의 추천·대본 지침, 또는 있는 카테고리의 추천 프롬프트). */
export async function isEditablePromptKey(key: string): Promise<boolean> {
  const channel = /^(?:ideas|script):([a-z][a-z0-9-]*)$/.exec(key);
  const category = /^ideas:category:(\d+)$/.exec(key);
  if (channel) return (await query("select 1 from channels where slug = $1", [channel[1]])).length > 0;
  if (category) return (await query("select 1 from channel_categories where id = $1", [Number(category[1])])).length > 0;
  return false;
}

export async function listCategories(channel: string): Promise<Category[]> {
  return query<Category>("select id, channel, name from channel_categories where channel = $1 order by position, id", [channel]);
}

// ── 기획안 ─────────────────────────────────────────

export async function listIdeas(channel: string, statuses: IdeaStatus[], limit = 50): Promise<Idea[]> {
  const rows = await query<IdeaRow>(
    // 최근 실행부터, 같은 실행 안에서는 카테고리 순서대로.
    `select ${IDEA_COLUMNS} from ideas where channel = $1 and status = any($2)
      order by coalesce(run_id, 0) desc, created_at desc, category_id nulls last, id limit $3`,
    [channel, statuses, limit],
  );
  return rows.map(toIdea);
}

export async function getIdea(id: number): Promise<Idea | null> {
  const [row] = await query<IdeaRow>(`select ${IDEA_COLUMNS} from ideas where id = $1`, [id]);
  return row ? toIdea(row) : null;
}

export async function countNewIdeas(channel: string): Promise<number> {
  const [row] = await query<{ count: number }>("select count(*)::int as count from ideas where channel = $1 and status = 'new'", [
    channel,
  ]);
  return row.count;
}

/** 저장·폐기(되살리기 포함). 에피소드로 만든 것은 바꾸지 않는다. */
export async function decideIdea(id: number, status: "saved" | "discarded"): Promise<Idea> {
  const [row] = await query<IdeaRow>(
    `update ideas set status = $2, decided_at = now() where id = $1 and status <> 'used' returning ${IDEA_COLUMNS}`,
    [id, status],
  );
  if (!row) throw new RangeError("이미 에피소드로 만든 기획안이거나 없는 기획안입니다.");
  return toIdea(row);
}

/**
 * 기획안으로 에피소드를 만들고 만들었다고 표시한다. 기획안 행을 잠근 채로 만들어서, 같은 기획안을 두 번 눌러도
 * 에피소드가 하나만 생긴다(두 번째는 RangeError). create 가 실패하면 기획안은 그대로 남는다.
 */
export async function claimIdea(id: number, create: (idea: Idea) => Promise<number>): Promise<number> {
  return transaction(async (client) => {
    const {
      rows: [row],
    } = await client.query<IdeaRow>(`select ${IDEA_COLUMNS} from ideas where id = $1 for update`, [id]);
    if (!row) throw new RangeError("기획안을 찾을 수 없습니다.");
    if (row.status === "used") throw new RangeError("이미 에피소드로 만든 기획안입니다.");
    const episodeId = await create(toIdea(row));
    await client.query("update ideas set status = 'used', episode_id = $2, decided_at = now() where id = $1", [id, episodeId]);
    return episodeId;
  });
}

/** 겹치지 않게 프롬프트에 넣을 최근 주제: 이 채널의 기획안(폐기 포함)과 에피소드 주제. */
export async function recentTopics(channel: string, limit = 40): Promise<string[]> {
  const rows = await query<{ title: string }>(
    `select title from (
        select title, created_at from ideas where channel = $1
        union all
        select topic as title, created_at from episodes where channel = $1
      ) recent order by created_at desc limit $2`,
    [channel, limit],
  );
  return [...new Set(rows.map((row) => row.title))];
}

// ── 실행 ─────────────────────────────────────────

/** 추천 실행을 요청한다. 같은 채널에서 도는 중이면 RangeError. */
export async function requestIdeaRun(channel: string, trigger: IdeaRun["trigger"], now = Date.now()): Promise<IdeaRun> {
  return transaction(async (client) => {
    // 같은 채널 요청이 동시에 와도 하나만 만들게 채널 행을 잠근다.
    await client.query("select slug from channels where slug = $1 for update", [channel]);
    const { rows: active } = await client.query<{ id: number }>(
      "select id from idea_runs where channel = $1 and status in ('queued', 'running') and created_at > $2",
      [channel, new Date(now - RUN_STALE_MS)],
    );
    if (active.length) throw new RangeError("추천을 만드는 중입니다. 끝난 뒤 다시 시도하세요.");
    const {
      rows: [row],
    } = await client.query<RunRow>(`insert into idea_runs (channel, trigger) values ($1, $2) returning ${RUN_COLUMNS}`, [
      channel,
      trigger,
    ]);
    return toRun(row);
  });
}

export async function getIdeaRun(id: number): Promise<IdeaRun | null> {
  const [row] = await query<RunRow>(`select ${RUN_COLUMNS} from idea_runs where id = $1`, [id]);
  return row ? toRun(row) : null;
}

export async function latestIdeaRun(channel: string): Promise<IdeaRun | null> {
  const [row] = await query<RunRow>(`select ${RUN_COLUMNS} from idea_runs where channel = $1 order by id desc limit 1`, [
    channel,
  ]);
  return row ? toRun(row) : null;
}

export function isRunActive(run: Pick<IdeaRun, "status" | "createdAt"> | null, now = Date.now()): boolean {
  return Boolean(run && (run.status === "queued" || run.status === "running") && now - run.createdAt.getTime() < RUN_STALE_MS);
}

export async function startIdeaRun(id: number, runUrl: string | null): Promise<void> {
  const rows = await query(
    "update idea_runs set status = 'running', started_at = now(), run_url = $2 where id = $1 and status = 'queued' returning id",
    [id, runUrl],
  );
  if (!rows.length) throw new Error(`추천 실행 #${id} 은 대기 중이 아닙니다.`);
}

export async function setIdeaRunProgress(id: number, progress: string): Promise<void> {
  await query("update idea_runs set progress = $2 where id = $1", [id, progress.slice(0, 200)]);
}

/** 기획안을 저장하고 실행을 끝낸다. 카테고리 이름이 맞지 않는 기획안은 카테고리 없이 남긴다. */
export async function finishIdeaRun(
  id: number,
  ideas: NewIdea[],
  result: { model: string; costUsd: number | null },
): Promise<Idea[]> {
  return transaction(async (client) => {
    const {
      rows: [run],
    } = await client.query<{ channel: string }>(
      "update idea_runs set status = 'done', progress = null, model = $2, cost_usd = $3, finished_at = now() where id = $1 returning channel",
      [id, result.model, result.costUsd],
    );
    if (!run) throw new Error(`추천 실행 #${id} 을 찾을 수 없습니다.`);
    const saved: Idea[] = [];
    for (const idea of ideas) {
      const { rows } = await client.query<IdeaRow>(
        `insert into ideas (run_id, channel, category_id, title, hook, outline, reason, target_seconds)
          values ($1, $2, (select id from channel_categories where channel = $2 and name = $3), $4, $5, $6, $7, $8)
          returning ${IDEA_COLUMNS}`,
        [id, run.channel, idea.category, idea.title, idea.hook, idea.outline, idea.reason, idea.targetSeconds],
      );
      saved.push(toIdea(rows[0]));
    }
    return saved;
  });
}

export async function failIdeaRun(id: number, error: string, costUsd: number | null = null): Promise<void> {
  await query(
    `update idea_runs set status = 'failed', progress = null, error = $2, cost_usd = coalesce($3, cost_usd), finished_at = now()
      where id = $1 and status in ('queued', 'running')`,
    [id, redact(error).slice(0, ERROR_MAX), costUsd],
  );
}

/**
 * 자동 추천할 채널: 켜져 있고, 카테고리가 있고, 주기(일) 안에 요청한 실행이 없고(실패는 다음 날 다시),
 * 아직 보지 않은 기획안이 많이 쌓이지 않은 채널. 매일 실행 시각이 조금씩 밀려도 주기가 밀리지 않게 3시간 여유를 둔다.
 */
export async function dueIdeaChannels(now = Date.now()): Promise<string[]> {
  const rows = await query<{ slug: string }>(
    `select c.slug from channels c
      where c.ideas_auto
        and exists (select 1 from channel_categories k where k.channel = c.slug)
        and not exists (
          select 1 from idea_runs r where r.channel = c.slug and r.status <> 'failed'
            and r.created_at > $1::timestamptz - make_interval(hours => c.ideas_every_days * 24 - 3))
        and (select count(*) from ideas i where i.channel = c.slug and i.status = 'new') < $2
      order by c.position`,
    [new Date(now), MAX_UNREVIEWED],
  );
  return rows.map((row) => row.slug);
}
