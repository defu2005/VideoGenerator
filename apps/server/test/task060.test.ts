import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { callTargetsOmniProvider } from "@vg/shared";
import { signWebhook } from "../src/events/webhookSign.js";
import { openDatabase } from "../src/db/client.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { listAgentEvents, publishAgentEvent, resetAgentEvents } from "../src/events/agentBus.js";
import { createWebhookEndpoint, deliverDueWebhooks, enqueueWebhookDeliveries } from "../src/events/webhooks.js";
import { TokenVault } from "../src/publishing/tokenVault.js";
import { setVisualCopyrightMode, visualCopyrightMode } from "../src/services/visualPolicy.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("TASK-060 quota match and events", () => {
  it("does not treat a blocked grok-cli quota as a wait for an sopen model", () => {
    expect(callTargetsOmniProvider("omniroute", "sopen/gemini-3.8-flash-high", "grok-cli")).toBe(false);
  });

  it("replays events after Last-Event-ID and filters by type", () => {
    resetAgentEvents();
    const first = publishAgentEvent({ type: "stage_started", projectId: "11111111-1111-4111-8111-111111111111", summary: "a" });
    publishAgentEvent({ type: "stage_finished", projectId: "11111111-1111-4111-8111-111111111111", summary: "b" });
    publishAgentEvent({ type: "quota_wait", summary: "c" });
    const replay = listAgentEvents({ since: first.id });
    expect(replay.map((event) => event.type)).toEqual(["stage_finished", "quota_wait"]);
    expect(listAgentEvents({ types: ["quota_wait"] })).toHaveLength(1);
  });

  it("delivers a signed webhook without blocking the event publish", async () => {
    const root = mkdtempSync(join(tmpdir(), "vg-task060-"));
    roots.push(root);
    const opened = openDatabase(join(root, "app.db"));
    migrateDatabase(opened.db);
    const vault = new TokenVault(opened.sqlite, root, Buffer.alloc(32, 7).toString("base64"));
    const created = createWebhookEndpoint(opened.sqlite, vault, {
      name: "local", url: "http://127.0.0.1:9/hook", eventTypes: ["stage_started"],
    });
    const event = publishAgentEvent({ type: "stage_started", summary: "bắt đầu" });
    enqueueWebhookDeliveries(opened.sqlite, event);
    const pending = opened.sqlite.prepare("SELECT status FROM webhook_deliveries").get() as { status: string };
    expect(pending.status).toBe("pending");
    let signature = "";
    await deliverDueWebhooks(opened.sqlite, vault, async (_url, init) => {
      signature = new Headers(init?.headers).get("webhook-signature") ?? "";
      const id = new Headers(init?.headers).get("webhook-id") ?? "";
      const timestamp = new Headers(init?.headers).get("webhook-timestamp") ?? "";
      expect(signature).toBe(signWebhook(id, timestamp, String(init?.body), created.secret));
      return new Response("ok", { status: 200 });
    });
    const sent = opened.sqlite.prepare("SELECT status FROM webhook_deliveries").get() as { status: string };
    expect(sent.status).toBe("sent");
    expect(JSON.stringify(listWebhookSafe(opened.sqlite))).not.toContain(created.secret);
    opened.sqlite.close();
  });

  it("keeps copyrighted stills off until the user changes the profile", () => {
    const root = mkdtempSync(join(tmpdir(), "vg-task060-visual-"));
    roots.push(root);
    const opened = openDatabase(join(root, "app.db"));
    migrateDatabase(opened.db);
    const profileId = "22222222-2222-4222-8222-222222222222";
    expect(visualCopyrightMode(opened.sqlite, profileId)).toBe("off");
    setVisualCopyrightMode(opened.sqlite, profileId, "commentary");
    expect(visualCopyrightMode(opened.sqlite, profileId)).toBe("commentary");
    opened.sqlite.close();
  });
});

function listWebhookSafe(sqlite: import("better-sqlite3").Database): unknown {
  return sqlite.prepare("SELECT id, name, url, enabled FROM webhook_endpoints").all();
}
