// 최소한의 MCP 클라이언트 (Streamable HTTP, JSON-RPC 2.0).
// ManyMotions 는 REST 엔드포인트가 일부 모델에만 있어서 나머지를 MCP 로 부른다(docs/plan.md 5장).
//
//   initialize → notifications/initialized → tools/list · tools/call
//
// 응답은 application/json 이거나 text/event-stream(SSE) 일 수 있다. 서버가 Mcp-Session-Id 를
// 주면 이후 요청에 그대로 붙인다.

const PROTOCOL_VERSION = "2025-06-18";

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: { type?: string; properties?: Record<string, unknown>; required?: string[] };
}

export class McpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpError";
  }
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/** SSE 본문에서 JSON-RPC 응답(해당 id)을 찾는다. */
export function parseSse(body: string, id: number): JsonRpcResponse | null {
  for (const event of body.split(/\r?\n\r?\n/)) {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) continue;
    try {
      const message = JSON.parse(data) as JsonRpcResponse;
      if (message.id === id) return message;
    } catch {
      // 다른 형식의 이벤트는 건너뛴다.
    }
  }
  return null;
}

/** tools/call 결과를 값으로 바꾼다: structuredContent 가 있으면 그것, 아니면 텍스트(JSON 이면 파싱). */
export function toolResultValue(result: unknown): unknown {
  const r = (result ?? {}) as {
    isError?: boolean;
    structuredContent?: unknown;
    content?: { type: string; text?: string }[];
  };
  const text = (r.content ?? [])
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n");
  if (r.isError) throw new McpError(text || "도구 실행이 실패했습니다.");
  if (r.structuredContent !== undefined) return r.structuredContent;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export class McpClient {
  private nextId = 1;
  private sessionId: string | null = null;
  private initialized: Promise<void> | null = null;

  constructor(
    private readonly url: string,
    private readonly headers: Record<string, string>,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 60_000,
  ) {}

  private async post(body: object, expectResponse: number | null): Promise<JsonRpcResponse | null> {
    const response = await this.fetchImpl(this.url, {
      method: "POST",
      headers: {
        ...this.headers,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": PROTOCOL_VERSION,
        ...(this.sessionId ? { "Mcp-Session-Id": this.sessionId } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const session = response.headers.get("mcp-session-id");
    if (session) this.sessionId = session;

    const text = await response.text();
    if (!response.ok) {
      throw new McpError(`MCP 요청 실패: ${response.status} ${text.slice(0, 300) || response.statusText}`);
    }
    if (expectResponse === null) return null;

    const contentType = response.headers.get("content-type") ?? "";
    const message = contentType.includes("text/event-stream")
      ? parseSse(text, expectResponse)
      : (JSON.parse(text) as JsonRpcResponse);
    if (!message) throw new McpError("MCP 응답을 찾지 못했습니다.");
    if (message.error) throw new McpError(`MCP 오류 ${message.error.code}: ${message.error.message}`);
    return message;
  }

  private async request(method: string, params?: object): Promise<unknown> {
    const id = this.nextId++;
    const message = await this.post({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) }, id);
    return message?.result;
  }

  private ensureInitialized(): Promise<void> {
    this.initialized ??= (async () => {
      await this.request("initialize", {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "shorts-workflow", version: "0.1.0" },
      });
      await this.post({ jsonrpc: "2.0", method: "notifications/initialized" }, null);
    })();
    return this.initialized;
  }

  async listTools(): Promise<McpTool[]> {
    await this.ensureInitialized();
    const tools: McpTool[] = [];
    let cursor: string | undefined;
    do {
      const result = (await this.request("tools/list", cursor ? { cursor } : {})) as {
        tools?: McpTool[];
        nextCursor?: string;
      };
      tools.push(...(result?.tools ?? []));
      cursor = result?.nextCursor;
    } while (cursor);
    return tools;
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    await this.ensureInitialized();
    return toolResultValue(await this.request("tools/call", { name, arguments: args }));
  }
}
