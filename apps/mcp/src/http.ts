import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { VideoAgentApiClient, VideoAgentApiError } from "./apiClient.js";
import { registerVideoAgentTools, type RegistryCatalogTool } from "./tools.js";

type Credentials = { key: string; workspaceId?: string };
type Session = { fingerprint: string; lastSeen: number; catalogHash: string; transport: HttpTransport; close: () => Promise<void>; updateCatalog?: (catalog: RegistryCatalogTool[]) => void };
export type HttpTransport = Pick<StreamableHTTPServerTransport, "handleRequest" | "close">;
export type SessionFactory = (input: { api: VideoAgentApiClient; catalog: RegistryCatalogTool[]; initialized: (id: string) => void; closed: () => void }) => Promise<{ transport: HttpTransport; close: () => Promise<void>; updateCatalog?: (catalog: RegistryCatalogTool[]) => void }>;
const MAX_BODY_BYTES = 1_048_576;
const SESSION_IDLE_MS = 30 * 60_000;

/** Keys live only in this request's async context; session state retains a digest, never the key. */
export function createHttpMcpHandler(options: { apiUrl?: string; fetchImpl?: typeof fetch; createSession?: SessionFactory; maxSessions?: number } = {}) {
  const context = new AsyncLocalStorage<Credentials>();
  const sessions = new Map<string, Session>();
  let catalogState = { up: true, toolCount: 0, toolHash: "" };
  const api = new VideoAgentApiClient(options.apiUrl, options.fetchImpl, {
    apiKey: () => context.getStore()?.key,
    workspaceId: () => context.getStore()?.workspaceId,
    toolSource: "agent",
  });
  const createSession: SessionFactory = options.createSession ?? (async ({ api, catalog, initialized, closed }) => {
    const server = new McpServer({ name: "video-agent-mcp", version: "0.1.0" });
    const updateCatalog = registerVideoAgentTools(server, api, catalog, { operatorOnly: true });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID, onsessioninitialized: initialized });
    await server.connect(transport);
    const onclose = transport.onclose;
    transport.onclose = () => { onclose?.(); closed(); };
    return { transport, close: () => server.close(), updateCatalog: updateCatalog || undefined };
  });
  function json(response: ServerResponse, status: number, body: unknown) {
    response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify(body));
  }
  async function handler(request: IncomingMessage, response: ServerResponse) {
    const path = request.url?.split("?")[0];
    if (path === "/health" && request.method === "GET") { json(response, 200, catalogState); return; }
    if (path !== "/mcp") { json(response, 404, { error: "NOT_FOUND" }); return; }
    if (!["GET", "POST", "DELETE"].includes(request.method ?? "")) { json(response, 405, { error: "METHOD_NOT_ALLOWED" }); return; }
    const auth = request.headers.authorization;
    const bearer = typeof auth === "string" ? /^Bearer\s+([^\s]+)$/i.exec(auth)?.[1] : undefined;
    const headerKey = typeof request.headers["x-api-key"] === "string" ? request.headers["x-api-key"].trim() : undefined;
    const key = bearer ?? headerKey;
    if (!key || (bearer && headerKey && bearer !== headerKey)) { json(response, 401, { error: "UNAUTHORIZED" }); return; }
    // Browser cross-origin calls must not use a remote MCP as a confused deputy.
    if (request.headers.origin) {
      try { if (new URL(request.headers.origin).host !== request.headers.host) { json(response, 403, { error: "ORIGIN_REJECTED" }); return; } }
      catch { json(response, 403, { error: "ORIGIN_REJECTED" }); return; }
    }
    const workspaceId = typeof request.headers["x-workspace-id"] === "string" ? request.headers["x-workspace-id"].trim() : undefined;
    const fingerprint = createHash("sha256").update(JSON.stringify([key, workspaceId ?? ""])).digest("hex");
    await context.run({ key, workspaceId }, async () => {
      let created: Session | undefined;
      try {
        let body: unknown;
        if (request.method === "POST") {
          const chunks: Buffer[] = [];
          let length = 0;
          for await (const chunk of request) {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            length += buffer.length;
            if (length > MAX_BODY_BYTES) { json(response, 413, { error: "BODY_TOO_LARGE" }); return; }
            chunks.push(buffer);
          }
          try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
          catch { json(response, 400, { error: "INVALID_JSON" }); return; }
        }
        for (const [id, session] of sessions) if (session.lastSeen < Date.now() - SESSION_IDLE_MS) {
          sessions.delete(id); await session.close();
        }
        const id = typeof request.headers["mcp-session-id"] === "string" ? request.headers["mcp-session-id"] : undefined;
        let session = id ? sessions.get(id) : undefined;
        if (id && (!session || session.fingerprint !== fingerprint)) { json(response, 404, { error: "SESSION_NOT_FOUND" }); return; }
        // Validate every request at the API, including tools/list and long-lived sessions.
        const catalog = (await api.listRegistryTools()).tools;
        const catalogHash = createHash("sha256").update(JSON.stringify([...catalog].sort((a, b) => a.name.localeCompare(b.name)))).digest("hex");
        catalogState = { up: true, toolCount: catalog.length, toolHash: catalogHash };
        if (!session) {
          if (request.method !== "POST" || !isInitializeRequest(body)) { json(response, 400, { error: "INITIALIZE_REQUIRED" }); return; }
          if (sessions.size >= (options.maxSessions ?? 100)) { json(response, 503, { error: "SESSION_LIMIT" }); return; }
          // API validates this caller's own key, role and workspace before exposing its registry.
          let sessionId: string | undefined;
          const built = await createSession({ api, catalog, initialized: (newId) => { sessionId = newId; sessions.set(newId, created!); }, closed: () => { if (sessionId) sessions.delete(sessionId); } });
          session = created = { ...built, fingerprint, lastSeen: Date.now(), catalogHash };
        } else if (session.catalogHash !== catalogHash) {
          session.updateCatalog?.(catalog);
          session.catalogHash = catalogHash;
        }
        session.lastSeen = Date.now();
        await session.transport.handleRequest(request, response, body);
        if (request.method === "DELETE" && id) { sessions.delete(id); await session.close(); }
        // An unsuccessful initialize must not leave a connected server behind.
        if (created && ![...sessions.values()].includes(created)) await created.close();
      } catch (error) {
        if (created) await created.close().catch(() => undefined);
        if (!response.headersSent) json(response, error instanceof VideoAgentApiError && (error.statusCode === 401 || error.statusCode === 403) ? error.statusCode : 502, { error: "MCP_REQUEST_FAILED" });
        else response.end();
      }
    });
  }
  return { handler, status: () => ({ ...catalogState }), close: async () => { const pending = [...sessions.values()]; sessions.clear(); await Promise.all(pending.map((s) => s.close())); } };
}

export function startHttpMcp(port: number, host = process.env.VG_MCP_HTTP_HOST ?? "127.0.0.1") {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("VG_MCP_HTTP_PORT không hợp lệ");
  const mcp = createHttpMcpHandler();
  const http = createServer((req, res) => { void mcp.handler(req, res); });
  http.requestTimeout = 120_000;
  http.headersTimeout = 15_000;
  http.on("close", () => { void mcp.close(); });
  http.listen(port, host);
  return http;
}
