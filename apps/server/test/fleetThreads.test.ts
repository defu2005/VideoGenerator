import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { parseConfig } from "../src/lib/config.js";
import { saveKeyProfile } from "../src/supervision/identity.js";
import { inbox, sendMessage } from "../src/supervision/mailbox.js";
import { TEST_OTHER_WORKSPACE_ID, TEST_WORKSPACE_ID, testActor } from "./testActor.js";

// TASK-129a step 6 (server): the user's thread list, thread read and thread post over HTTP.
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

/** One thread in the test workspace: codex/review reports to codex/music with a secret body. */
function setup() {
  const root = mkdtempSync(join(tmpdir(), "vg-fleet-threads-")); roots.push(root);
  const seed = makeApp(root, { kind: "apikey", keyId: "thread-music" });
  const sqlite = seed.vgAssistant.service.toolContext().sqlite;
  saveKeyProfile(sqlite, "thread-music", { agentKind: "codex", instanceName: "music" });
  const stamp = T0.toISOString();
  for (const instance of ["codex/music", "codex/review"]) {
    sqlite.prepare("INSERT INTO agent_instances (instance, kind, last_seen_at, on_duty) VALUES (?, ?, ?, ?)").run(instance, "codex", stamp, 0);
  }
  const row = sendMessage(sqlite, { workspaceId: TEST_WORKSPACE_ID, from: "codex/review", to: "codex/music", kind: "report", body: "BODY-SECRET-TEXT" }, T0);
  return { root, sqlite, row };
}

describe("fleet threads for the user", () => {
  it("lists the workspace's threads as summaries, with no bodies", async () => {
    const { root, row } = setup();
    const user = makeApp(root, {});
    const res = await user.inject({ method: "GET", url: "/api/operator/fleet/threads" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { threads: Array<{ threadId: string; messages: number; lastFrom: string }> };
    expect(body.threads).toEqual([expect.objectContaining({ threadId: row.threadId, messages: 1, lastFrom: "codex/review" })]);
    expect(res.body).not.toContain("BODY-SECRET-TEXT");
  });

  it("reads one thread with every message body", async () => {
    const { root, row } = setup();
    const user = makeApp(root, {});
    const res = await user.inject({ method: "GET", url: `/api/operator/fleet/threads/${row.threadId}` });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { messages: Array<{ body: string }> }).messages.map((m) => m.body)).toEqual(["BODY-SECRET-TEXT"]);
  });

  it("another workspace sees no threads and gets 404 for a thread it does not own", async () => {
    const { root, row } = setup();
    const user = makeApp(root, { workspaceId: TEST_OTHER_WORKSPACE_ID });
    expect((await user.inject({ method: "GET", url: "/api/operator/fleet/threads" })).json()).toEqual({ threads: [] });
    const read = await user.inject({ method: "GET", url: `/api/operator/fleet/threads/${row.threadId}` });
    expect(read.statusCode).toBe(404);
    const post = await user.inject({ method: "POST", url: `/api/operator/fleet/threads/${row.threadId}/messages`, payload: { to: "codex/music", body: "hi" } });
    expect(post.statusCode).toBe(404);
  });

  it("refuses a machine key on read, list and post", async () => {
    const { root, row } = setup();
    const key = makeApp(root, { kind: "apikey", keyId: "thread-music" });
    expect((await key.inject({ method: "GET", url: "/api/operator/fleet/threads" })).statusCode).toBe(403);
    expect((await key.inject({ method: "GET", url: `/api/operator/fleet/threads/${row.threadId}` })).statusCode).toBe(403);
    expect((await key.inject({ method: "POST", url: `/api/operator/fleet/threads/${row.threadId}/messages`, payload: { to: "codex/music", body: "hi" } })).statusCode).toBe(403);
  });

  it("posts a user message that stays a directive and reaches the recipient's inbox", async () => {
    const { root, sqlite, row } = setup();
    const user = makeApp(root, {});
    const res = await user.inject({ method: "POST", url: `/api/operator/fleet/threads/${row.threadId}/messages`, payload: { to: "codex/music", body: "làm tiếp đi" } });
    expect(res.statusCode).toBe(201);
    const posted = (res.json() as { message: { kind: string; fromInstance: string; threadId: string } }).message;
    expect(posted).toMatchObject({ kind: "directive", fromInstance: "user", threadId: row.threadId });
    const mine = inbox(sqlite, TEST_WORKSPACE_ID, "codex/music", { now: new Date() });
    expect(mine.map((m) => m.body)).toContain("làm tiếp đi");
  });

  it("downgrades a user post to an unresolvable role to a question (nobody holds the role)", async () => {
    const { root, row } = setup();
    const user = makeApp(root, {});
    const res = await user.inject({ method: "POST", url: `/api/operator/fleet/threads/${row.threadId}/messages`, payload: { to: "role:no_such_role", body: "ai nhận?" } });
    expect(res.statusCode).toBe(201);
    expect((res.json() as { message: { kind: string } }).message.kind).toBe("question");
  });

  it("rejects a body over 8 KB with 422", async () => {
    const { root, row } = setup();
    const user = makeApp(root, {});
    const res = await user.inject({ method: "POST", url: `/api/operator/fleet/threads/${row.threadId}/messages`, payload: { to: "codex/music", body: "a".repeat(8193) } });
    expect(res.statusCode).toBe(422);
  });

  it("refuses a post into a thread that does not exist", async () => {
    const { root } = setup();
    const user = makeApp(root, {});
    const res = await user.inject({ method: "POST", url: "/api/operator/fleet/threads/no-such-thread/messages", payload: { to: "codex/music", body: "hi" } });
    expect(res.statusCode).toBe(404);
  });
});
