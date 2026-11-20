import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db/client.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { parseConfig, type AppConfig } from "../src/lib/config.js";
import { improvementSelfTuneStats } from "../src/operator/improvementSelfTune.js";
import { checkToolProposalDone, recordToolProposal, ToolProposalArgs, ToolProposalTaskRef } from "../src/operator/toolProposals.js";
import { testActor } from "./testActor.js";

// TASK-074c-6e: in_progress → done, gated by a .done file under an injected tasks root. Route: POST /api/operator/tool-proposals/:id/check-done.
// Every .done file in these tests lives in a temp directory. The tripwire at the bottom checks that docs/tasks is never written.
const OLD = "2026-11-20T00:00:00.000Z";
const DRAFTED = "2026-11-20T01:00:00.000Z";
const SENTINEL = "TEST-074C-6E-SENTINEL";
const REAL_TASKS_ROOT = fileURLToPath(new URL("../../../docs/tasks", import.meta.url));

function listDoneFiles(root: string): string[] {
  return readdirSync(root).filter((name) => name.endsWith(".done")).sort();
}
const realDoneBefore = listDoneFiles(REAL_TASKS_ROOT);

const createdRoots: string[] = [];
function tasksRootWith(names: string[]): string {
  const root = mkdtempSync(join(tmpdir(), "vg-check-done-"));
  createdRoots.push(root);
  for (const name of names) writeFileSync(join(root, `${name}.done`), "done\n");
  return root;
}

function freshDb() {
  const opened = openDatabase(":memory:");
  migrateDatabase(opened.db, undefined, opened.sqlite);
  return opened;
}

function proposalFor(name: string) {
  return {
    kind: "internal", name,
    operation: "Đọc bản chép lời đã tạo", reproduction: "Mở dự án thử có file chép lời",
    impact: "Agent lấy được văn bản", inputSchema: { type: "object" }, outputSchema: { type: "object" },
    permissions: ["Đọc dự án được chọn"], dataSent: "Không gửi ra ngoài", requiresConfirmation: false,
    acceptance: ["Trả bản chép lời đúng dự án"],
  };
}

type Row = { id: string; name: string; status: string; kind?: "tool" | "feature"; impNumber?: number; drafted?: boolean };

// The fingerprint is built the way recordToolProposal builds it (`<kind>:internal:<name>`), so a repeat of the same proposal can find this row.
function insertRow(sqlite: import("better-sqlite3").Database, row: Row) {
  const kind = row.kind ?? "tool";
  sqlite.prepare(`INSERT INTO improvement_requests (id, kind, title, problem, proposal, evidence, acceptance, status, weight, fingerprint, created_at, updated_at, imp_number, drafted_at)
    VALUES (?, ?, 'Tiêu đề', 'Vấn đề', ?, '[]', '[]', ?, 1, ?, ?, ?, ?, ?)`)
    .run(row.id, kind, JSON.stringify(proposalFor(row.name)), row.status, `${kind}:internal:${row.name}`, OLD, OLD,
      row.impNumber ?? null, row.drafted ? DRAFTED : null);
}

function rowOf(sqlite: import("better-sqlite3").Database, id: string) {
  return sqlite.prepare("SELECT * FROM improvement_requests WHERE id = ?").get(id) as Record<string, unknown>;
}

function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to throw");
}

afterAll(() => {
  for (const root of createdRoots) rmSync(root, { recursive: true, force: true });
});

describe("TASK-074c-6e: the task reference format", () => {
  it.each([
    ["TASK-067b-part3"], ["BUGFIX-117"], ["HERMES-GUIDE"], ["a"], ["A".repeat(64)],
  ])("accepts %s", (task) => {
    expect(ToolProposalTaskRef.safeParse(task).success).toBe(true);
  });

  it.each([
    ["../x"], ["a/b"], ["a\\b"], ["a.b"], [""], ["-lead"], ["a b"], ["TASK_X"], ["a".repeat(65)],
  ])("rejects %j", (task) => {
    expect(ToolProposalTaskRef.safeParse(task).success).toBe(false);
  });
});

