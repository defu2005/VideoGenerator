import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db/client.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { parseConfig, type AppConfig } from "../src/lib/config.js";
import {
  acceptToolProposal,
  checkToolProposalDone,
  listAcceptedToolProposals,
  listDoneToolProposals,
  listInProgressToolProposals,
  listToolProposals,
  recordToolProposal,
  startToolProposal,
} from "../src/operator/toolProposals.js";
import { testActor } from "./testActor.js";

// TASK-074c-6g: read-only list of done tool rows, with taskRef. No transition, no migration, no draft.
// Route: GET /api/operator/tool-proposals/done. Only the done list carries taskRef; the other lists keep their shape.
const OLD = "2026-11-20T00:00:00.000Z";

function freshDb() {
  const opened = openDatabase(":memory:");
  migrateDatabase(opened.db, undefined, opened.sqlite);
  return opened;
}

function proposalArgs(name: string) {
  return {
    kind: "internal", name,
    operation: "Đọc bản chép lời đã tạo", reproduction: "Mở dự án thử có file chép lời",
    impact: "Agent lấy được văn bản", inputSchema: { type: "object" }, outputSchema: { type: "object" },
    permissions: ["Đọc dự án được chọn"], dataSent: "Không gửi ra ngoài", requiresConfirmation: false,
    acceptance: ["Trả bản chép lời đúng dự án"],
  };
}

function insertRow(
  sqlite: { prepare: (sql: string) => { run: (...args: unknown[]) => unknown } },
  row: {
    id: string; kind?: string; status: string; proposal?: string; createdAt?: string;
    updatedAt?: string; impNumber?: number; drafted?: boolean; taskRef?: string;
  },
) {
  const created = row.createdAt ?? OLD;
  const updated = row.updatedAt ?? created;
  sqlite.prepare(`INSERT INTO improvement_requests (id, kind, title, problem, proposal, evidence, acceptance, status, weight, fingerprint, created_at, updated_at, imp_number, drafted_at, task_ref)
    VALUES (?, ?, 'Tiêu đề', 'Vấn đề', ?, '[]', '[]', ?, 1, ?, ?, ?, ?, ?, ?)`)
    .run(row.id, row.kind ?? "tool", row.proposal ?? JSON.stringify(proposalArgs(`tool_${row.id.replace(/[^a-z0-9]/gi, "_")}`)),
      row.status, `${row.kind ?? "tool"}:internal:${row.id}`, created, updated,
      row.impNumber ?? null, row.drafted ? "2026-11-20T01:00:00.000Z" : null, row.taskRef ?? null);
}

function idsOf(items: Array<{ id: string }>) {
  return items.map((item) => item.id);
}

