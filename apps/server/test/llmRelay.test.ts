import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LlmRelay, type RelayDeps } from "../src/providers/llm/relay.js";
import { registerLlmRelayRoutes } from "../src/api/llmRelay.js";
import { applyNewInstallGatewayDefault, getLlmGatewaySettings } from "../src/providers/llm/gatewaySettings.js";
import { createPipelineHarness } from "./pipelineFixtures.js";

const fixtures: ReturnType<typeof createPipelineHarness>[] = [];
afterEach(() => fixtures.splice(0).forEach((fixture) => fixture.close()));
const SERVER_KEY = "server-only-key-123456789";
const NODE = "vgn_goodtoken";
const AGENT_KEY = "agent-key-ok";
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const completion = (prompt = 10, completionTokens = 5) => ({ id: "x", choices: [{ message: { content: "xin chào" } }], usage: { prompt_tokens: prompt, completion_tokens: completionTokens } });

type QuotaFake = { isUnavailable: ReturnType<typeof vi.fn>; earliestRetryAt: ReturnType<typeof vi.fn>; kindOf: ReturnType<typeof vi.fn>; policyFor: ReturnType<typeof vi.fn>; todaySpendUsd: ReturnType<typeof vi.fn>; onQuotaFailure: ReturnType<typeof vi.fn>; recordCall: ReturnType<typeof vi.fn> };

function setup(options: { respond?: (url: string, init: RequestInit) => Response | Promise<Response>; key?: string | undefined; models?: string[] | Error } = {}) {
  const fixture = createPipelineHarness(); fixtures.push(fixture);
  fixture.sqlite.prepare("UPDATE projects SET workspace_id='A' WHERE id=?").run(fixture.projectId);
  const fetchImpl = vi.fn(async (url: unknown, init: RequestInit | undefined) => (options.respond ?? (() => json(completion())))(String(url), init ?? {}));
  const quota: QuotaFake = {
    isUnavailable: vi.fn(() => false), earliestRetryAt: vi.fn(() => null), kindOf: vi.fn(() => "free"),
    policyFor: vi.fn(() => ({ policy: {}, paidFallbackDailyUsd: 1, timeZone: "UTC" })), todaySpendUsd: vi.fn(() => 0),
    onQuotaFailure: vi.fn(() => ({ until: "" })), recordCall: vi.fn(),
  };
  const models = options.models ?? ["fast", "smart", "gpt-x"];
  const recordJobUsage = vi.fn();
  fixture.sqlite.prepare("INSERT INTO organization(id,name,slug,created_at) VALUES ('A','Fixture','fixture-a',0)").run();
  fixture.sqlite.prepare(`INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES ('u1','Fixture','fixture@example.invalid',1,0,0)`).run();
  fixture.sqlite.prepare("INSERT INTO member(id,organization_id,user_id,role,created_at) VALUES ('membership','A','u1','owner',0)").run();
  fixture.sqlite.prepare("INSERT INTO apikey (id, name, reference_id, key, enabled, created_at, updated_at, metadata) VALUES ('k1','k','u1','hash',1,1,1,?)")
    .run(JSON.stringify({ workspaceId: "A" }));
  fixture.sqlite.prepare("INSERT INTO agent_key_profiles (key_id,agent_kind,instance_name,can_supervise,updated_at) VALUES ('k1','hermes','alpha',0,'now')").run();
  fixture.sqlite.prepare("INSERT INTO apikey (id, name, reference_id, key, enabled, created_at, updated_at) VALUES ('k2','bare','u1','hash2',1,1,1)").run();
  const relay = new LlmRelay({
    sqlite: fixture.sqlite,
    config: { ...fixture.config, OMNIROUTE_API_KEY: "key" in options ? options.key : SERVER_KEY, OMNIROUTE_BASE_URL: "http://fixture.invalid/v1",
      LLM_PRICES_JSON: JSON.stringify(Object.fromEntries(["fast", "smart", "gpt-x"].map((id) => [`omniroute:${id}`, { inputPerMTok: 0, outputPerMTok: 0 }]))) },
    catalog: { getModels: async () => { if (models instanceof Error) throw models; return models.map((id) => ({ id, ownedBy: "fixture" })); }, peekModels: () => [] } as unknown as RelayDeps["catalog"],
    quota: () => quota as unknown as ReturnType<RelayDeps["quota"]>,
    verifyApiKey: async (key) => key === AGENT_KEY ? { valid: true, keyId: "k1" } : key === "bare-key" ? { valid: true, keyId: "k2" } : { valid: false },
    authenticateNode: (bearer) => bearer === NODE ? { id: "n1", name: "Máy một", workspace_id: "A" } : undefined,
    recordJobUsage, now: fixture.clock, fetchImpl: fetchImpl as typeof fetch,
  });
  return { ...fixture, relay, fetchImpl, quota, recordJobUsage };
}

