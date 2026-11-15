import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { parseConfig } from "../src/lib/config.js";
import { actorWith } from "./testActor.js";

const opened: Array<{ app: ReturnType<typeof buildApp>; root: string }> = [];
afterEach(async () => { for (const { app, root } of opened.splice(0)) { await app.close(); rmSync(root, { recursive: true, force: true }); } });
function app(kind: "user" | "apikey" = "user", role: "owner" | "viewer" = "owner") {
  const root = mkdtempSync(join(tmpdir(), "vg-research-api-"));
  const server = buildApp({ config: parseConfig({ DATA_DIR: root, DATABASE_PATH: join(root, "db.sqlite"), LOG_LEVEL: "silent", WORKER_ENABLED: "false", LLM_ENABLE_MOCK: "true", LLM_DEFAULT_PROVIDER: "mock", TTS_PROVIDER: "mock", IMAGE_PROVIDERS: "mock" }),
    testActor: actorWith({ role, kind }) });
  opened.push({ app: server, root }); return server;
}
it("lets a user start research with the routed mock, records a report, and keeps the weekly seed off", async () => {
  const server = app();
  const overview = await server.inject({ method: "GET", url: "/api/research" });
  expect(overview.statusCode).toBe(200); expect(overview.json().skills).toHaveLength(6);
  const result = await server.inject({ method: "POST", url: "/api/research/runs", payload: { skill: "research-open-source", subject: "Public fixture" } });
  expect(result.statusCode).toBe(200); expect(result.json()).toMatchObject({ status: "unavailable", budgetUsed: { researchRuns: 1, llmCalls: 1 } });
  const detail = await server.inject({ method: "GET", url: `/api/research/runs/${result.json().id}` });
  expect(detail.json().report).toContain("Không có khóa hoặc route Gemini");
  const orders = await server.inject({ method: "GET", url: "/api/operator/orders" });
  expect(JSON.stringify(orders.json())).toContain("seed-research-weekly");
  expect((orders.json().items ?? orders.json().orders ?? orders.json()).find((order: { id: string }) => order.id === "seed-research-weekly").enabled).toBe(false);
  const unavailable = await server.inject({ method: "PUT", url: "/api/research/settings", payload: { runtime: "uninstalled-web" } });
  expect(unavailable.statusCode).toBe(400);
});
it("refuses agent budget writes/manual starts and denies viewer writes", async () => {
  const machine = app("apikey"), viewer = app("user", "viewer");
  for (const server of [machine, viewer]) {
    const result = await server.inject({ method: "PUT", url: "/api/research/settings", payload: { budget: { researchRuns: 999 } } });
    expect(result.statusCode).toBe(403);
    expect((await server.inject({ method: "POST", url: "/api/research/runs", payload: { skill: "research-open-source", subject: "fixture" } })).statusCode).toBe(403);
  }
});