describe("TASK-074c-6e: checkToolProposalDone moves only an in_progress tool row to done", () => {
  it("marks an in_progress tool row done with task_ref, and changes no other column but updated_at", () => {
    const { sqlite } = freshDb();
    const root = tasksRootWith(["TASK-OK"]);
    insertRow(sqlite, { id: "row-ok", name: "tool_ok", status: "in_progress", impNumber: 1, drafted: true });
    const before = rowOf(sqlite, "row-ok");
    checkToolProposalDone(sqlite, "row-ok", "TASK-OK", root);
    const after = rowOf(sqlite, "row-ok");
    expect(after.status).toBe("done");
    expect(after.task_ref).toBe("TASK-OK");
    expect(after.updated_at).not.toBe(OLD);
    expect(after.done_at).toBe(after.updated_at); // TASK-074c-5e: done_at is set in the same UPDATE (see toolProposalDoneAt.test.ts)
    for (const key of Object.keys(before)) {
      if (key === "status" || key === "task_ref" || key === "updated_at" || key === "done_at") continue;
      expect(after[key], key).toEqual(before[key]);
    }
  });

  it("refuses when the .done file is absent, and changes nothing", () => {
    const { sqlite } = freshDb();
    const root = tasksRootWith([]);
    insertRow(sqlite, { id: "row-none", name: "tool_none", status: "in_progress" });
    const before = rowOf(sqlite, "row-none");
    expect(thrownBy(() => checkToolProposalDone(sqlite, "row-none", "TASK-NONE", root)))
      .toMatchObject({ statusCode: 409, code: "OPERATOR_TASK_NOT_DONE" });
    expect(rowOf(sqlite, "row-none")).toEqual(before);
  });

  it.each([
    ["accepted"], ["open"], ["rejected"], ["done"], ["verified"], ["failed_verification"],
  ])("refuses a tool row whose status is %s even when the .done file exists", (status) => {
    const { sqlite } = freshDb();
    const root = tasksRootWith(["TASK-GUARD"]);
    insertRow(sqlite, { id: `row-${status}`, name: `tool_${status}`, status, drafted: true });
    const before = rowOf(sqlite, `row-${status}`);
    expect(thrownBy(() => checkToolProposalDone(sqlite, `row-${status}`, "TASK-GUARD", root)))
      .toMatchObject({ statusCode: 409, code: "OPERATOR_TOOL_PROPOSAL_NOT_IN_PROGRESS" });
    expect(rowOf(sqlite, `row-${status}`)).toEqual(before);
  });

  it("refuses a feature row in in_progress even when the .done file exists", () => {
    const { sqlite } = freshDb();
    const root = tasksRootWith(["TASK-FEAT"]);
    insertRow(sqlite, { id: "feat-1", kind: "feature", name: "feat_one", status: "in_progress" });
    const before = rowOf(sqlite, "feat-1");
    expect(thrownBy(() => checkToolProposalDone(sqlite, "feat-1", "TASK-FEAT", root)))
      .toMatchObject({ statusCode: 409, code: "OPERATOR_TOOL_PROPOSAL_NOT_IN_PROGRESS" });
    expect(rowOf(sqlite, "feat-1")).toEqual(before);
  });

  it("refuses a task name that fails the format before any file is checked, and changes nothing", () => {
    const { sqlite } = freshDb();
    const root = tasksRootWith(["TASK-OK"]);
    insertRow(sqlite, { id: "row-bad", name: "tool_bad", status: "in_progress" });
    const before = rowOf(sqlite, "row-bad");
    // The format check throws a ZodError before any file is looked at. Naming the error stops a TypeError from passing this test.
    expect(thrownBy(() => checkToolProposalDone(sqlite, "row-bad", "../TASK-OK", root))).toMatchObject({ name: "ZodError" });
    expect(rowOf(sqlite, "row-bad")).toEqual(before);
  });

  it("a row already in the self-tune window keeps the same stats after moving from in_progress to done", () => {
    const { sqlite } = freshDb();
    const root = tasksRootWith(["TASK-STAT"]);
    // 20 decided rows: 1 in_progress, 12 accepted, 7 rejected. 13 are not rejected, so the window is full and the rate is 65%.
    insertRow(sqlite, { id: "stat-ip", name: "tool_stat_ip", status: "in_progress" });
    for (let i = 0; i < 12; i += 1) insertRow(sqlite, { id: `stat-acc-${i}`, name: `tool_stat_acc_${i}`, status: "accepted" });
    for (let i = 0; i < 7; i += 1) insertRow(sqlite, { id: `stat-rej-${i}`, name: `tool_stat_rej_${i}`, status: "rejected" });
    const statsBefore = improvementSelfTuneStats(sqlite);
    expect(statsBefore).toEqual({ window: 20, decided: 20, accepted: 13, rate: 0.65, halved: false });
    checkToolProposalDone(sqlite, "stat-ip", "TASK-STAT", root);
    expect(rowOf(sqlite, "stat-ip").status).toBe("done");
    expect(improvementSelfTuneStats(sqlite)).toEqual(statsBefore);
  });

  it("while in_progress a repeat of the proposal is a duplicate; after done it creates a new open row", () => {
    const { sqlite } = freshDb();
    const root = tasksRootWith(["TASK-REPEAT"]);
    insertRow(sqlite, { id: "row-repeat", name: "tool_repeat_check", status: "in_progress" });
    const proposal = ToolProposalArgs.parse(proposalFor("tool_repeat_check"));
    const registry = new Set<string>();
    expect(recordToolProposal(sqlite, proposal, registry)).toMatchObject({ status: "duplicate", id: "row-repeat" });
    checkToolProposalDone(sqlite, "row-repeat", "TASK-REPEAT", root);
    const next = recordToolProposal(sqlite, proposal, registry);
    expect(next.status).toBe("proposed");
    expect(next.id).not.toBe("row-repeat");
    expect(sqlite.prepare("SELECT status FROM improvement_requests WHERE id = ?").get(next.id)).toEqual({ status: "open" });
    expect(rowOf(sqlite, "row-repeat").status).toBe("done");
  });
});

