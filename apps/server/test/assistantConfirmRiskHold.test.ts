import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { Project } from "@vg/shared";
import { buildApp } from "../src/app.js";
import { testActor, TEST_WORKSPACE_ID } from "./testActor.js";
import { parseConfig, type AppConfig } from "../src/lib/config.js";
import { clearAssistantChatScript, setAssistantChatScript } from "../src/providers/llm/mock.js";

// TASK-129c: through the real assistant service. A confirm-risk tool with projectId holds that project's
// producing mission at creation; confirm success or reject returns it to producing; expiry leaves it waiting;
// a failed confirm leaves it waiting. Uses the mock LLM script and a local app.db (no network).
const root = mkdtempSync(join(tmpdir(), "vg-assistant-risk-test-"));
let config: AppConfig;
let app: ReturnType<typeof buildApp>;

function sqlite(): Database.Database {
  return (app.vgPublish.service as unknown as { sqlite: Database.Database }).sqlite;
}

beforeAll(() => {
  config = parseConfig({
    DATA_DIR: join(root, "data"),
    DATABASE_PATH: join(root, "assistant.db"),
    PORT: "3001",
    HOST: "127.0.0.1",
    LOG_LEVEL: "silent",
    CORS_ORIGIN: "http://localhost:5173",
    WEB_BASE_URL: "http://localhost:5180",
    LLM_ENABLE_MOCK: "true",
    LLM_DEFAULT_PROVIDER: "mock",
    TTS_PROVIDER: "mock",
    WORKER_ENABLED: "false",
    FAKE_STAGE_DELAY_MS: "0",
    TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  });
});

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: false }), { status: 500 })));
  const dataDir = join(root, `data-${randomUUID()}`);
  app = buildApp({ testActor, config: { ...config, DATA_DIR: dataDir, DATABASE_PATH: join(dataDir, "app.db") } });
});

afterEach(async () => {
  clearAssistantChatScript();
  vi.restoreAllMocks();
  await app.close();
  vi.unstubAllGlobals();
});

afterAll(() => {
  try { rmSync(root, { recursive: true, force: true }); } catch { /* Windows cleanup races */ }
});

async function createProject(): Promise<Project> {
  const res = await app.inject({ method: "POST", url: "/api/projects", payload: { topic: `Dự án ${randomUUID().slice(0, 8)}`, mode: "ASSISTED" } });
  expect(res.statusCode).toBe(201);
  return res.json<Project>();
}

function insertMission(id: string, state: string, projectId: string) {
  const now = new Date().toISOString();
  sqlite().prepare(
    `INSERT INTO missions (id, workspace_id, created_by, command, project_ids, plan, state, owner, autonomy_level, created_at, updated_at)
     VALUES (?, ?, 'user', 'x', ?, '[]', ?, NULL, 'assist', ?, ?)`,
  ).run(id, TEST_WORKSPACE_ID, JSON.stringify([projectId]), state, now, now);
}

const stateOf = (id: string) => (sqlite().prepare("SELECT state FROM missions WHERE id = ?").get(id) as { state: string }).state;

/** Asks the assistant to propose a confirm-risk action on the project; returns the new pending action id. */
async function proposeAction(tool: string, args: Record<string, unknown>): Promise<string> {
  setAssistantChatScript([{ reply: "", done: false, calls: [{ tool, args }] }]);
  const conv = await app.inject({ method: "POST", url: "/api/assistant/conversations", payload: {} });
  const conversationId = conv.json<{ id: string }>().id;
  const send = await app.inject({ method: "POST", url: `/api/assistant/conversations/${conversationId}/messages`, payload: { text: "thử" } });
  const pending = send.json<{ pendingActions: Array<{ id: string }> }>().pendingActions;
  expect(pending).toHaveLength(1);
  return pending[0]!.id;
}

const timeoutArgs = (projectId: string) => ({ projectId, stages: { SCRIPT: 600_000 } });

it("creating the confirm-risk action holds the project's producing mission", async () => {
  const project = await createProject();
  insertMission("m-held", "producing", project.id);
  await proposeAction("update_stage_timeouts", timeoutArgs(project.id));
  expect(stateOf("m-held")).toBe("waiting_user");
});

