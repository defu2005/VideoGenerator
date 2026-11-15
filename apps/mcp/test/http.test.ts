import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import { createHttpMcpHandler, type SessionFactory } from "../src/http.js";

const initialize = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "fixture", version: "1" } } };
const catalog = [
  { name: "list_projects", description: "Read projects", risk: "read" },
  { name: "hermes_duty_heartbeat", description: "Duty", risk: "safe" },
];
const opened: ReturnType<typeof createHttpMcpHandler>[] = [];
afterEach(async () => { await Promise.all(opened.splice(0).map((item) => item.close())); vi.unstubAllEnvs(); });

function setup() {
  let next = 0;
  const calls: Array<{ key: string | null; body: unknown; workspace: string | null }> = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    if (headers.get("x-api-key") === "invalid") return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
    if (String(input).endsWith("/api/registry/tools")) return Response.json({ tools: catalog });
    await Promise.resolve(); // Deliberately interleave concurrent clients' async contexts.
    calls.push({ key: headers.get("x-api-key"), body: JSON.parse(String(init?.body)), workspace: headers.get("x-workspace-id") });
    expect(headers.get("x-vg-tool-source")).toBe("agent");
    return Response.json({ result: "ok" });
  }) as typeof fetch;
  const createSession: SessionFactory = async ({ api, catalog: received, initialized, closed }) => {
    expect(received).toEqual(catalog);
    const id = `session-${++next}`;
    const close = async () => { closed(); };
    return { close, transport: { close, handleRequest: async (_req, res, body) => {
      if ((body as { method?: string })?.method === "initialize") {
        initialized(id);
        res.writeHead(200, { "mcp-session-id": id }); res.end(JSON.stringify({ id }));
      } else {
        const result = await api.invokeRegistry("list_projects", {});
        res.writeHead(200); res.end(JSON.stringify(result));
      }
    } } };
  };
  const app = createHttpMcpHandler({ fetchImpl, createSession });
  opened.push(app);
  return { app, calls, fetchImpl };
}

async function request(app: ReturnType<typeof createHttpMcpHandler>, input: { key?: string; session?: string; workspace?: string; body?: unknown; path?: string; origin?: string; method?: string } = {}) {
  const req = Object.assign(Readable.from(input.body === undefined ? [] : [JSON.stringify(input.body)]), {
    url: input.path ?? "/mcp", method: input.method ?? "POST", headers: {
      host: "fixture.local", ...(input.key ? { authorization: `Bearer ${input.key}` } : {}),
      ...(input.session ? { "mcp-session-id": input.session } : {}),
      ...(input.workspace ? { "x-workspace-id": input.workspace } : {}),
      ...(input.origin ? { origin: input.origin } : {}),
    },
  }) as unknown as IncomingMessage;
  const result = { status: 0, headers: {} as Record<string, string>, body: "" };
  const res = {
    headersSent: false,
    writeHead(status: number, headers: Record<string, string> = {}) { this.headersSent = true; result.status = status; result.headers = headers; },
    end(body = "") { result.body = body; },
  } as unknown as ServerResponse;
  await app.handler(req, res);
  return result;
}

it("rejects missing and invalid credentials without reading the local service key", async () => {
  vi.stubEnv("VG_API_KEY", "privileged-local-key");
  const { app, fetchImpl } = setup();
  expect((await request(app, { body: initialize })).status).toBe(401);
  expect(fetchImpl).not.toHaveBeenCalled();
  expect((await request(app, { key: "invalid", body: initialize })).status).toBe(401);
  expect((await request(app, { key: "A", body: initialize, origin: "https://evil.test" })).status).toBe(403);
});

it("keeps clients and workspace contexts separate and passes the current request's own key to the API", async () => {
  vi.stubEnv("VG_API_KEY", "never-use-this");
  vi.stubEnv("VG_WORKSPACE_ID", "never-use-this-workspace");
  const { app, calls } = setup();
  const [a, b] = await Promise.all([
    request(app, { key: "A", workspace: "one", body: initialize }),
    request(app, { key: "B", workspace: "two", body: initialize }),
  ]);
  expect(a.headers["mcp-session-id"]).not.toBe(b.headers["mcp-session-id"]);
  await Promise.all([
    request(app, { key: "A", workspace: "one", session: a.headers["mcp-session-id"], body: { method: "tools/call" } }),
    request(app, { key: "B", workspace: "two", session: b.headers["mcp-session-id"], body: { method: "tools/call" } }),
  ]);
  expect(calls).toEqual(expect.arrayContaining([
    { key: "A", workspace: "one", body: { name: "list_projects", args: {} } },
    { key: "B", workspace: "two", body: { name: "list_projects", args: {} } },
  ]));
  expect((await request(app, { key: "B", workspace: "one", session: a.headers["mcp-session-id"], body: {} })).status).toBe(404);
  expect((await request(app, { key: "A", workspace: "two", session: a.headers["mcp-session-id"], body: {} })).status).toBe(404);
  expect(app.status()).toMatchObject({ up: true, toolCount: 2, toolHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
});

it("bounds requests and expires deleted sessions", async () => {
  const { app } = setup();
  expect((await request(app, { key: "A", body: {} })).status).toBe(400);
  expect((await request(app, { key: "A", body: { text: "x".repeat(1_048_576) } })).status).toBe(413);
  const a = await request(app, { key: "A", body: initialize });
  await request(app, { key: "A", session: a.headers["mcp-session-id"], method: "DELETE" });
  expect((await request(app, { key: "A", session: a.headers["mcp-session-id"], body: {} })).status).toBe(404);
});
