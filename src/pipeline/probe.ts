import { query } from "@/lib/db";
import { redact } from "@/lib/health";
import { extractCatalog, type CatalogItem } from "@/pipeline/catalog";
import type { McpClient, McpTool } from "@/pipeline/providers/mcp";

// ManyMotions "모델 조회". 설정 화면 버튼 → Actions(probe) → 결과를 provider_probes 에 저장.
// 크레딧을 쓰지 않도록 이름이 list_ 로 시작하고 필수 인자가 없는 도구만 부른다.

export type ProbeState = "pending" | "running" | "done" | "failed";

export interface Probe {
  id: number;
  state: ProbeState;
  runUrl: string | null;
  tools: McpTool[] | null;
  listings: Record<string, unknown> | null;
  models: CatalogItem[] | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface ProbeRow {
  id: number;
  state: ProbeState;
  run_url: string | null;
  tools: McpTool[] | null;
  listings: Record<string, unknown> | null;
  models: CatalogItem[] | null;
  error: string | null;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS = "id, state, run_url, tools, listings, models, error, created_at, updated_at";
/** 이 시간이 지나도록 대기·실행 중이면 멈춘 것으로 보고 새 조회를 허용한다. */
export const PROBE_STALE_MS = 15 * 60 * 1000;

function toProbe(row: ProbeRow): Probe {
  return {
    id: row.id,
    state: row.state,
    runUrl: row.run_url,
    tools: row.tools,
    listings: row.listings,
    models: row.models,
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
  result: { tools: McpTool[]; listings: Record<string, unknown>; models: CatalogItem[] },
): Promise<Probe> {
  const [row] = await query<ProbeRow>(
    `update provider_probes set state = 'done', tools = $2, listings = $3, models = $4, error = null, updated_at = now()
      where id = $1 returning ${COLUMNS}`,
    [id, JSON.stringify(result.tools), JSON.stringify(result.listings), JSON.stringify(result.models)],
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

/** 실제 조회. 도구 하나가 실패해도 나머지는 계속하고, 그 실패는 결과에 남긴다. */
export async function collectCatalog(client: Pick<McpClient, "listTools" | "callTool">) {
  const tools = await client.listTools();
  const listings: Record<string, unknown> = {};
  for (const tool of tools.filter(isListingTool)) {
    try {
      listings[tool.name] = await client.callTool(tool.name, {});
    } catch (error) {
      listings[tool.name] = { error: error instanceof Error ? error.message : String(error) };
    }
  }
  return { tools, listings, models: extractCatalog(listings) };
}