// Route tests go through the real app and the real user-only check. The actor is switched to an API key for the refusal case.
const routeRoot = mkdtempSync(join(tmpdir(), "vg-check-done-route-"));
createdRoots.push(routeRoot);
let app: ReturnType<typeof buildApp>;
let appWithoutTasksRoot: ReturnType<typeof buildApp>;

function configFor(dir: string): AppConfig {
  return parseConfig({
    DATA_DIR: join(dir, "data"),
    DATABASE_PATH: join(dir, "check-done.db"),
    PORT: "3015",
    HOST: "127.0.0.1",
    LOG_LEVEL: "silent",
    CORS_ORIGIN: "http://localhost:5173",
    WEB_BASE_URL: "http://localhost:5180",
    LLM_ENABLE_MOCK: "true",
    LLM_DEFAULT_PROVIDER: "mock",
    OPENAI_API_KEY: "fixture",
    OPENAI_BASE_URL: "https://operator-fixture.test/v1",
    OPENAI_MODEL: "fixture-model",
    TTS_PROVIDER: "mock",
    WORKER_ENABLED: "false",
    FAKE_STAGE_DELAY_MS: "0",
    TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  });
}

function sqliteOf(target: ReturnType<typeof buildApp>): import("better-sqlite3").Database {
  return (target.vgPublish.service as unknown as { sqlite: import("better-sqlite3").Database }).sqlite;
}

const sqlite = () => sqliteOf(app);

beforeAll(() => {
  const dirA = mkdtempSync(join(tmpdir(), "vg-check-done-app-"));
  const dirB = mkdtempSync(join(tmpdir(), "vg-check-done-noroot-"));
  createdRoots.push(dirA, dirB);
  writeFileSync(join(routeRoot, "TASK-OK.done"), "done\n");
  writeFileSync(join(routeRoot, `${SENTINEL}.done`), "done\n");
  writeFileSync(join(routeRoot, `${"B".repeat(64)}.done`), "done\n");
  app = buildApp({ testActor, config: configFor(dirA), tasksRoot: routeRoot });
  appWithoutTasksRoot = buildApp({ testActor, config: configFor(dirB) });
});

afterAll(async () => {
  await app.close();
  await appWithoutTasksRoot.close();
});