it("confirming successfully returns the mission to producing", async () => {
  const project = await createProject();
  insertMission("m-ok", "producing", project.id);
  const actionId = await proposeAction("update_stage_timeouts", timeoutArgs(project.id));
  const confirm = await app.inject({ method: "POST", url: `/api/assistant/actions/${actionId}/confirm` });
  expect(confirm.statusCode).toBe(200);
  expect(stateOf("m-ok")).toBe("producing");
});

it("rejecting returns the mission to producing", async () => {
  const project = await createProject();
  insertMission("m-rej", "producing", project.id);
  const actionId = await proposeAction("update_stage_timeouts", timeoutArgs(project.id));
  const reject = await app.inject({ method: "POST", url: `/api/assistant/actions/${actionId}/reject` });
  expect(reject.statusCode).toBe(200);
  expect(stateOf("m-rej")).toBe("producing");
});

it("an expired action never releases the mission, which stays waiting for the user", async () => {
  const project = await createProject();
  insertMission("m-exp", "producing", project.id);
  const actionId = await proposeAction("update_stage_timeouts", timeoutArgs(project.id));
  sqlite().prepare("UPDATE assistant_pending_actions SET expires_at = ? WHERE id = ?").run("2020-01-01T00:00:00.000Z", actionId);
  const confirm = await app.inject({ method: "POST", url: `/api/assistant/actions/${actionId}/confirm` });
  expect(confirm.statusCode).toBe(409);
  expect(stateOf("m-exp")).toBe("waiting_user");
});

it("a failed confirm leaves the mission waiting: the release runs only after success", async () => {
  const project = await createProject();
  insertMission("m-fail", "producing", project.id);
  const actionId = await proposeAction("update_stage_timeouts", timeoutArgs(project.id));
  expect(stateOf("m-fail")).toBe("waiting_user");
  // Point the action at a project that does not exist, so the tool fails when confirmed.
  sqlite().prepare("UPDATE assistant_pending_actions SET args = ? WHERE id = ?")
    .run(JSON.stringify(timeoutArgs(randomUUID())), actionId);
  const confirm = await app.inject({ method: "POST", url: `/api/assistant/actions/${actionId}/confirm` });
  expect(confirm.statusCode).not.toBe(200);
  expect(stateOf("m-fail")).toBe("waiting_user");
});

it("rejecting does not resume a mission whose project is still at a user gate", async () => {
  const project = await createProject();
  insertMission("m-gate", "producing", project.id);
  const actionId = await proposeAction("update_stage_timeouts", timeoutArgs(project.id));
  // The project also reaches a gate that needs a person while the action is pending.
  sqlite().prepare("INSERT INTO project_stages (project_id, stage, state, progress, updated_at) VALUES (?, 'SCRIPT', 'WAITING_USER', 0, ?)")
    .run(project.id, new Date().toISOString());
  const reject = await app.inject({ method: "POST", url: `/api/assistant/actions/${actionId}/reject` });
  expect(reject.statusCode).toBe(200);
  expect(stateOf("m-gate")).toBe("waiting_user");
});

// KNOWN LIMIT (not a fix): the release resumes every waiting_user mission of the project, not only the one
// the released action held. Here an earlier action expired and stayed held (status 'expired', so it no longer
// blocks), and rejecting an unrelated later action resumes that mission without a person's decision on it.
// Documented in docs/user-guide/tu-van-hanh.md; a real fix needs the hold owner stored on the action.
it("known limit: rejecting a later action resumes a mission whose earlier hold had expired", async () => {
  const project = await createProject();
  insertMission("m-limit", "producing", project.id);
  const expiredId = await proposeAction("update_stage_timeouts", timeoutArgs(project.id));
  sqlite().prepare("UPDATE assistant_pending_actions SET expires_at = ? WHERE id = ?").run("2020-01-01T00:00:00.000Z", expiredId);
  const confirm = await app.inject({ method: "POST", url: `/api/assistant/actions/${expiredId}/confirm` });
  expect(confirm.statusCode).toBe(409);
  expect(stateOf("m-limit")).toBe("waiting_user");
  const laterId = await proposeAction("update_stage_timeouts", timeoutArgs(project.id));
  const reject = await app.inject({ method: "POST", url: `/api/assistant/actions/${laterId}/reject` });
  expect(reject.statusCode).toBe(200);
  expect(stateOf("m-limit")).toBe("producing");
});
