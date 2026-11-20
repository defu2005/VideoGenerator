import { afterEach, describe, expect, it, vi } from "vitest";
import { LlmRelay, type RelayDeps } from "../src/providers/llm/relay.js";
import { createPipelineHarness } from "./pipelineFixtures.js";
import { UsageService } from "../src/services/usageService.js";

const fixtures: ReturnType<typeof createPipelineHarness>[] = [];
afterEach(() => fixtures.splice(0).forEach((fixture) => fixture.close()));
const model = "accounting-fixture-model";
const caller = { caller: "node:accounting-node", workspaceId: "A", label: "Accounting fixture", nodeId: "accounting-node" };
const prices = JSON.stringify({ [`omniroute:${model}`]: { inputPerMTok: 100, outputPerMTok: 100 } });
const chat = { model, messages: [{ role: "user", content: "fixture" }], max_tokens: 1000 };
const usageEvent = 'data: {"choices":[],"usage":{"prompt_tokens":20,"completion_tokens":1000}}\n\n';

function setup(respond: () => Response | Promise<Response>, priceJson = prices, options: { timeoutMs?: number; contextWindow?: number } = {}) {
  const fixture = createPipelineHarness(); fixtures.push(fixture);
  fixture.sqlite.prepare("UPDATE projects SET workspace_id = 'A' WHERE id = ?").run(fixture.projectId);
  const quota = {
    isUnavailable: vi.fn(() => false), earliestRetryAt: vi.fn(() => null), kindOf: vi.fn(() => "paid"),
    policyFor: vi.fn(() => ({ policy: {}, paidFallbackDailyUsd: 10, timeZone: "UTC" })),
    todaySpendUsd: vi.fn(() => 0), onQuotaFailure: vi.fn(), recordCall: vi.fn(),
  };
  const fetchImpl = vi.fn(async () => respond());
  const recordJobUsage = vi.fn();
  const relay = new LlmRelay({
    sqlite: fixture.sqlite,
    config: { ...fixture.config, OMNIROUTE_API_KEY: "fixture-server-secret", OMNIROUTE_BASE_URL: "http://fixture.invalid/v1", LLM_PRICES_JSON: priceJson,
      LLM_TIMEOUT_MS: options.timeoutMs ?? fixture.config.LLM_TIMEOUT_MS },
    catalog: { getModels: async () => [{ id: model, ownedBy: "fixture", ...(options.contextWindow ? { contextWindow: options.contextWindow } : {}) }], peekModels: () => [] } as unknown as RelayDeps["catalog"],
    quota: () => quota as unknown as ReturnType<RelayDeps["quota"]>,
    verifyApiKey: async () => ({ valid: false }), authenticateNode: () => undefined,
    recordJobUsage, fetchImpl: fetchImpl as typeof fetch, now: fixture.clock,
  });
  const now = fixture.clock().toISOString();
  fixture.sqlite.prepare(`INSERT INTO jobs (id, project_id, stage, status, progress, attempt, max_attempts, error,
    created_at, run_after, previous_state, node_id, lease_until)
    VALUES ('accounting-job', ?, 'SCRIPT', 'RUNNING', 0, 1, 3, NULL, ?, ?, 'PENDING', ?, ?)`)
    .run(fixture.projectId, now, now, caller.nodeId, new Date(fixture.clock().getTime() + 60_000).toISOString());
  return { ...fixture, relay, quota, fetchImpl, recordJobUsage };
}

