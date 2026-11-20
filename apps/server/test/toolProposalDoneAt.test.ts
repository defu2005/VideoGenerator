import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/client.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { acceptToolProposal, checkToolProposalDone, startToolProposal } from "../src/operator/toolProposals.js";

// TASK-074c-5e (slice 5e-1): check-done records when the row became done, in the same UPDATE and with the same timestamp as updated_at.
// A refused check-done changes nothing, so done_at stays null. The .done files live in a temp directory, never in docs/tasks.
const OLD = "2026-11-20T00:00:00.000Z";
const REAL_TASKS_ROOT = fileURLToPath(new URL("../../../docs/tasks", import.meta.url));

function listDoneFiles(root: string): string[] {
  return readdirSync(root).filter((name) => name.endsWith(".done")).sort();
}
const realDoneBefore = listDoneFiles(REAL_TASKS_ROOT);

const createdRoots: string[] = [];
function tasksRootWith(names: string[]): string {
  const root = mkdtempSync(join(tmpdir(), "vg-done-at-"));
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

type Row = { id: string; name: string; status: string; doneAt?: string };

function insertRow(sqlite: import("better-sqlite3").Database, row: Row) {
  sqlite.prepare(`INSERT INTO improvement_requests (id, kind, title, problem, proposal, evidence, acceptance, status, weight, fingerprint, created_at, updated_at, done_at)
    VALUES (?, 'tool', 'Tiêu đề', 'Vấn đề', ?, '[]', '[]', ?, 1, ?, ?, ?, ?)`)
    .run(row.id, JSON.stringify(proposalFor(row.name)), row.status, `tool:internal:${row.name}`, OLD, OLD, row.doneAt ?? null);
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

describe("TASK-074c-5e: check-done records done_at with the same timestamp as updated_at", () => {
  it("sets done_at, equal to updated_at, when an in_progress row moves to done", () => {
    const { sqlite } = freshDb();
    const root = tasksRootWith(["TASK-OK"]);
    insertRow(sqlite, { id: "row-ok", name: "tool_ok", status: "in_progress" });
    checkToolProposalDone(sqlite, "row-ok", "TASK-OK", root);
    const after = rowOf(sqlite, "row-ok");
    expect(after.status).toBe("done");
    expect(after.done_at).not.toBeNull();
    expect(after.done_at).not.toBe(OLD);
    expect(after.done_at).toBe(after.updated_at);
  });

  it("leaves done_at null when the .done file is absent, and the row stays in_progress", () => {
    const { sqlite } = freshDb();
    const root = tasksRootWith([]);
    insertRow(sqlite, { id: "row-none", name: "tool_none", status: "in_progress" });
    const error = thrownBy(() => checkToolProposalDone(sqlite, "row-none", "TASK-NONE", root));
    expect(error).toMatchObject({ code: "OPERATOR_TASK_NOT_DONE" });
    const after = rowOf(sqlite, "row-none");
    expect(after.status).toBe("in_progress");
    expect(after.done_at).toBeNull();
  });

  it("leaves done_at unchanged when the row is not in_progress, even if the .done file exists", () => {
    const { sqlite } = freshDb();
    const root = tasksRootWith(["TASK-OK"]);
    insertRow(sqlite, { id: "row-open", name: "tool_open", status: "open" });
    insertRow(sqlite, { id: "row-done", name: "tool_done", status: "done", doneAt: "2026-11-19T00:00:00.000Z" });
    const refusedOpen = thrownBy(() => checkToolProposalDone(sqlite, "row-open", "TASK-OK", root));
    expect(refusedOpen).toMatchObject({ code: "OPERATOR_TOOL_PROPOSAL_NOT_IN_PROGRESS" });
    expect(rowOf(sqlite, "row-open").done_at).toBeNull();
    const refusedDone = thrownBy(() => checkToolProposalDone(sqlite, "row-done", "TASK-OK", root));
    expect(refusedDone).toMatchObject({ code: "OPERATOR_TOOL_PROPOSAL_NOT_IN_PROGRESS" });
    expect(rowOf(sqlite, "row-done").done_at).toBe("2026-11-19T00:00:00.000Z");
  });

  // Green from the start: accept and start never touch done_at (pins, not red-first).
  it("leaves done_at null when accept and start move a row, and neither sets it", () => {
    const { sqlite } = freshDb();
    insertRow(sqlite, { id: "row-open", name: "tool_open", status: "open" });
    acceptToolProposal(sqlite, "row-open");
    expect(rowOf(sqlite, "row-open")).toMatchObject({ status: "accepted", done_at: null });
    insertRow(sqlite, { id: "row-acc", name: "tool_acc", status: "accepted" });
    sqlite.prepare("UPDATE improvement_requests SET drafted_at = ? WHERE id = ?").run(OLD, "row-acc");
    startToolProposal(sqlite, "row-acc");
    expect(rowOf(sqlite, "row-acc")).toMatchObject({ status: "in_progress", done_at: null });
  });

  it("never writes a .done file under docs/tasks", () => {
    expect(listDoneFiles(REAL_TASKS_ROOT)).toEqual(realDoneBefore);
  });
});
