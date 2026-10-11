import { describe, expect, it, vi } from "vitest";
import { McpClient, McpError, parseSse, toolResultValue } from "@/pipeline/providers/mcp";
import { createManyMotionsClient, readManyMotionsKey } from "@/pipeline/providers/manymotions";

type Call = { url: string; headers: Record<string, string>; body: { method?: string; id?: number; params?: unknown } };

/** 요청 순서대로 응답을 돌려주는 가짜 fetch. */
function fakeFetch(responses: ((call: Call) => Response)[]) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body)) };
    calls.push(call);
    const next = responses.shift();
    if (!next) throw new Error("예상하지 못한 요청");
    return next(call);
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

const json = (body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { headers: { "content-type": "application/json", ...headers } });
const sse = (body: unknown) =>
  new Response(`event: message\ndata: ${JSON.stringify(body)}\n\n`, { headers: { "content-type": "text/event-stream" } });
const accepted = () => new Response(null, { status: 202 });

describe("MCP 클라이언트", () => {
  it("initialize → initialized → tools/list, 세션 ID 와 인증 헤더를 붙인다", async () => {
    const { fn, calls } = fakeFetch([
      ({ body }) => json({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-06-18" } }, { "mcp-session-id": "s-1" }),
      () => accepted(),
      ({ body }) => sse({ jsonrpc: "2.0", id: body.id, result: { tools: [{ name: "list_models" }], nextCursor: "p2" } }),
      ({ body }) => json({ jsonrpc: "2.0", id: body.id, result: { tools: [{ name: "job_status" }] } }),
    ]);
    const client = createManyMotionsClient("cw_live_test", fn);
    expect((await client.listTools()).map((t) => t.name)).toEqual(["list_models", "job_status"]);

    expect(calls.map((c) => c.body.method)).toEqual(["initialize", "notifications/initialized", "tools/list", "tools/list"]);
    expect(calls[0].url).toBe("https://manymotions.com/api/mcp");
    expect(calls[0].headers.Authorization).toBe("Bearer cw_live_test");
    expect(calls[0].headers["Mcp-Session-Id"]).toBeUndefined();
    expect(calls[2].headers["Mcp-Session-Id"]).toBe("s-1");
    expect(calls[3].body.params).toEqual({ cursor: "p2" });
  });

  it("tools/call 결과: 텍스트 JSON 을 값으로, 초기화는 한 번만", async () => {
    const { fn, calls } = fakeFetch([
      ({ body }) => json({ jsonrpc: "2.0", id: body.id, result: {} }),
      () => accepted(),
      ({ body }) => json({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: '{"models":[1]}' }] } }),
      ({ body }) => json({ jsonrpc: "2.0", id: body.id, result: { structuredContent: { ok: true }, content: [] } }),
    ]);
    const client = new McpClient("https://mcp.example", {}, fn);
    expect(await client.callTool("list_models")).toEqual({ models: [1] });
    expect(await client.callTool("job_status", { job_id: "j" })).toEqual({ ok: true });
    expect(calls.filter((c) => c.body.method === "initialize")).toHaveLength(1);
    expect(calls[2].body.params).toEqual({ name: "list_models", arguments: {} });
  });

  it("HTTP 오류·JSON-RPC 오류·도구 오류를 McpError 로", async () => {
    const unauthorized = new McpClient("https://mcp.example", {}, fakeFetch([() => new Response("bad key", { status: 401 })]).fn);
    await expect(unauthorized.listTools()).rejects.toThrow(/401 bad key/);

    const rpcError = new McpClient(
      "https://mcp.example",
      {},
      fakeFetch([({ body }) => json({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "no method" } })]).fn,
    );
    await expect(rpcError.listTools()).rejects.toThrow(McpError);

    expect(() => toolResultValue({ isError: true, content: [{ type: "text", text: "크레딧 부족" }] })).toThrow("크레딧 부족");
    expect(toolResultValue({ content: [{ type: "text", text: "plain" }] })).toBe("plain");
  });

  it("SSE 에서 해당 id 의 응답만 고른다", () => {
    const body = 'data: {"jsonrpc":"2.0","method":"notifications/progress"}\n\ndata: {"jsonrpc":"2.0","id":7,"result":1}\n\n';
    expect(parseSse(body, 7)).toMatchObject({ result: 1 });
    expect(parseSse(body, 8)).toBeNull();
  });

  it("API 키가 없으면 등록 위치를 알려 준다", () => {
    expect(() => readManyMotionsKey({})).toThrow(/GitHub → Settings → Secrets/);
    expect(readManyMotionsKey({ MANYMOTIONS_API_KEY: "k" })).toBe("k");
  });
});