describe("relay cost and failure accounting regressions", () => {
  it("applies the shared paid cap to completed calls without jobs across callers", async () => {
    const h = setup(() => Response.json({ usage: { prompt_tokens: 20, completion_tokens: 1000 }, choices: [] }));
    const usage = new UsageService(h.sqlite, 25000);
    h.quota.policyFor.mockReturnValue({ policy: {}, paidFallbackDailyUsd: 0.15, timeZone: "UTC" });
    h.quota.todaySpendUsd.mockImplementation(() => usage.getAppUsage({ from: "2026-11-03", to: "2026-11-03", groupBy: "day" }).totals.costUsd);
    await h.relay.relay("chat/completions", caller, chat);
    await expect(h.relay.relay("chat/completions", { ...caller, caller: "node:another", nodeId: "another" }, chat))
      .rejects.toMatchObject({ code: "RELAY_BUDGET_EXCEEDED" });
    expect(h.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not treat previously unknown completed spend as zero after a finite cap is enabled", async () => {
    const h = setup(() => Response.json({}));
    h.sqlite.prepare(`INSERT INTO llm_relay_usage(id,caller,workspace_id,model,cost_usd,status,created_at)
      VALUES ('unknown-before-cap',?,'A','old-unpriced',NULL,'ok',?)`).run(caller.caller, h.clock().toISOString());
    await expect(h.relay.relay("chat/completions", caller, chat)).rejects.toMatchObject({ code: "RELAY_BUDGET_EXCEEDED" });
    expect(h.fetchImpl).not.toHaveBeenCalled();
  });

  it("uses the quota policy timezone for the daily caller ledger", () => {
    const h = setup(() => Response.json({}));
    h.quota.policyFor.mockReturnValue({ policy: {}, paidFallbackDailyUsd: 10, timeZone: "America/Los_Angeles" });
    const insert = h.sqlite.prepare(`INSERT INTO llm_relay_usage(id,caller,workspace_id,model,cost_usd,status,created_at)
      VALUES (?,?,'A',?,?,'ok',?)`);
    insert.run("before-local-midnight", caller.caller, model, 1, "2026-11-02T07:00:00.000Z");
    insert.run("after-local-midnight", caller.caller, model, 2, "2026-11-02T09:00:00.000Z");
    expect(h.relay.spentToday(caller.caller, "A")).toBe(2);
  });
  it("includes tool schemas in admission rather than only the messages", async () => {
    const h = setup(() => Response.json({}));
    h.relay.saveGrant(caller.caller, { tpm: 2000 }, caller.workspaceId);
    await expect(h.relay.relay("chat/completions", caller, { ...chat,
      tools: [{ type: "function", function: { name: "fixture", description: "x".repeat(5000) } }] }))
      .rejects.toMatchObject({ code: "RELAY_RATE_LIMITED" });
    expect(h.fetchImpl).not.toHaveBeenCalled();
  });

  it("bounds image input by the model context and rejects images without that metadata", async () => {
    const request = { ...chat, messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "https://fixture.invalid/image" } }] }] };
    const bounded = setup(() => Response.json({}), prices, { contextWindow: 1000 });
    bounded.relay.saveGrant(caller.caller, { tpm: 1500 }, caller.workspaceId);
    await expect(bounded.relay.relay("chat/completions", caller, request)).rejects.toMatchObject({ code: "RELAY_RATE_LIMITED" });
    const unknown = setup(() => Response.json({}));
    await expect(unknown.relay.relay("chat/completions", caller, request)).rejects.toMatchObject({ code: "RELAY_BAD_REQUEST" });
    expect(bounded.fetchImpl).not.toHaveBeenCalled(); expect(unknown.fetchImpl).not.toHaveBeenCalled();
  });

  it("retains the admitted estimate for all choices when the provider omits usage", async () => {
    const h = setup(() => Response.json({ choices: [{ message: { tool_calls: [{ function: { arguments: "x" } }] } }, { message: { content: "y" } }] }));
    h.relay.saveGrant(caller.caller, { dailyUsdCap: 0.3 }, caller.workspaceId);
    await h.relay.relay("chat/completions", caller, { ...chat, n: 2 });
    expect(h.sqlite.prepare("SELECT output_tokens,estimated FROM llm_relay_usage").get()).toEqual({ output_tokens: 2000, estimated: 1 });
    await expect(h.relay.relay("chat/completions", caller, { ...chat, n: 2 })).rejects.toMatchObject({ code: "RELAY_BUDGET_EXCEEDED" });
    expect(h.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reconciles a previous process's pending reservation conservatively and exactly once", () => {
    const h = setup(() => Response.json({}));
    h.sqlite.prepare(`INSERT INTO llm_relay_usage(id,caller,workspace_id,model,job_id,input_tokens,output_tokens,cost_usd,estimated,status,created_at)
      VALUES ('interrupted',?,'A',?,'accounting-job',20,1000,0.102,1,'pending','2026-11-02T00:00:00.000Z')`).run(caller.caller, model);
    expect(h.relay.recoverPending()).toBe(1);
    expect(h.relay.recoverPending()).toBe(0);
    expect(h.sqlite.prepare("SELECT cost_usd,estimated,status,code FROM llm_relay_usage").get())
      .toEqual({ cost_usd: 0.102, estimated: 1, status: "error", code: "RELAY_PROCESS_RESTART" });
    expect(h.recordJobUsage).toHaveBeenCalledTimes(1);
    expect(h.quota.recordCall).toHaveBeenCalledTimes(1);
  });

  it("settles a stream timeout even when nobody consumes its body", async () => {
    const h = setup(() => new Response(new ReadableStream({ start() { /* holds the fixture stream open */ } }),
      { headers: { "content-type": "text/event-stream" } }), prices, { timeoutMs: 20 });
    const response = await h.relay.relay("chat/completions", caller, { ...chat, stream: true });
    if (typeof response.body === "string") throw new Error("Expected stream");
    await new Promise<void>((resolve) => response.body.once("close", resolve));
    expect(h.sqlite.prepare("SELECT status,estimated FROM llm_relay_usage").get()).toEqual({ status: "error", estimated: 1 });
    expect(h.quota.recordCall).toHaveBeenCalledTimes(1);
  });
  it("reserves a bounded request's cost before sending a second concurrent request", async () => {
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const firstStarted = new Promise<void>((resolve) => { started = resolve; });
    const h = setup(async () => {
      started();
      await gate;
      return Response.json({ choices: [], usage: { prompt_tokens: 20, completion_tokens: 1000 } });
    });
    // Each bounded request reserves about $0.102: either fits alone, both do not.
    h.relay.saveGrant(caller.caller, { dailyUsdCap: 0.15 }, caller.workspaceId);
    const first = h.relay.relay("chat/completions", caller, chat);
    await firstStarted;
    const second = h.relay.relay("chat/completions", caller, chat).then(
      () => ({ accepted: true, code: null }),
      (error: unknown) => ({ accepted: false, code: (error as { code?: string }).code }),
    );
    // Let the second request reach admission while the first response is held.
    await new Promise<void>((resolve) => setImmediate(resolve));
    release();
    await first;
    expect.soft(await second).toEqual({ accepted: false, code: "RELAY_BUDGET_EXCEEDED" });
    expect.soft(h.fetchImpl).toHaveBeenCalledTimes(1);
    const spent = h.sqlite.prepare("SELECT SUM(cost_usd) AS usd FROM llm_relay_usage WHERE status != 'refused'").get() as { usd: number };
    expect(spent.usd).toBeLessThanOrEqual(0.15);
  });

  it("keeps unknown model pricing null and marks job cost unknown even with a configured empty price map", async () => {
    const h = setup(() => Response.json({ choices: [], usage: { prompt_tokens: 20, completion_tokens: 1000 } }), "{}");
    // Unknown prices can be used only under an explicitly unlimited policy.
    h.relay.saveGrant(caller.caller, { dailyUsdCap: 0 }, caller.workspaceId);
    h.quota.policyFor.mockReturnValue({ policy: {}, paidFallbackDailyUsd: 0, timeZone: "UTC" });
    await h.relay.relay("chat/completions", caller, chat, { jobId: "accounting-job" });
    expect.soft(h.sqlite.prepare("SELECT cost_usd FROM llm_relay_usage").get()).toEqual({ cost_usd: null });
    expect(h.recordJobUsage).toHaveBeenCalledExactlyOnceWith("accounting-job", expect.objectContaining({ costUnknown: true }));
  });

  it("does not spend against a finite daily cap when the model price is unknown", async () => {
    const h = setup(() => Response.json({}), "{}");
    await expect(h.relay.relay("chat/completions", caller, chat)).rejects.toMatchObject({ code: "RELAY_BUDGET_EXCEEDED" });
    expect(h.fetchImpl).not.toHaveBeenCalled();
  });

  it("propagates a stream read error and accounts its already-reported billable usage exactly once", async () => {
    let upstream!: ReadableStreamDefaultController<Uint8Array>;
    const h = setup(() => new Response(new ReadableStream<Uint8Array>({ start(controller) { upstream = controller; } }),
      { headers: { "content-type": "text/event-stream" } }));
    const result = await h.relay.relay("chat/completions", caller, { ...chat, stream: true }, { jobId: "accounting-job" });
    if (typeof result.body === "string") throw new Error("Expected SSE stream");
    const iterator = result.body[Symbol.asyncIterator]();
    // Padding flushes the complete usage line through the streaming redactor.
    upstream.enqueue(new TextEncoder().encode(usageEvent + ":" + "padding".repeat(50) + "\n\n"));
    await iterator.next();
    upstream.error(new Error("fixture upstream failed after usage"));
    const drain = async () => { while (!(await iterator.next()).done) { /* drain buffered chunks */ } };
    await expect.soft(drain()).rejects.toBeInstanceOf(Error);
    result.body.destroy();
    expect.soft(h.sqlite.prepare("SELECT input_tokens,output_tokens,cost_usd,estimated,status FROM llm_relay_usage").all())
      .toEqual([{ input_tokens: 20, output_tokens: 1000, cost_usd: expect.closeTo(0.102, 8), estimated: 0, status: "error" }]);
    expect.soft(h.quota.recordCall).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ inputTokens: 20, outputTokens: 1000 }));
    expect(h.recordJobUsage).toHaveBeenCalledExactlyOnceWith("accounting-job", expect.objectContaining({
      llmCalls: 1, inputTokens: 20, outputTokens: 1000, costUsd: expect.closeTo(0.102, 8),
      calls: [expect.objectContaining({ ok: false, costUsd: expect.closeTo(0.102, 8) })],
    }));
  });

  it("records estimated billable usage exactly once when a successful JSON response body cannot be read", async () => {
    const h = setup(() => new Response(new ReadableStream({ start(controller) { controller.error(new Error("fixture JSON body failed")); } })));
    await expect(h.relay.relay("chat/completions", caller, chat, { jobId: "accounting-job" })).rejects.toBeInstanceOf(Error);
    const rows = h.sqlite.prepare("SELECT input_tokens,estimated,status FROM llm_relay_usage").all();
    expect.soft(rows).toEqual([expect.objectContaining({ input_tokens: expect.any(Number), estimated: 1, status: "error" })]);
    expect.soft(h.quota.recordCall).toHaveBeenCalledTimes(1);
    expect(h.recordJobUsage).toHaveBeenCalledExactlyOnceWith("accounting-job", expect.objectContaining({
      llmCalls: 1, tokensUnknown: true, inputTokens: expect.any(Number),
      calls: [expect.objectContaining({ ok: false })],
    }));
  });

  it("accounts a completed stream once even when it is destroyed after completion", async () => {
    const h = setup(() => new Response(usageEvent + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } }));
    const result = await h.relay.relay("chat/completions", caller, { ...chat, stream: true }, { jobId: "accounting-job" });
    if (typeof result.body === "string") throw new Error("Expected SSE stream");
    for await (const _chunk of result.body) { /* consume to completion */ }
    result.body.destroy();
    expect(h.sqlite.prepare("SELECT COUNT(*) AS n FROM llm_relay_usage").get()).toEqual({ n: 1 });
    expect(h.quota.recordCall).toHaveBeenCalledTimes(1);
    expect(h.recordJobUsage).toHaveBeenCalledTimes(1);
  });
});