describe("TASK-074c-6e: POST /api/operator/tool-proposals/:id/check-done", () => {
  it("marks an in_progress row done for a user, and returns { ok: true }", async () => {
    const id = randomUUID();
    insertRow(sqlite(), { id, name: "tool_route_ok", status: "in_progress" });
    const response = await app.inject({ method: "POST", url: `/api/operator/tool-proposals/${id}/check-done`, payload: { task: "TASK-OK" } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(rowOf(sqlite(), id)).toMatchObject({ status: "done", task_ref: "TASK-OK" });
  });

  it("refuses an API-key caller with 403 and leaves the row in_progress", async () => {
    const id = randomUUID();
    insertRow(sqlite(), { id, name: "tool_route_apikey", status: "in_progress" });
    const saved = { kind: testActor.kind, keyId: testActor.keyId };
    try {
      testActor.kind = "apikey";
      testActor.keyId = "check-done-test-key";
      const refused = await app.inject({ method: "POST", url: `/api/operator/tool-proposals/${id}/check-done`, payload: { task: "TASK-OK" } });
      expect(refused.statusCode).toBe(403);
      expect(refused.json()).toMatchObject({ error: { code: "OPERATOR_TOOL_PROPOSAL_USER_ONLY" } });
      expect(rowOf(sqlite(), id)).toMatchObject({ status: "in_progress", task_ref: null });
    } finally {
      testActor.kind = saved.kind;
      testActor.keyId = saved.keyId;
    }
  });

  it("returns 409 OPERATOR_TASK_NOT_DONE when the task has no .done file, and touches nothing", async () => {
    const id = randomUUID();
    insertRow(sqlite(), { id, name: "tool_route_notdone", status: "in_progress" });
    const response = await app.inject({ method: "POST", url: `/api/operator/tool-proposals/${id}/check-done`, payload: { task: "TASK-MISSING" } });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: "OPERATOR_TASK_NOT_DONE" } });
    expect(rowOf(sqlite(), id)).toMatchObject({ status: "in_progress", task_ref: null });
  });

  it("returns 409 OPERATOR_TOOL_PROPOSAL_NOT_IN_PROGRESS for an accepted row even when the .done file exists", async () => {
    const id = randomUUID();
    insertRow(sqlite(), { id, name: "tool_route_accepted", status: "accepted", drafted: true });
    const response = await app.inject({ method: "POST", url: `/api/operator/tool-proposals/${id}/check-done`, payload: { task: "TASK-OK" } });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: "OPERATOR_TOOL_PROPOSAL_NOT_IN_PROGRESS" } });
    expect(rowOf(sqlite(), id)).toMatchObject({ status: "accepted", task_ref: null });
  });

  it("returns 400 when the body has no task, or an extra key", async () => {
    const id = randomUUID();
    insertRow(sqlite(), { id, name: "tool_route_body", status: "in_progress" });
    const missing = await app.inject({ method: "POST", url: `/api/operator/tool-proposals/${id}/check-done` });
    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    const extra = await app.inject({ method: "POST", url: `/api/operator/tool-proposals/${id}/check-done`, payload: { task: "TASK-OK", note: "x" } });
    expect(extra.statusCode).toBe(400);
    expect(extra.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    expect(rowOf(sqlite(), id)).toMatchObject({ status: "in_progress", task_ref: null });
  });

  it.each([
    ["../TASK-OK"], ["TASK-OK.txt"], ["a".repeat(65)],
  ])("returns 400 for the task %j and touches nothing", async (task) => {
    const id = randomUUID();
    insertRow(sqlite(), { id, name: `tool_route_bad_${Math.abs(task.length)}`, status: "in_progress" });
    const response = await app.inject({ method: "POST", url: `/api/operator/tool-proposals/${id}/check-done`, payload: { task } });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    expect(rowOf(sqlite(), id)).toMatchObject({ status: "in_progress", task_ref: null });
  });

  it("accepts a 64-character task name when its .done file exists", async () => {
    const id = randomUUID();
    insertRow(sqlite(), { id, name: "tool_route_64", status: "in_progress" });
    const response = await app.inject({ method: "POST", url: `/api/operator/tool-proposals/${id}/check-done`, payload: { task: "B".repeat(64) } });
    expect(response.statusCode).toBe(200);
    expect(rowOf(sqlite(), id)).toMatchObject({ status: "done", task_ref: "B".repeat(64) });
  });

  it("rejects an id that is not a uuid and touches nothing", async () => {
    const id = randomUUID();
    insertRow(sqlite(), { id, name: "tool_route_uuid", status: "in_progress" });
    const response = await app.inject({ method: "POST", url: "/api/operator/tool-proposals/not-a-uuid/check-done", payload: { task: "TASK-OK" } });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    expect(rowOf(sqlite(), id)).toMatchObject({ status: "in_progress", task_ref: null });
  });

  it("returns 503 OPERATOR_TASKS_ROOT_UNAVAILABLE when the app was built without a tasks root, and touches nothing", async () => {
    const id = randomUUID();
    insertRow(sqliteOf(appWithoutTasksRoot), { id, name: "tool_route_noroot", status: "in_progress" });
    const response = await appWithoutTasksRoot.inject({ method: "POST", url: `/api/operator/tool-proposals/${id}/check-done`, payload: { task: "TASK-OK" } });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: { code: "OPERATOR_TASKS_ROOT_UNAVAILABLE" } });
    expect(rowOf(sqliteOf(appWithoutTasksRoot), id)).toMatchObject({ status: "in_progress", task_ref: null });
  });
});

// The real docs/tasks must never receive a .done from these tests. The snapshot is taken when this file loads, before any test runs.
describe("TASK-074c-6e: tripwire", () => {
  it("leaves docs/tasks without any new .done file and without the sentinel", () => {
    expect(listDoneFiles(REAL_TASKS_ROOT)).toEqual(realDoneBefore);
    expect(existsSync(join(REAL_TASKS_ROOT, `${SENTINEL}.done`))).toBe(false);
  });
});