async function appOf(h: ReturnType<typeof setup>) {
  const app = Fastify();
  app.addHook("onRequest", async (request) => {
    if (request.url.startsWith("/api/llm/relay-admin/")) Object.assign(request, { actor: { kind: "user", workspaceId: "A" } });
  });
  registerLlmRelayRoutes(app, h.relay, [SERVER_KEY]);
  await app.ready();
  return app;
}
const chat = (extra: object = {}) => ({ model: "fast", messages: [{ role: "user", content: "chào" }], ...extra });
const auth = (token: string) => ({ authorization: `Bearer ${token}` });

describe("LLM relay routes: identity", () => {
  it("checks current membership and the key workspace instead of trusting a stale profile", async () => {
    const h = setup(), app = await appOf(h);
    const send = (headers: Record<string, string> = auth(AGENT_KEY)) => app.inject({ method: "POST", url: "/api/llm/relay/v1/chat/completions", headers, payload: chat() });
    expect((await send({ ...auth(AGENT_KEY), "x-workspace-id": "B" })).statusCode).toBe(403);
    h.sqlite.prepare("UPDATE agent_key_profiles SET instance_name=? WHERE key_id='k1'").run(SERVER_KEY);
    expect((await send()).statusCode).toBe(403);
    h.sqlite.prepare("UPDATE agent_key_profiles SET instance_name='alpha' WHERE key_id='k1'").run();
    h.sqlite.prepare("UPDATE apikey SET metadata=? WHERE id='k1'").run(JSON.stringify({ workspaceId: "B" }));
    expect((await send()).statusCode).toBe(403);
    h.sqlite.prepare("UPDATE apikey SET metadata=? WHERE id='k1'").run(JSON.stringify({ workspaceId: "A" }));
    h.sqlite.prepare("DELETE FROM member WHERE id='membership'").run();
    expect((await send()).statusCode).toBe(403);
    expect(h.fetchImpl).not.toHaveBeenCalled();
  });
  it("answers 401 without a credential, 403 with a cookie only, 401 for a bad key", async () => {
    const app = await appOf(setup());
    expect((await app.inject({ method: "POST", url: "/api/llm/relay/v1/chat/completions", payload: chat() })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/llm/relay/v1/chat/completions", headers: { cookie: "s=1" }, payload: chat() })).statusCode).toBe(403);
    const bad = await app.inject({ method: "POST", url: "/api/llm/relay/v1/chat/completions", headers: auth("nope"), payload: chat() });
    expect(bad.statusCode).toBe(401);
    expect(bad.json().error).toMatchObject({ code: "RELAY_UNAUTHORIZED", type: "permission_error" });
  });
  it("rejects a valid key without an agent profile and a revoked node token", async () => {
    const app = await appOf(setup());
    expect((await app.inject({ method: "POST", url: "/api/llm/relay/v1/chat/completions", headers: auth("bare-key"), payload: chat() })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/llm/relay/v1/chat/completions", headers: auth("vgn_revoked"), payload: chat() })).statusCode).toBe(403);
  });
  it("accepts an agent key with a profile and a node token", async () => {
    const h = setup(); const app = await appOf(h);
    expect((await app.inject({ method: "POST", url: "/api/llm/relay/v1/chat/completions", headers: auth(AGENT_KEY), payload: chat() })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/llm/relay/v1/chat/completions", headers: auth(NODE), payload: chat() })).statusCode).toBe(200);
    const callers = (h.sqlite.prepare("SELECT caller FROM llm_relay_usage ORDER BY caller").all() as Array<{ caller: string }>).map((row) => row.caller);
    expect(callers).toEqual(["agent:hermes/alpha", "node:n1"]);
  });
});

describe("LLM relay routes: forwarding", () => {
  it("does not expose a key echoed in model metadata or a legacy grant", async () => {
    const h = setup({ models: ["fast", `echo-${SERVER_KEY}`] }), app = await appOf(h);
    h.sqlite.prepare("INSERT INTO llm_relay_grants(caller,workspace_id,models,updated_at) VALUES ('*','A',?,'fixture')")
      .run(JSON.stringify([`echo-${SERVER_KEY}`]));
    const status = await app.inject({ method: "GET", url: "/api/llm/relay-admin/status" });
    expect(status.body).not.toContain(SERVER_KEY);
    expect(status.json().defaultGrant.enabled).toBe(false);
    h.relay.saveGrant("*", { enabled: true, models: [] }, "A");
    const models = await app.inject({ method: "GET", url: "/api/llm/relay/v1/models", headers: auth(NODE) });
    expect(models.body).not.toContain(SERVER_KEY);
    expect(models.json().data.map((model: { id: string }) => model.id)).toEqual(["fast"]);
    const grant = await app.inject({ method: "PUT", url: "/api/llm/relay-admin/grants", payload: { caller: "*", models: [SERVER_KEY] } });
    expect(grant.statusCode).toBe(400); expect(grant.body).not.toContain(SERVER_KEY);
  });
  it("sends only fresh headers with the server key and never the caller's", async () => {
    const h = setup(); const app = await appOf(h);
    const res = await app.inject({ method: "POST", url: "/api/llm/relay/v1/chat/completions", headers: { ...auth(NODE), "x-forwarded-for": "9.9.9.9", "x-api-key": "leak", "x-custom": "1" }, payload: chat() });
    expect(res.statusCode).toBe(200);
    const [url, init] = h.fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("http://fixture.invalid/v1/chat/completions");
    const sent = init!.headers as Record<string, string>;
    expect(sent.authorization).toBe(`Bearer ${SERVER_KEY}`);
    expect(Object.keys(sent).sort()).toEqual(["accept", "authorization", "content-type"]);
    expect(JSON.stringify(sent)).not.toContain(NODE);
  });
  it("redacts the server key if upstream echoes it, in JSON and in error text", async () => {
    const h = setup({ respond: (_u, _i) => json({ ...completion(), echo: SERVER_KEY }) });
    const ok = await h.relay.relay("chat/completions", { caller: "node:n1", workspaceId: "A", label: "x", nodeId: "n1" }, chat());
    expect(String(ok.body)).not.toContain(SERVER_KEY);
    const err = setup({ respond: () => new Response(`bad ${SERVER_KEY}`, { status: 500 }) });
    const failed = await err.relay.relay("chat/completions", { caller: "node:n1", workspaceId: "A", label: "x", nodeId: "n1" }, chat());
    expect(failed.status).toBe(500);
    expect(String(failed.body)).not.toContain(SERVER_KEY);
  });
  it("never forwards a key hidden in upstream content-type or retry headers", async () => {
    const h = setup({ respond: () => new Response("busy", { status: 429,
      headers: { "content-type": `text/plain; echoed=${SERVER_KEY}`, "retry-after": SERVER_KEY } }) });
    const result = await h.relay.relay("chat/completions", { caller: "node:n1", workspaceId: "A", label: "x", nodeId: "n1" }, chat());
    expect(JSON.stringify(result)).not.toContain(SERVER_KEY);
    expect(result.contentType).toBe("text/plain; charset=utf-8");
    expect(result.headers).toEqual({});
  });
  it("streams server-sent events and aborts upstream when the client goes away", async () => {
    let upstreamSignal: AbortSignal | undefined;
    const h = setup({ respond: (_u, init) => { upstreamSignal = init.signal ?? undefined; return new Response('data: {"choices":[{"delta":{"content":"a"}}]}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } }); } });
    const app = await appOf(h);
    const res = await app.inject({ method: "POST", url: "/api/llm/relay/v1/chat/completions", headers: auth(NODE), payload: chat({ stream: true }) });
    expect(res.headers["content-type"]).toContain("text/event-stream");
    expect(res.body).toContain("[DONE]");
    expect(upstreamSignal?.aborted).toBe(true);
    const row = h.sqlite.prepare("SELECT estimated, status FROM llm_relay_usage").get();
    expect(row).toEqual({ estimated: 1, status: "ok" });
  });
  it("lists only the models the caller may use", async () => {
    const h = setup(); const app = await appOf(h);
    h.relay.saveGrant("node:n1", { models: ["fast", "gpt-*"] }, "A");
    const res = await app.inject({ method: "GET", url: "/api/llm/relay/v1/models", headers: auth(NODE) });
    expect(res.json().data.map((item: { id: string }) => item.id)).toEqual(["fast", "gpt-x"]);
  });
  it("answers 503 LLM_RELAY_UNAVAILABLE when the key is missing or the catalog fails", async () => {
    for (const h of [setup({ key: undefined }), setup({ models: new Error("down") })]) {
      const app = await appOf(h);
      const res = await app.inject({ method: "POST", url: "/api/llm/relay/v1/chat/completions", headers: auth(NODE), payload: chat() });
      expect(res.statusCode).toBe(503);
      expect(res.json().error.code).toBe("LLM_RELAY_UNAVAILABLE");
      expect((await app.inject({ method: "GET", url: "/api/llm/relay/v1/models", headers: auth(NODE) })).statusCode).toBe(503);
    }
  });
});

describe("LLM relay policy", () => {
  const rc = { caller: "node:n1", workspaceId: "A", label: "x", nodeId: "n1" };
  const refusal = (promise: Promise<unknown>, code: string) => expect(promise).rejects.toMatchObject({ code });
  it("refuses a disabled caller and a model outside the list", async () => {
    const h = setup();
    h.relay.saveGrant("node:n1", { enabled: false }, "A");
    await refusal(h.relay.relay("chat/completions", rc, chat()), "RELAY_DISABLED");
    h.relay.saveGrant("node:n1", { enabled: true, models: ["smart"] }, "A");
    await refusal(h.relay.relay("chat/completions", rc, chat()), "RELAY_MODEL_NOT_ALLOWED");
    expect(h.fetchImpl).not.toHaveBeenCalled();
    const codes = h.sqlite.prepare("SELECT code FROM llm_relay_usage WHERE status='refused' ORDER BY created_at").all();
    expect(codes).toEqual([{ code: "RELAY_DISABLED" }, { code: "RELAY_MODEL_NOT_ALLOWED" }]);
  });
  it("inherits the default row's model list when a caller's own list is empty", async () => {
    const h = setup();
    h.relay.saveGrant("*", { models: ["smart"] }, "A");
    await refusal(h.relay.relay("chat/completions", rc, chat()), "RELAY_MODEL_NOT_ALLOWED");
    expect((await h.relay.relay("chat/completions", rc, chat({ model: "smart" }))).status).toBe(200);
  });
  it("rate-limits per minute with retry-after and frees the window after sixty seconds", async () => {
    const h = setup();
    h.relay.saveGrant("node:n1", { rpm: 2 }, "A");
    await h.relay.relay("chat/completions", rc, chat());
    await h.relay.relay("chat/completions", rc, chat());
    const app = await appOf(h);
    const res = await app.inject({ method: "POST", url: "/api/llm/relay/v1/chat/completions", headers: auth(NODE), payload: chat() });
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe("RELAY_RATE_LIMITED");
    expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
    h.advance(61_000);
    expect((await h.relay.relay("chat/completions", rc, chat())).status).toBe(200);
  });
  it("stops at the daily budget and treats 0 as unlimited", async () => {
    const h = setup({ respond: () => json(completion(1_000_000, 1_000_000)) });
    h.relay.saveGrant("node:n1", { dailyUsdCap: 0.01 }, "A");
    h.sqlite.prepare("INSERT INTO llm_relay_usage (id,caller,workspace_id,model,job_id,input_tokens,output_tokens,cost_usd,estimated,status,code,latency_ms,created_at) VALUES ('u1','node:n1','A','fast',NULL,1,1,0.5,0,'ok',NULL,1,?)").run(h.clock().toISOString());
    await refusal(h.relay.relay("chat/completions", rc, chat()), "RELAY_BUDGET_EXCEEDED");
    h.relay.saveGrant("node:n1", { dailyUsdCap: 0 }, "A");
    expect((await h.relay.relay("chat/completions", rc, chat())).status).toBe(200);
  });
  it("honours the shared quota controller: cooled model and the paid daily limit", async () => {
    const h = setup();
    h.quota.isUnavailable.mockReturnValue(true);
    await refusal(h.relay.relay("chat/completions", rc, chat()), "RELAY_RATE_LIMITED");
    h.quota.isUnavailable.mockReturnValue(false);
    h.quota.kindOf.mockReturnValue("paid");
    h.quota.todaySpendUsd.mockReturnValue(5);
    await refusal(h.relay.relay("chat/completions", rc, chat()), "RELAY_BUDGET_EXCEEDED");
  });
  it("rejects a malformed request before any upstream call", async () => {
    const h = setup();
    await expect(h.relay.relay("chat/completions", rc, { messages: [] })).rejects.toMatchObject({ status: 400 });
    await expect(h.relay.relay("chat/completions", rc, [])).rejects.toMatchObject({ status: 400 });
  });
  it("cools the model for local callers when upstream answers 429", async () => {
    const h = setup({ respond: () => new Response("slow down", { status: 429, headers: { "retry-after": "30" } }) });
    const result = await h.relay.relay("chat/completions", rc, chat());
    expect(result.status).toBe(429);
    expect(result.headers["retry-after"]).toBe("30");
    expect(h.quota.onQuotaFailure).toHaveBeenCalledTimes(1);
    expect(h.quota.onQuotaFailure.mock.calls[0]![0]).toMatchObject({ provider: "omniroute", model: "fast" });
  });
});

describe("LLM relay usage", () => {
  const node = { caller: "node:n1", workspaceId: "A", label: "x", nodeId: "n1" };
  const agent = { caller: "agent:hermes/alpha", workspaceId: "A", label: "x", instance: "hermes/alpha" };
  function job(h: ReturnType<typeof setup>, id: string, patch: { nodeId?: string; leaseUntil?: string; status?: string } = {}) {
    const now = h.clock().toISOString();
    h.sqlite.prepare(`INSERT INTO jobs (id, project_id, stage, status, progress, attempt, max_attempts, error, created_at, run_after, previous_state, node_id, lease_until)
      VALUES (?, ?, 'SCRIPT', ?, 0, 1, 3, NULL, ?, ?, 'PENDING', ?, ?)`).run(id, h.projectId, patch.status ?? "RUNNING", now, now, patch.nodeId ?? null, patch.leaseUntil ?? null);
  }
  it("records real tokens from a JSON answer and estimates when usage is absent", async () => {
    const real = setup();
    await real.relay.relay("chat/completions", node, chat());
    expect(real.sqlite.prepare("SELECT input_tokens,output_tokens,estimated FROM llm_relay_usage").get()).toEqual({ input_tokens: 10, output_tokens: 5, estimated: 0 });
    const guess = setup({ respond: () => json({ choices: [{ message: { content: "một hai ba bốn năm" } }] }) });
    await guess.relay.relay("chat/completions", node, chat());
    const row = guess.sqlite.prepare("SELECT input_tokens,output_tokens,estimated FROM llm_relay_usage").get() as { estimated: number; output_tokens: number };
    expect(row.estimated).toBe(1);
    expect(row.output_tokens).toBeGreaterThan(0);
  });
  it("counts a relayed call once on the job it is leased to (node)", async () => {
    const h = setup();
    job(h, "11111111-1111-4111-8111-111111111111", { nodeId: "n1", leaseUntil: "2026-12-01T00:00:00.000Z" });
    await h.relay.relay("chat/completions", node, chat(), { jobId: "11111111-1111-4111-8111-111111111111" });
    expect(h.recordJobUsage).toHaveBeenCalledTimes(1);
    expect(h.recordJobUsage.mock.calls[0]![1]).toMatchObject({ llmCalls: 1, inputTokens: 10, outputTokens: 5, provider: "relay:node:n1" });
    expect(h.sqlite.prepare("SELECT job_id FROM llm_relay_usage").get()).toEqual({ job_id: "11111111-1111-4111-8111-111111111111" });
  });
  it("ignores a job that belongs to another node, is not running, or whose lease ended", async () => {
    const h = setup();
    job(h, "22222222-2222-4222-8222-222222222221", { nodeId: "other", leaseUntil: "2026-12-01T00:00:00.000Z" });
    job(h, "22222222-2222-4222-8222-222222222222", { nodeId: "n1", leaseUntil: "2026-12-01T00:00:00.000Z", status: "QUEUED" });
    job(h, "22222222-2222-4222-8222-222222222223", { nodeId: "n1", leaseUntil: "2026-01-01T00:00:00.000Z" });
    job(h, "22222222-2222-4222-8222-222222222224", { nodeId: "n1" });
    for (const id of ["22222222-2222-4222-8222-222222222221", "22222222-2222-4222-8222-222222222222", "22222222-2222-4222-8222-222222222223", "22222222-2222-4222-8222-222222222224", "missing"]) {
      await h.relay.relay("chat/completions", node, chat(), { jobId: id });
    }
    expect(h.recordJobUsage).not.toHaveBeenCalled();
  });
  it("does not attribute a matching node lease from a foreign project workspace", async () => {
    const h = setup(), id = "44444444-4444-4444-8444-444444444444";
    job(h, id, { nodeId: "n1", leaseUntil: "2026-12-01T00:00:00.000Z" });
    h.sqlite.prepare("UPDATE projects SET workspace_id='B' WHERE id=?").run(h.projectId);
    await h.relay.relay("chat/completions", node, chat(), { jobId: id });
    expect(h.recordJobUsage).not.toHaveBeenCalled();
    expect(h.sqlite.prepare("SELECT job_id FROM llm_relay_usage").get()).toEqual({ job_id: null });
  });
  it("attributes an agent's call to a job only when it holds the lease", async () => {
    const h = setup();
    const id = "33333333-3333-4333-8333-333333333333";
    job(h, id);
    await h.relay.relay("chat/completions", agent, chat(), { jobId: id });
    expect(h.recordJobUsage).not.toHaveBeenCalled();
    h.sqlite.prepare("INSERT INTO agent_leases (resource_kind,resource_id,holder_kind,holder_instance,rank,fence,run_id,acquired_at,expires_at,preempted_by) VALUES ('job',?,'hermes','hermes/alpha',1,1,'r','now',?,NULL)")
      .run(id, "2026-12-01T00:00:00.000Z");
    await h.relay.relay("chat/completions", agent, chat(), { jobId: id });
    expect(h.recordJobUsage).toHaveBeenCalledTimes(1);
  });
  it("shows today's usage and the last refusal in the status view", async () => {
    const h = setup();
    h.relay.saveGrant("node:n1", { models: ["smart"] }, "A");
    await h.relay.relay("chat/completions", node, chat({ model: "smart" }));
    await h.relay.relay("chat/completions", node, chat()).catch(() => undefined);
    const status = await h.relay.status("A");
    expect(status).toMatchObject({ configured: true, reachable: true, modelCount: 3 });
    expect(status.callers.find((row) => row.caller === "node:n1")).toMatchObject({ calls: 1, refused: 1, lastRefusal: "RELAY_MODEL_NOT_ALLOWED" });
    expect(JSON.stringify(status)).not.toContain(SERVER_KEY);
  });
});

describe("LLM relay admin routes", () => {
  it("saves and deletes grants, keeps the default row, and rejects odd caller ids", async () => {
    const h = setup(); const app = await appOf(h);
    const put = (payload: object) => app.inject({ method: "PUT", url: "/api/llm/relay-admin/grants", payload });
    expect((await put({ caller: "node:n1", rpm: 5 })).statusCode).toBe(200);
    expect(h.relay.grantOf("node:n1", "A").rpm).toBe(5);
    expect((await put({ caller: "bad caller" })).statusCode).toBe(400);
    expect((await app.inject({ method: "DELETE", url: "/api/llm/relay-admin/grants?caller=*" })).statusCode).toBe(400);
    expect((await app.inject({ method: "DELETE", url: "/api/llm/relay-admin/grants?caller=node:n1" })).json()).toEqual({ deleted: true });
    expect(h.relay.grantOf("node:n1", "A").rpm).toBe(30);
  });
});

describe("gateway default for new installs", () => {
  it("switches to OmniRoute-only once when there is a key, models and no projects", () => {
    const h = createPipelineHarness(); fixtures.push(h);
    h.sqlite.prepare("DELETE FROM projects").run();
    expect(applyNewInstallGatewayDefault(h.sqlite, { hasKey: false, modelCount: 3 })).toBe(false);
    expect(applyNewInstallGatewayDefault(h.sqlite, { hasKey: true, modelCount: 0 })).toBe(false);
    expect(applyNewInstallGatewayDefault(h.sqlite, { hasKey: true, modelCount: 3 })).toBe(true);
    expect(getLlmGatewaySettings(h.sqlite).mode).toBe("only");
    expect(applyNewInstallGatewayDefault(h.sqlite, { hasKey: true, modelCount: 3 })).toBe(false);
  });
  it("leaves an install that already has projects alone", () => {
    const h = createPipelineHarness(); fixtures.push(h);
    expect(applyNewInstallGatewayDefault(h.sqlite, { hasKey: true, modelCount: 3 })).toBe(false);
    expect(getLlmGatewaySettings(h.sqlite).mode).not.toBe("only");
  });
});
