import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { parseConfig } from "../src/lib/config.js";
import { createWebhookEndpoint } from "../src/events/webhooks.js";
import { publishAgentEvent, subscribeAgentEvents } from "../src/events/agentBus.js";
import type { AgentEvent } from "@vg/shared";
import { sendMessage } from "../src/supervision/mailbox.js";
import { TokenVault } from "../src/publishing/tokenVault.js";
import { testActor, TEST_WORKSPACE_ID } from "./testActor.js";

// Real wiring: buildApp subscribes the webhook fan-out (app.ts), so this runs the production path.
const apps: Array<{ close: () => Promise<void>; root: string }> = [];
afterEach(async () => { for (const a of apps.splice(0)) { await a.close(); rmSync(a.root, { recursive: true, force: true }); } });

async function makeApp() {
  const root = mkdtempSync(join(tmpdir(), "vg-webhook-e2e-"));
  const config = parseConfig({ DATA_DIR: root, DATABASE_PATH: join(root, "app.db"), WORKER_ENABLED: "false", LOG_LEVEL: "silent", LLM_ENABLE_MOCK: "true", LLM_DEFAULT_PROVIDER: "mock" });
  const app = buildApp({ config, testActor: { ...testActor, kind: "user" } as never });
  apps.push({ close: () => app.close(), root });
  const ctx = app.vgAssistant.service.toolContext();
  const vault = new TokenVault(ctx.sqlite, root, Buffer.alloc(32, 7).toString("base64"));
  // Empty eventTypes: the endpoint would match every event type if the guard were missing.
  createWebhookEndpoint(ctx.sqlite, vault, { name: "all", url: "https://example.com/hook", eventTypes: [] }, new Date());
  const count = () => (ctx.sqlite.prepare("SELECT COUNT(*) AS n FROM webhook_deliveries").get() as { n: number }).n;
  return { ctx, count };
}

describe("agent_send end-to-end through buildApp and webhook fan-out", () => {
  it("a mailbox send publishes agent.message, writes a row, and queues no webhook delivery", async () => {
    const { ctx, count } = await makeApp();
    const seen: AgentEvent[] = [];
    const unsubscribe = subscribeAgentEvents((event) => { seen.push(event); });
    const rowsBefore = (ctx.sqlite.prepare("SELECT COUNT(*) AS n FROM agent_messages").get() as { n: number }).n;
    sendMessage(ctx.sqlite, { workspaceId: TEST_WORKSPACE_ID, from: "codex/bound", to: "duty", kind: "report", body: "hello" }, new Date());
    unsubscribe();
    expect(seen.filter((e) => e.type === "agent.message")).toHaveLength(1);
    expect((ctx.sqlite.prepare("SELECT COUNT(*) AS n FROM agent_messages").get() as { n: number }).n).toBe(rowsBefore + 1);
    expect(count()).toBe(0);
  });

  it("a control event on the same bus is delivered, so the zero above is meaningful", async () => {
    const { count } = await makeApp();
    publishAgentEvent({ type: "stage_finished", summary: "ok" }, { workspaceId: TEST_WORKSPACE_ID });
    expect(count()).toBe(1);
  });
});
