import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { testActor } from "./testActor.js";
import { parseConfig, type AppConfig } from "../src/lib/config.js";
import { invokeRegistryTool } from "../src/registry/invoke.js";
import { OMNIROUTE_MANAGEMENT_TOKEN_KEY } from "../src/providers/llm/omnirouteQuotaStore.js";

const root = mkdtempSync(join(tmpdir(), "vg-intel-"));
let config: AppConfig;
let app: ReturnType<typeof buildApp>;

function intel() {
  return app.vgProviderIntel;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function allowRobots(html: string, seen: string[]): (url: string, init?: RequestInit) => Promise<Response> {
  return async (url: string) => {
    seen.push(url);
    if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nDisallow:\n", { status: 200 });
    return new Response(html, { status: 200 });
  };
}

beforeAll(() => {
  config = parseConfig({
    DATA_DIR: join(root, "data"),
    DATABASE_PATH: join(root, "intel.db"),
    PORT: "3016",
    HOST: "127.0.0.1",
    LOG_LEVEL: "silent",
    CORS_ORIGIN: "http://localhost:5173",
    WEB_BASE_URL: "http://localhost:5180",
    LLM_ENABLE_MOCK: "true",
    LLM_DEFAULT_PROVIDER: "mock",
    TTS_PROVIDER: "mock",
    WORKER_ENABLED: "false",
    FAKE_STAGE_DELAY_MS: "0",
    TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
  });
  app = buildApp({ testActor,  config });
});

afterAll(async () => {
  await app.close();
  rmSync(root, { recursive: true, force: true });
});

describe("provider intelligence", () => {
  it("keeps the baseline when the candidate fails the same route evaluation cases", async () => {
    const response = await app.inject({
      method: "POST", url: "/api/provider-intel/eval/compare",
      payload: {
        suiteId: "script-short",
        baseline: { provider: "mock", model: "mock-v1" },
        candidate: { provider: "mock", model: "fixture-weaker" },
      },
    });
    expect(response.statusCode).toBe(200);
    const report = response.json();
    expect(report).toMatchObject({
      recommendation: "keep_baseline", callsUsed: 16,
      baseline: { cases: 8, quality: 1, schemaErrorRate: 0, totalTokens: expect.any(Number), averageLatencyMs: expect.any(Number), estimatedCostUsd: 0 },
      candidate: { cases: 8, quality: 0.5 },
    });
    const saved = await app.inject({ method: "GET", url: `/api/provider-intel/eval/${report.runId}` });
    expect(saved.json().results).toHaveLength(16);
    expect(JSON.parse(saved.json().run.summary_vi)).toEqual(report);
  });

  it("keeps a verbatim quote, drops a changed quote, and does not overwrite user_checked", async () => {
    const seen: string[] = [];
    intel().setFetch(allowRobots("Free tier includes 1 million tokens. user@example.com sk-abcdefghijklmnopqrstuvwxyz Bearer abcdefghijklmnop oma_abcdef", seen));
    const logs: string[] = [];
    intel().setLogger({ info: (obj) => logs.push(JSON.stringify(obj)) });
    const page = await intel().fetchPage("groq", "https://groq.com/docs", "docs");
    expect(page.text).not.toContain("sk-");
    expect(page.text).not.toContain("@");
    expect(page.text).not.toContain("Bearer");
    expect(page.text).not.toContain("oma_");
    expect(logs.join("\n")).not.toContain("sk-");
    expect(page.text).toContain("Free tier includes 1 million tokens.");

    const dropped = await intel().submitAssessment({
      providerId: "groq",
      pageId: page.id,
      fields: [{ path: "legalEntity", value: "Nope", quote: "this quote is not on the page" }],
    });
    expect(dropped.rejected).toContain("legalEntity");
    const afterDrop = intel().getProvider("groq");
    expect("billing" in afterDrop && afterDrop.legalEntity.value).toBe("UNKNOWN");

    const kept = await intel().submitAssessment({
      providerId: "groq",
      pageId: page.id,
      fields: [{ path: "legalEntity", value: "Groq Inc", quote: "Free tier includes 1 million tokens." }],
    });
    expect(kept.accepted).toContain("legalEntity");
    intel().setChecklist("groq", "billing.cardRequired", false);
    const skipped = await intel().submitAssessment({
      providerId: "groq",
      pageId: page.id,
      fields: [{ path: "billing.cardRequired", value: "true", quote: "Free tier includes 1 million tokens." }],
    });
    expect(skipped.skipped).toContain("billing.cardRequired");
    const provider = intel().getProvider("groq");
    if (!("billing" in provider)) throw new Error("expected a record");
    expect(provider.billing.cardRequired.source).toBe("user_checked");
    expect(provider.billing.cardRequired.value).toBe("no");
    const history = intel().store.history("provider", "groq");
    expect(history.length).toBeGreaterThanOrEqual(3);
    expect(history[0]?.supersededAt).toBeTruthy();
    expect(history.at(-1)?.supersededAt).toBeNull();
  });

  it("refuses a non-official host and a page fetched within six hours, and notifies only when the hash changes", async () => {
    const seen: string[] = [];
    intel().setFetch(allowRobots("<p>one</p>", seen));
    await expect(intel().fetchPage("groq", "https://evil.com/pricing", "pricing")).rejects.toThrow(/chính thức/);
    expect(seen).toHaveLength(0);

    let now = new Date("2026-11-05T00:00:00.000Z");
    intel().setNow(() => now);
    const notes: string[] = [];
    intel().setNotify((event) => { notes.push(event.message); });
    await intel().fetchPage("groq", "https://groq.com/pricing", "pricing");
    await expect(intel().fetchPage("groq", "https://groq.com/pricing", "pricing")).rejects.toThrow(/6 giờ/);
    now = new Date("2026-11-05T08:00:00.000Z");
    intel().setFetch(allowRobots("<p>two</p>", seen));
    const changed = await intel().fetchPage("groq", "https://groq.com/pricing", "pricing");
    expect(changed.changed).toBe(true);
    expect(notes.some((note) => note.includes("đã đổi"))).toBe(true);
    const before = notes.length;
    now = new Date("2026-11-05T16:00:00.000Z");
    const same = await intel().fetchPage("groq", "https://groq.com/pricing", "pricing");
    expect(same.changed).toBe(false);
    expect(notes).toHaveLength(before);
    intel().setNow(() => new Date());
  });

  it("leaves confirm tools pending when the operator calls them", async () => {
    const before = intel().routingProposals().length;
    const pending = await invokeRegistryTool({ actor: testActor,
      name: "apply_routing_proposal",
      args: { proposalId: "not-applied" },
      source: "operator",
      ctx: app.vgAssistant.service.toolContext(),
      createPending: ({ tool, args, summary }) => app.vgAssistant.service.createCallerPending("Định tuyến", tool, args, summary),
    });
    expect(pending.kind).toBe("pending");
    const proposed = await invokeRegistryTool({ actor: testActor,
      name: "propose_route_change",
      args: { profileId: "video", modelIds: ["groq/fast"] },
      source: "operator",
      ctx: app.vgAssistant.service.toolContext(),
      createPending: ({ tool, args, summary }) => app.vgAssistant.service.createCallerPending("Định tuyến", tool, args, summary),
    });
    expect(proposed.kind).toBe("pending");
    expect(intel().routingProposals()).toHaveLength(before);
  });

  it("enables only the full-research standing order", () => {
    const orders = app.vgOperator.service.listOrders();
    expect(orders.find((order) => order.id === "intel-full-research")?.enabled).toBe(true);
    for (const id of ["intel-weekly-discover", "intel-weekly-refresh", "intel-weekly-report", "intel-monthly-policy"]) {
      expect(orders.find((order) => order.id === id)?.enabled).toBe(false);
    }
  });

  it("chains the research queue until the daily cap, then finishes when the cap allows", async () => {
    await app.inject({ method: "PUT", url: "/api/operator/settings", payload: { maxRunsPerDay: 2 } });
    let wakes = 0;
    intel().setWake(() => {
      wakes += 1;
      return { status: "running" };
    });
    let guard = 0;
    while (intel().todoCount() > 0 && guard < 5) {
      const step = intel().continueResearch();
      if (step.reason === "cap") break;
      const batch = intel().nextResearchBatch(4);
      for (const item of batch.providers) intel().markResearched(String(item.id), "done", "xong", { chain: false });
      guard += 1;
    }
    expect(wakes).toBe(2);
    expect(intel().todoCount()).toBeGreaterThan(0);
    await app.inject({ method: "PUT", url: "/api/operator/settings", payload: { maxRunsPerDay: 40 } });
    while (intel().todoCount() > 0 && guard < 30) {
      const step = intel().continueResearch();
      if (step.reason !== "woken" && step.reason !== "refused") break;
      const batch = intel().nextResearchBatch(4);
      for (const item of batch.providers) intel().markResearched(String(item.id), "done", "xong", { chain: false });
      guard += 1;
    }
    expect(intel().todoCount()).toBe(0);
  });

  it("sends batch, report, and risk notices", async () => {
    const notes: string[] = [];
    intel().setNotify((event) => { notes.push(event.message); });
    intel().markResearched("groq", "todo", "lam lai", { chain: false });
    intel().nextResearchBatch(4);
    intel().writeReport();
    const seen: string[] = [];
    intel().setFetch(allowRobots("Free tier includes 1 million tokens.", seen));
    const page = await intel().fetchPage("mistral", "https://mistral.ai/pricing", "pricing");
    await intel().submitAssessment({
      providerId: "mistral",
      pageId: page.id,
      fields: [{ path: "legalEntity", value: "Mistral", quote: "Free tier includes 1 million tokens." }],
    });
    expect(notes.some((note) => note.includes("Đã nghiên cứu"))).toBe(true);
    expect(notes.some((note) => note.includes("Báo cáo nhà cung cấp"))).toBe(true);
    expect(notes.some((note) => note.includes("Rủi ro thanh toán"))).toBe(true);
  });

  it("moves an expired offer to a new version and keeps the old row", async () => {
    const seen: string[] = [];
    intel().setFetch(allowRobots("Free tier includes 1 million tokens.", seen));
    const page = await intel().fetchPage("deepseek", "https://www.deepseek.com/pricing", "pricing");
    await intel().setOffer({
      providerId: "deepseek",
      id: "free",
      kind: "permanent_free",
      unit: "tokens",
      appliesTo: "api_inference",
      status: "active",
      expiresAt: "2020-01-01T00:00:00.000Z",
      pageId: page.id,
      quote: "Free tier includes 1 million tokens.",
      amount: 100,
    });
    const moved = intel().expireOffers();
    expect(moved.some((offer) => offer.id === "free" && offer.status === "expired")).toBe(true);
    const history = intel().store.history("offer", "deepseek:free");
    expect(history.length).toBe(2);
    expect(history[0]?.supersededAt).toBeTruthy();
    expect((history[1]?.body as { status: string }).status).toBe("expired");
  });

  it("maps OmniRoute state, skips cookie probes, and probes a model once per day", async () => {
    const calls: string[] = [];
    intel().setFetch(async (url) => {
      calls.push(url);
      throw new Error("no management call");
    });
    const missing = await intel().audit();
    expect(missing.needsToken).toBe(true);
    expect(calls).toHaveLength(0);

    app.vgPublish.vault.storeSecret(OMNIROUTE_MANAGEMENT_TOKEN_KEY, "read-only-test");
    intel().setFetch(async (url, init) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.endsWith("/api/providers")) {
        return json([
          { id: "cookie-1", provider: "claude", authType: "cookie", credentialPresent: true },
          { id: "key-1", provider: "groq", authType: "api_key", credentialPresent: true },
        ]);
      }
      if (url.endsWith("/models")) return json({ data: [{ id: "fast" }] });
      if (url.endsWith("/test")) return json({ ok: true });
      if (url.endsWith("/v1/models")) return json({ data: [] });
      return new Response("no", { status: 404 });
    });
    const audit = await intel().audit();
    const cookie = audit.connections.find((item) => item.id === "cookie-1");
    const keyed = audit.connections.find((item) => item.id === "key-1");
    expect(cookie?.probeSkipped).toBe(true);
    expect(keyed?.states).toEqual(expect.arrayContaining(["CONFIGURED", "AUTHENTICATED", "CONNECTED", "MODEL_DISCOVERED"]));
    expect(calls.some((call) => call.includes("/providers/cookie-1/test"))).toBe(false);
    expect(calls.some((call) => call.includes("/providers/key-1/test"))).toBe(true);

    intel().rememberModel({ providerId: "groq", modelId: "fast", cookie: false });
    intel().rememberModel({ providerId: "claude", modelId: "web", cookie: true });
    const bodies: string[] = [];
    intel().setFetch(async (url, init) => {
      bodies.push(String(init?.body ?? url));
      return json({ choices: [{ message: { content: "p" } }] });
    });
    const first = await intel().runProbes();
    expect(first.find((item) => item.model === "web")?.skipped).toBe(true);
    expect(first.find((item) => item.model === "fast")?.skipped).toBe(false);
    expect(bodies.some((body) => body.includes("\"web\""))).toBe(false);
    expect(bodies.some((body) => body.includes("\"fast\""))).toBe(true);
    const second = await intel().runProbes();
    expect(second.find((item) => item.model === "fast")?.skipped).toBe(true);
    app.vgPublish.vault.deleteSecret(OMNIROUTE_MANAGEMENT_TOKEN_KEY);
  });

  it("does not write combos when backup fails, changes only va- combos, and shows rollback after a regression", async () => {
    app.vgPublish.vault.storeSecret(OMNIROUTE_MANAGEMENT_TOKEN_KEY, "read-only-test");
    let puts = 0;
    intel().setFetch(async (url, init) => {
      if (String(url).includes("/api/db-backups/export")) return new Response("no", { status: 500 });
      if (init?.method === "PUT") puts += 1;
      return json({});
    });
    const failed = await intel().updateCombos([{ id: "video", models: ["fast"] }], []);
    expect(failed.wrote).toBe(false);
    expect(puts).toBe(0);

    let written = "";
    intel().setFetch(async (url, init) => {
      if (String(url).includes("/api/db-backups/export")) return json({ id: "bk-9" });
      if (String(url).endsWith("/api/combos") && (init?.method ?? "GET") === "GET") {
        return json({ combos: [{ name: "keep-me", models: ["a"] }, { name: "va-video", models: ["old"] }] });
      }
      if (init?.method === "PUT") {
        written = String(init.body);
        return json({ ok: true });
      }
      if (String(url).includes("/test")) return new Response("down", { status: 500 });
      return json({});
    });
    const updated = await intel().updateCombos([{ id: "video", models: ["fast"] }], ["key-1"]);
    const body = JSON.parse(written) as { combos: Array<{ name: string; models: string[] }> };
    expect(body.combos.find((combo) => combo.name === "keep-me")?.models).toEqual(["a"]);
    expect(body.combos.find((combo) => combo.name === "va-video")?.models).toEqual(["fast"]);
    expect(body.combos.some((combo) => combo.name === "va-old-other")).toBe(false);
    expect(updated.regression).toBe(true);
    expect(updated.restoreStepsVi).toContain("bk-9");
    app.vgPublish.vault.deleteSecret(OMNIROUTE_MANAGEMENT_TOKEN_KEY);
  });

  it("exports the catalog files without secrets", async () => {
    intel().setChecklist("together", "legalEntity", "user@example.com");
    const exported = intel().exportAll();
    const required = [
      "providers/provider_catalog.json",
      "offers/active_offers.json",
      "billing/billing_risk_report.json",
      "accounts/activation_instructions.md",
      "README.md",
    ];
    for (const file of required) expect(exported.files).toContain(file);
    const texts: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else texts.push(readFileSync(path, "utf8"));
      }
    };
    walk(exported.root);
    const all = texts.join("\n");
    expect(all).not.toContain("sk-");
    expect(all).not.toContain("oma_");
    expect(all).not.toContain("Bearer");
    expect(all).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
    expect(all).toContain("[email]");
  });

  it("runs a free eval, holds a paid eval, refuses a cookie, and stops near quota", async () => {
    const free = await intel().runEval({
      suiteIds: ["script-short"],
      modelIds: ["free"],
      models: [{ id: "free", paid: false, cookie: false, quotaLeft: 0.8 }],
    });
    expect(free.status).toBe("run");
    const paid = await intel().runEval({
      suiteIds: ["script-short"],
      modelIds: ["paid"],
      models: [{ id: "paid", paid: true, cookie: false, quotaLeft: 0.8 }],
    });
    expect(paid.status).toBe("pending");
    const cookie = await intel().runEval({
      suiteIds: ["script-short"],
      modelIds: ["web"],
      models: [{ id: "web", paid: false, cookie: true, quotaLeft: 0.8 }],
      approved: true,
    });
    expect(cookie.status).toBe("refused");
    const stopped = await intel().runEval({
      suiteIds: ["script-short"],
      modelIds: ["free"],
      models: [{ id: "free", paid: false, cookie: false, quotaLeft: 0.8 }],
      remainingRatio: 0.05,
    });
    expect(stopped.status).toBe("stopped");
    const blocked = await intel().runEval({
      suiteIds: ["script-short"],
      modelIds: ["free"],
      models: [{ id: "free", paid: false, cookie: false, quotaLeft: 0.8 }],
      projectId: "56374fb2-54cf-48ff-9441-2e6c653295d4",
    });
    expect(blocked.status).toBe("refused");
  });

  it("writes task stats from job usage", () => {
    const rows = intel().rebuildStats([{
      usage: {
        calls: [
          { task: "script", provider: "groq", model: "writer", ok: true, schemaValid: true, fallback: false, day: "2026-11-05" },
          { task: "script", provider: "groq", model: "writer", ok: false, schemaValid: false, fallback: false, day: "2026-11-05" },
        ],
        signals: [{ task: "script", provider: "groq", model: "writer", kind: "scriptReview", value: 8 }],
      },
    }]);
    expect(rows[0]?.quality.scriptReview).toBe(8);
    expect(rows[0]?.confidence).toBe("low");
  });

  it("adds a stub from a curated feed and keeps only a quote that is in the page", async () => {
    const seen: string[] = [];
    intel().setFetch(async (url) => {
      seen.push(url);
      if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nDisallow:\n", { status: 200 });
      if (url.includes("cohere.com/pricing")) return new Response("Free tier includes 1 million tokens.", { status: 200 });
      return new Response("<item><title>NewAPI Cloud</title><link>https://newapi.example/docs</link></item>", { status: 200 });
    });
    intel().setExtract(async () => [
      { path: "country", value: "US", quote: "not on the stored page" },
      { path: "legalEntity", value: "Quoted entity", quote: "Free tier includes 1 million tokens." },
    ]);
    const page = await intel().fetchPage("cohere", "https://cohere.com/pricing", "pricing");
    const extracted = await intel().extractStoredPage(page.id);
    expect(extracted.rejected).toContain("country");
    expect(extracted.accepted).toContain("legalEntity");
    const weekly = await intel().runJob("weekly") as { discovered: string[] };
    expect(weekly.discovered).toContain("newapi-cloud");
    const stub = intel().getProvider("newapi-cloud");
    expect(stub.needsResearch).toBe(true);
    expect(seen.some((url) => url.includes("groq.com/blog"))).toBe(true);
  });
});