describe("TASK-074c-6g: listDoneToolProposals returns only done tool rows", () => {
  it("lists done tool rows and nothing else", () => {
    const { sqlite } = freshDb();
    insertRow(sqlite, { id: "done-1", status: "done", taskRef: "TASK-A" });
    insertRow(sqlite, { id: "open-1", status: "open" });
    insertRow(sqlite, { id: "acc-1", status: "accepted" });
    insertRow(sqlite, { id: "prog-1", status: "in_progress" });
    insertRow(sqlite, { id: "rej-1", status: "rejected" });
    insertRow(sqlite, { id: "ver-1", status: "verified" });
    insertRow(sqlite, { id: "fail-1", status: "failed_verification" });
    insertRow(sqlite, { id: "feat-1", kind: "feature", status: "done" });
    expect(idsOf(listDoneToolProposals(sqlite))).toEqual(["done-1"]);
  });

  it("returns the item shape with taskRef, impNumber and draftedAt from the row", () => {
    const { sqlite } = freshDb();
    insertRow(sqlite, { id: "done-shape", status: "done", createdAt: "2026-11-20T01:02:03.000Z", impNumber: 9, drafted: true, taskRef: "TASK-074c-6e" });
    const [item] = listDoneToolProposals(sqlite);
    expect(item).toMatchObject({
      id: "done-shape",
      createdAt: "2026-11-20T01:02:03.000Z",
      kind: "internal",
      name: "tool_done_shape",
      reproduction: "Mở dự án thử có file chép lời",
      acceptance: ["Trả bản chép lời đúng dự án"],
      impNumber: 9,
      draftedAt: "2026-11-20T01:00:00.000Z",
      taskRef: "TASK-074c-6e",
    });
  });

  it("gives taskRef null when the row has no task_ref", () => {
    const { sqlite } = freshDb();
    insertRow(sqlite, { id: "done-no-ref", status: "done" });
    const [item] = listDoneToolProposals(sqlite);
    expect(item).toHaveProperty("taskRef", null);
  });

  it("orders by updated_at newest first, not by created_at", () => {
    const { sqlite } = freshDb();
    // created_at and updated_at disagree on purpose: by created_at the order would be b, c, a.
    insertRow(sqlite, { id: "ord-a", status: "done", createdAt: "2026-11-20T00:00:01.000Z", updatedAt: "2026-11-20T00:00:09.000Z" });
    insertRow(sqlite, { id: "ord-b", status: "done", createdAt: "2026-11-20T00:00:05.000Z", updatedAt: "2026-11-20T00:00:02.000Z" });
    insertRow(sqlite, { id: "ord-c", status: "done", createdAt: "2026-11-20T00:00:03.000Z", updatedAt: "2026-11-20T00:00:05.000Z" });
    expect(idsOf(listDoneToolProposals(sqlite))).toEqual(["ord-a", "ord-c", "ord-b"]);
  });

  it("caps at 50 and keeps the newest by updated_at", () => {
    const { sqlite } = freshDb();
    for (let i = 0; i <= 50; i += 1) {
      insertRow(sqlite, { id: `done-${i}`, status: "done", updatedAt: `2026-11-20T00:00:${String(i).padStart(2, "0")}.000Z` });
    }
    const items = listDoneToolProposals(sqlite);
    expect(items).toHaveLength(50);
    expect(items[0]?.id).toBe("done-50");
    expect(idsOf(items)).not.toContain("done-0");
  });

  it("skips a row whose stored proposal is not valid, and warns with its id", () => {
    const { sqlite } = freshDb();
    insertRow(sqlite, { id: "done-good", status: "done" });
    insertRow(sqlite, { id: "done-bad", status: "done", proposal: "{not json" });
    const warnings: unknown[] = [];
    const logger = { warn: (obj: unknown) => { warnings.push(obj); } };
    expect(idsOf(listDoneToolProposals(sqlite, logger))).toEqual(["done-good"]);
    expect(warnings).toEqual([{ id: "done-bad" }]);
  });

  it("the other lists keep their shape: no taskRef key, even when the row has a task_ref", () => {
    const { sqlite } = freshDb();
    insertRow(sqlite, { id: "open-ref", status: "open" });
    insertRow(sqlite, { id: "acc-ref", status: "accepted", drafted: true });
    insertRow(sqlite, { id: "prog-ref", status: "in_progress", drafted: true });
    sqlite.prepare("UPDATE improvement_requests SET task_ref = 'TASK-LEAK' WHERE id IN ('open-ref', 'acc-ref', 'prog-ref')").run();
    const [open] = listToolProposals(sqlite);
    const [accepted] = listAcceptedToolProposals(sqlite);
    const [inProgress] = listInProgressToolProposals(sqlite);
    expect(open).not.toHaveProperty("taskRef");
    expect(accepted).not.toHaveProperty("taskRef");
    expect(inProgress).not.toHaveProperty("taskRef");
  });

  it("a row checked done by checkToolProposalDone is listed here with its taskRef, and leaves the in-progress list", () => {
    const { sqlite } = freshDb();
    const tasksRoot = mkdtempSync(join(tmpdir(), "vg-done-list-tasks-"));
    try {
      expect(recordToolProposal(sqlite, proposalArgs("read_done_fixture") as never, new Set()).status).toBe("proposed");
      const id = (sqlite.prepare("SELECT id FROM improvement_requests WHERE kind = 'tool'").get() as { id: string }).id;
      acceptToolProposal(sqlite, id);
      // The draft is simulated by its markers, as in the in-progress test. No draft file is written.
      sqlite.prepare("UPDATE improvement_requests SET drafted_at = ?, imp_number = 4 WHERE id = ?").run(OLD, id);
      startToolProposal(sqlite, id);
      expect(idsOf(listInProgressToolProposals(sqlite))).toEqual([id]);
      expect(listDoneToolProposals(sqlite)).toEqual([]);

      writeFileSync(join(tasksRoot, "TASK-074c-6x.done"), "");
      checkToolProposalDone(sqlite, id, "TASK-074c-6x", tasksRoot);

      expect(listInProgressToolProposals(sqlite)).toEqual([]);
      const done = listDoneToolProposals(sqlite);
      expect(idsOf(done)).toEqual([id]);
      expect(done[0]).toMatchObject({ taskRef: "TASK-074c-6x", impNumber: 4 });
    } finally {
      rmSync(tasksRoot, { recursive: true, force: true });
    }
  });
});

// Route tests go through the real app. Reading is not a decision, so the route has no user-only check.
const root = mkdtempSync(join(tmpdir(), "vg-done-list-"));
let app: ReturnType<typeof buildApp>;

function sqlite() {
  return (app.vgPublish.service as unknown as { sqlite: import("better-sqlite3").Database }).sqlite;
}

beforeAll(() => {
  const config: AppConfig = parseConfig({
    DATA_DIR: join(root, "data"),
    DATABASE_PATH: join(root, "done-list.db"),
    PORT: "3016",
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
  app = buildApp({ testActor, config });
});

afterAll(async () => {
  await app.close();
  rmSync(root, { recursive: true, force: true });
});

describe("TASK-074c-6g: GET /api/operator/tool-proposals/done", () => {
  it("returns { items } of done tool rows with taskRef", async () => {
    const doneId = randomUUID();
    const progId = randomUUID();
    insertRow(sqlite(), { id: doneId, status: "done", taskRef: "TASK-ROUTE-1" });
    insertRow(sqlite(), { id: progId, status: "in_progress" });
    const response = await app.inject({ method: "GET", url: "/api/operator/tool-proposals/done" });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { items: Array<{ id: string; taskRef: string | null }> };
    expect(idsOf(body.items)).toContain(doneId);
    expect(idsOf(body.items)).not.toContain(progId);
    expect(body.items.find((item) => item.id === doneId)?.taskRef).toBe("TASK-ROUTE-1");
  });

  it("is readable by an API-key caller, so reading has no user-only check", async () => {
    const doneId = randomUUID();
    insertRow(sqlite(), { id: doneId, status: "done", taskRef: "TASK-ROUTE-KEY" });
    const saved = { kind: testActor.kind, keyId: testActor.keyId };
    try {
      testActor.kind = "apikey";
      testActor.keyId = "done-list-test-key";
      const response = await app.inject({ method: "GET", url: "/api/operator/tool-proposals/done" });
      expect(response.statusCode).toBe(200);
      expect(idsOf((response.json() as { items: Array<{ id: string }> }).items)).toContain(doneId);
    } finally {
      testActor.kind = saved.kind;
      testActor.keyId = saved.keyId;
    }
  });
});
