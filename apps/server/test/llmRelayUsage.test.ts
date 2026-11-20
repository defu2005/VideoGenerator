import { afterEach, describe, expect, it, vi } from "vitest";
import { LlmRelay, type RelayDeps } from "../src/providers/llm/relay.js";
import { UsageService } from "../src/services/usageService.js";
import { FinanceService } from "../src/finance/financeService.js";
import { saveAppCurrency } from "../src/finance/currencySettings.js";
import { runAsActor } from "../src/auth/requestContext.js";
import { actorWith } from "./testActor.js";
import { createPipelineHarness } from "./pipelineFixtures.js";

const fixtures: ReturnType<typeof createPipelineHarness>[] = [];
afterEach(() => fixtures.splice(0).forEach((h) => h.close()));
const range = { from: "2026-11-01", to: "2026-11-30" };
function setup() {
  const h = createPipelineHarness(); fixtures.push(h);
  h.sqlite.prepare("UPDATE projects SET workspace_id='A' WHERE id=?").run(h.projectId);
  const usage = new UsageService(h.sqlite, 25000);
  saveAppCurrency(h.sqlite, "USD");
  const finance = new FinanceService({ sqlite: h.sqlite, usage, config: h.config,
    vault: {} as never, registry: {} as never, logger: {} as never, now: h.clock,
    fetchImpl: vi.fn(() => { throw new Error("Unexpected network call"); }) });
  let serial = 0;
  function row(patch: { workspace?: string | null; status?: string; jobId?: string; cost?: number | null; estimated?: number; createdAt?: string } = {}) {
    const id = `relay-${++serial}`;
    h.sqlite.prepare(`INSERT INTO llm_relay_usage
      (id,caller,workspace_id,model,job_id,input_tokens,output_tokens,cost_usd,estimated,status,latency_ms,created_at)
      VALUES (?,'agent:fixture/usage',?,'fixture-model',?,20,30,?,?,?,1,?)`)
      .run(id, patch.workspace === undefined ? "A" : patch.workspace, patch.jobId ?? null,
        patch.cost === undefined ? 0.5 : patch.cost, patch.estimated ?? 0, patch.status ?? "ok", patch.createdAt ?? h.clock().toISOString());
    return id;
  }
  function job() {
    const now = h.clock().toISOString();
    const data = { llmCalls: 1, inputTokens: 20, outputTokens: 30, costUsd: 0.5,
      calls: [{ task: "relay", provider: "relay:agent:fixture/usage", model: "fixture-model", inputTokens: 20,
        outputTokens: 30, cached: false, fallback: false, ok: true, costUsd: 0.5 }] };
    h.sqlite.prepare(`INSERT INTO jobs (id,project_id,stage,status,usage,created_at,started_at,finished_at,run_after)
      VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',?,'SCRIPT','SUCCEEDED',?,?,?,?,?)`).run(h.projectId, JSON.stringify(data), now, now, now, now);
    return "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  }
  return { ...h, usage, finance, row, job };
}

describe("completed relay overhead in usage and finance", () => {
  it("records a late relay bill on a terminal job only through the explicit accounting option", () => {
    const h = setup(), jobId = h.job();
    const delta = { llmCalls: 1, inputTokens: 20, outputTokens: 30, costUsd: 0.25, costUnknown: true, tokensUnknown: true,
      calls: [{ task: "relay", provider: "relay:agent:fixture/usage", model: "fixture-model", inputTokens: 20, outputTokens: 30,
        cached: false, fallback: false, ok: false, costUsd: 0.25, costUnknown: true, tokensUnknown: true }] };
    h.orchestrator.recordUsage(jobId, delta);
    expect(h.usage.getProjectUsage(h.projectId).totals.costUsd).toBe(0.5);
    h.orchestrator.recordUsage(jobId, delta, { allowTerminal: true });
    h.row({ jobId, cost: 0.25, status: "error", estimated: 1 });
    expect(h.usage.getAppUsage({ ...range, groupBy: "model" }).totals)
      .toMatchObject({ llmCalls: 2, costUsd: 0.75, failedCalls: 1, costUnknown: true, tokensUnknown: true });
    expect(h.finance.getSummary(range).kpi.cost).toBe(0.75);
    expect(h.repository.getJob(jobId)?.status).toBe("SUCCEEDED");
  });
  it("includes an actual unassigned relay completion in app usage, automation spend and finance without a fake job", async () => {
    const h = setup();
    const before = h.sqlite.prepare("SELECT COUNT(*) n FROM jobs").get();
    const fetchImpl = vi.fn(async () => Response.json({ choices: [], usage: { prompt_tokens: 20, completion_tokens: 30 } }));
    const relay = new LlmRelay({ sqlite: h.sqlite,
      config: { ...h.config, OMNIROUTE_API_KEY: "offline-fixture-secret", OMNIROUTE_BASE_URL: "http://fixture.invalid/v1",
        LLM_PRICES_JSON: JSON.stringify({ "omniroute:fixture-model": { inputPerMTok: 10000, outputPerMTok: 10000 } }) },
      catalog: { getModels: async () => [], peekModels: () => [] } as unknown as RelayDeps["catalog"],
      quota: () => null, verifyApiKey: async () => ({ valid: false }), authenticateNode: () => undefined,
      fetchImpl: fetchImpl as typeof fetch, now: h.clock });
    await relay.relay("chat/completions", { caller: "agent:fixture/usage", workspaceId: "A", label: "Fixture" },
      { model: "fixture-model", max_tokens: 30, messages: [{ role: "user", content: "fixture" }] });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(h.sqlite.prepare("SELECT COUNT(*) n FROM jobs").get()).toEqual(before);
    const app = h.usage.getAppUsage({ ...range, groupBy: "provider" });
    expect(app.totals).toMatchObject({ llmCalls: 1, inputTokens: 20, outputTokens: 30, costUsd: 0.5 });
    expect(app.byGroup[0]?.key).toBe("relay:agent:fixture/usage");
    expect(app.topProjects).toEqual([]);
    expect(h.usage.getAutomationSpend("2026-11-03", "UTC")).toEqual({ dailyUsd: 0.5, monthlyUsd: 0.5 });
    expect(h.finance.getSummary(range).kpi.cost).toBe(0.5);
  });

  it("counts linked calls once and retains the same total after their job is deleted", () => {
    const h = setup(); const jobId = h.job(); h.row({ jobId });
    for (const deleted of [false, true]) {
      if (deleted) h.sqlite.prepare("DELETE FROM jobs WHERE id=?").run(jobId);
      expect(h.usage.getAppUsage({ ...range, groupBy: "day" }).totals).toMatchObject({ llmCalls: 1, costUsd: 0.5 });
      expect(h.usage.getAutomationSpend("2026-11-03", "UTC")).toEqual({ dailyUsd: 0.5, monthlyUsd: 0.5 });
      expect(h.finance.getSummary(range).kpi.cost).toBe(0.5);
    }
  });

  it("counts completed billable errors and unknown costs but excludes pending and refused", () => {
    const h = setup();
    h.row({ status: "error", cost: 0.75, estimated: 1 });
    h.row({ cost: null }); h.row({ status: "pending", cost: 20 }); h.row({ status: "refused", cost: 30 });
    const app = h.usage.getAppUsage({ ...range, groupBy: "model" });
    expect(app.totals).toMatchObject({ llmCalls: 2, failedCalls: 1, costUsd: 0.75, tokensUnknown: true, costUnknown: true });
    expect(app.byGroup[0]?.key).toBe("relay:agent:fixture/usage/fixture-model");
    expect(h.finance.getSummary(range).kpi.cost).toBe(0.75);
    expect(h.usage.getAutomationSpend("2026-11-03", "UTC").dailyUsd).toBe(0.75);
  });

  it("scopes views to the workspace, keeps system totals global and hides unassigned overhead from channel-only access", () => {
    const h = setup(); h.row(); h.row({ workspace: "B", cost: 1 }); h.row({ workspace: null, cost: 2 });
    const view = () => ({ app: h.usage.getAppUsage({ ...range, groupBy: "project" }),
      spend: h.usage.getAutomationSpend("2026-11-03", "UTC"), finance: h.finance.getSummary(range) });
    const scoped = runAsActor(actorWith({ role: "owner", workspaceId: "A" }), view);
    expect(scoped.app.totals.costUsd).toBe(0.5);
    expect(scoped.app.byGroup[0]?.key).toBe("relay");
    expect(scoped.spend.dailyUsd).toBe(0.5); expect(scoped.finance.kpi.cost).toBe(0.5);
    expect(view().app.totals.costUsd).toBe(3.5); expect(view().finance.kpi.cost).toBe(3.5);
    const channelOnly = runAsActor(actorWith({ role: "viewer", workspaceId: "A", grants: { "profile-a": "viewer" } }), view);
    expect(channelOnly.app.totals.costUsd).toBe(0); expect(channelOnly.finance.kpi.cost).toBe(0);
    expect(h.usage.getAutomationSpend("2026-11-03", "UTC", "profile-a").dailyUsd).toBe(0);
    expect(h.finance.getSummary({ ...range, profileId: "profile-a" }).kpi.cost).toBe(0);
  });

  it("uses UTC dates in app and finance views and local dates for automation budget", () => {
    const h = setup(); h.row({ createdAt: "2026-11-03T23:30:00.000Z" });
    expect(h.usage.getAutomationSpend("2026-11-04", "Asia/Bangkok").dailyUsd).toBe(0.5);
    expect(h.usage.getAutomationSpend("2026-11-03", "Asia/Bangkok").dailyUsd).toBe(0);
    expect(h.usage.getAppUsage({ from: "2026-11-04", to: "2026-11-04", groupBy: "day" }).totals.llmCalls).toBe(0);
    expect(h.usage.getAppUsage({ from: "2026-11-03", to: "2026-11-03", groupBy: "day" }).byGroup[0]?.key).toBe("2026-11-03");
    expect(h.finance.getSummary({ from: "2026-11-04", to: "2026-11-04" }).kpi.cost).toBe(0);
  });
});
