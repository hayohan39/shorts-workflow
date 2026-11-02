import { query } from "@/lib/db";
import { redact } from "@/lib/health";
import { countOptions, parseModelCatalog, type ModelCatalog } from "@/pipeline/catalog";
import type { McpClient, McpTool } from "@/pipeline/providers/mcp";

// 모델 조회: ManyMotions 모델 목록과 Claude 모델 목록을 provider_probes 에 저장한다.
// 하루 한 번 자동(Actions cron), 설정 화면을 열었을 때 목록이 없거나 오래됐으면 자동, 그리고 수동 새로 고침.
// 크레딧을 쓰지 않도록 이름이 list_ 로 시작하고 필수 인자가 없는 도구만 부른다.

export type ProbeState = "pending" | "running" | "done" | "failed";

export interface Probe {
  id: number;
  state: ProbeState;
  runUrl: string | null;
  tools: McpTool[] | null;
  listings: Record<string, unknown> | null;
  catalog: ModelCatalog;
  claudeModels: ClaudeModelList | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type ClaudeModelList = { id: string; label: string }[] | { error: string };

interface ProbeRow {
  id: number;
  state: ProbeState;
  run_url: string | null;
  tools: McpTool[] | null;
  listings: Record<string, unknown> | null;
  claude_models: ClaudeModelList | null;
  error: string | null;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS = "id, state, run_url, tools, listings, claude_models, error, created_at, updated_at";
/** 이 시간이 지나도록 대기·실행 중이면 멈춘 것으로 보고 새 조회를 허용한다. */
export const PROBE_STALE_MS = 15 * 60 * 1000;
/** 마지막 성공 조회가 이보다 오래되면 설정 화면을 열 때 자동으로 다시 조회한다. */
export const CATALOG_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function toProbe(row: ProbeRow): Probe {
  return {
    id: row.id,
    state: row.state,
    runUrl: row.run_url,
    tools: row.tools,
    listings: row.listings,
    // 기능별 선택지는 저장된 응답 원문에서 매번 계산한다(분류 규칙을 바꿔도 다시 조회할 필요 없음).
    catalog: parseModelCatalog(row.listings),
    claudeModels: row.claude_models,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function latestProbe(): Promise<Probe | null> {
  const [row] = await query<ProbeRow>(`select ${COLUMNS} from provider_probes order by id desc limit 1`);
  return row ? toProbe(row) : null;
}

/** 가장 최근 성공한 조회(설정 화면의 선택지). */
export async function latestSuccessfulProbe(): Promise<Probe | null> {
  const [row] = await query<ProbeRow>(
    `select ${COLUMNS} from provider_probes where state = 'done' order by id desc limit 1`,
  );
  return row ? toProbe(row) : null;
}

/** 자동으로 다시 조회해야 하는가: 성공한 조회가 없거나 오래됐고, 진행 중인 조회도 없을 때. */
export function needsRefresh(latest: Probe | null, lastSuccess: Probe | null, now = Date.now()): boolean {
  if (isProbeBusy(latest, now)) return false;
  // 방금 실패했다면 자동으로 계속 다시 시도하지 않는다(수동 새로 고침은 가능).
  if (latest?.state === "failed" && now - latest.updatedAt.getTime() < CATALOG_MAX_AGE_MS) return false;
  return !lastSuccess || now - lastSuccess.updatedAt.getTime() > CATALOG_MAX_AGE_MS;
}

export function isProbeBusy(probe: Probe | null, now = Date.now()): boolean {
  if (!probe || (probe.state !== "pending" && probe.state !== "running")) return false;
  return now - probe.updatedAt.getTime() <= PROBE_STALE_MS;
}

/** 새 조회를 요청한다. 진행 중인 조회가 있으면 null(중복 실행 방지). */
export async function requestProbe(now = Date.now()): Promise<Probe | null> {
  if (isProbeBusy(await latestProbe(), now)) return null;
  const [row] = await query<ProbeRow>(`insert into provider_probes default values returning ${COLUMNS}`);
  return toProbe(row);
}

/** Actions 가 시작할 때: 가장 최근의 대기 중 조회를 실행 중으로. 없으면(직접 실행) 새로 만든다. */
export async function startProbe(runUrl: string | null): Promise<Probe> {
  const [pending] = await query<ProbeRow>(
    `update provider_probes set state = 'running', run_url = $1, updated_at = now()
      where id = (select id from provider_probes where state = 'pending' order by id desc limit 1)
      returning ${COLUMNS}`,
    [runUrl],
  );
  if (pending) return toProbe(pending);
  const [created] = await query<ProbeRow>(
    `insert into provider_probes (state, run_url) values ('running', $1) returning ${COLUMNS}`,
    [runUrl],
  );
  return toProbe(created);
}

export async function finishProbe(
  id: number,
  result: { tools: McpTool[]; listings: Record<string, unknown>; claudeModels: ClaudeModelList },
): Promise<Probe> {
  const [row] = await query<ProbeRow>(
    `update provider_probes set state = 'done', tools = $2, listings = $3, claude_models = $4,
        error = null, updated_at = now()
      where id = $1 returning ${COLUMNS}`,
    [id, JSON.stringify(result.tools), JSON.stringify(result.listings), JSON.stringify(result.claudeModels)],
  );
  return toProbe(row);
}

/** 실패 기록. id 가 없으면 가장 최근의 대기·실행 중 조회를 실패로. */
export async function failProbe(message: string, id?: number): Promise<Probe | null> {
  const [row] = await query<ProbeRow>(
    `update provider_probes set state = 'failed', error = $2, updated_at = now()
      where id = coalesce($1, (select id from provider_probes where state in ('pending', 'running') order by id desc limit 1))
        and state in ('pending', 'running')
      returning ${COLUMNS}`,
    [id ?? null, redact(message).slice(0, 2000)],
  );
  return row ? toProbe(row) : null;
}

/** 인자 없이 부를 수 있는 목록 도구인가. */
export function isListingTool(tool: McpTool): boolean {
  return /^list_/.test(tool.name) && (tool.inputSchema?.required ?? []).length === 0;
}

/**
 * 실제 조회. 도구 하나가 실패해도 나머지는 계속하고, 그 실패는 결과에 남긴다.
 * Claude 모델 목록은 실패해도 ManyMotions 결과는 저장한다(설정 화면은 기본 모델로 동작).
 */
export async function collectCatalog(
  client: Pick<McpClient, "listTools" | "callTool">,
  listClaudeModels: () => Promise<{ id: string; label: string }[]>,
) {
  let claudeModels: ClaudeModelList;
  try {
    claudeModels = await listClaudeModels();
  } catch (error) {
    claudeModels = { error: error instanceof Error ? error.message : String(error) };
  }
  const tools = await client.listTools();
  const listings: Record<string, unknown> = {};
  for (const tool of tools.filter(isListingTool)) {
    try {
      listings[tool.name] = await client.callTool(tool.name, {});
    } catch (error) {
      listings[tool.name] = { error: error instanceof Error ? error.message : String(error) };
    }
  }
  const catalog = parseModelCatalog(listings);
  return { tools, listings, catalog, claudeModels, optionCount: countOptions(catalog) };
}
