import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { parseConfig } from "../src/lib/config.js";
import { saveKeyProfile } from "../src/supervision/identity.js";
import { sendMessage } from "../src/supervision/mailbox.js";
import { TEST_WORKSPACE_ID, TEST_OTHER_WORKSPACE_ID, testActor } from "./testActor.js";

const apps: Array<{ close(): Promise<unknown> }> = [];
const roots: string[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const T0 = new Date();
function makeApp(root: string, actor: Record<string, unknown>) {
  const config = parseConfig({ DATA_DIR: root, DATABASE_PATH: join(root, "app.db"), WORKER_ENABLED: "false", LOG_LEVEL: "silent", LLM_ENABLE_MOCK: "true", LLM_DEFAULT_PROVIDER: "mock", TTS_PROVIDER: "mock", IMAGE_PROVIDERS: "mock" });
  const app = buildApp({ config, testActor: { ...testActor, ...actor } as never });
  apps.push(app);
  return app;
}

/** Seeds two agent keys and one message from codex/review to codex/music in the test workspace. */
async function setup() {
  const root = mkdtempSync(join(tmpdir(), "vg-peek-route-")); roots.push(root);
  const owner = makeApp(root, { kind: "apikey", keyId: "mail-music" });
  const sqlite = owner.vgAssistant.service.toolContext().sqlite;
  saveKeyProfile(sqlite, "mail-music", { agentKind: "codex", instanceName: "music" });
  saveKeyProfile(sqlite, "mail-review", { agentKind: "codex", instanceName: "review" });
  saveKeyProfile(sqlite, "mail-anon", { agentKind: "codex", instanceName: "unknown" });
  const stamp = T0.toISOString();
  for (const instance of ["codex/music", "codex/review"]) {
    sqlite.prepare("INSERT INTO agent_instances (instance, kind, last_seen_at, on_duty) VALUES (?, ?, ?, ?)").run(instance, "codex", stamp, 0);
  }
  const row = sendMessage(sqlite, { workspaceId: TEST_WORKSPACE_ID, from: "codex/review", to: "codex/music", kind: "report", body: "BODY-SECRET-TEXT" }, T0);
  return { root, row, owner };
}

describe("GET /api/agents/mailbox/peek", () => {
  it("gives the recipient its message id and never the body", async () => {
    const { root, row } = await setup();
    const app = makeApp(root, { kind: "apikey", keyId: "mail-music" });
    const res = await app.inject({ method: "GET", url: "/api/agents/mailbox/peek" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { messages: Array<{ id: string }> };
    expect(body.messages.map((m) => m.id)).toEqual([row.id]);
    expect(res.body).not.toContain("BODY-SECRET-TEXT");
  });

  it("gives another instance nothing", async () => {
    const { root } = await setup();
    const app = makeApp(root, { kind: "apikey", keyId: "mail-review" });
    const res = await app.inject({ method: "GET", url: "/api/agents/mailbox/peek" });
    expect(res.json()).toEqual({ messages: [] });
  });

  it("refuses a key with no fixed instance name, even when a header claims one", async () => {
    const { root } = await setup();
    const app = makeApp(root, { kind: "apikey", keyId: "mail-anon" });
    const res = await app.inject({ method: "GET", url: "/api/agents/mailbox/peek", headers: { "x-agent-name": "music" } });
    expect(res.statusCode).toBe(403);
  });

  it("refuses a role without mailbox.use", async () => {
    const { root } = await setup();
    const app = makeApp(root, { kind: "apikey", keyId: "mail-music", role: "viewer" });
    const res = await app.inject({ method: "GET", url: "/api/agents/mailbox/peek" });
    expect(res.statusCode).toBe(403);
  });

  it("returns nothing from another workspace", async () => {
    const { root } = await setup();
    const app = makeApp(root, { kind: "apikey", keyId: "mail-music", workspaceId: TEST_OTHER_WORKSPACE_ID });
    const res = await app.inject({ method: "GET", url: "/api/agents/mailbox/peek" });
    expect(res.json()).toEqual({ messages: [] });
  });
});
