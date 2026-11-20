import { describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { openDatabase } from "../src/db/client.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { recordAcceptanceResult } from "../src/operator/toolProposals.js";

// TASK-074c-5e-2a-1 (storage only): recordAcceptanceResult stores one verdict per acceptance item on a done tool row.
// It writes only acceptance_result and acceptance_checked_at. Every refusal leaves both columns NULL. Only :memory: databases are used.
const OLD = "2026-11-20T00:00:00.000Z";
const ACCEPTANCE = ["Trả bản chép lời đúng dự án", "Không gửi dữ liệu ra ngoài"];

type Seed = {
  id: string;
  kind?: string;
  status: string;
  proposal?: string;
  doneAt?: string | null;
  taskRef?: string | null;
  updatedAt?: string;
};

function proposalFor(name: string, acceptance: string[] = ACCEPTANCE) {
  return {
    kind: "internal", name,
    operation: "Đọc bản chép lời đã tạo", reproduction: "Mở dự án thử có file chép lời",
    impact: "Agent lấy được văn bản", inputSchema: { type: "object" }, outputSchema: { type: "object" },
    permissions: ["Đọc dự án được chọn"], dataSent: "Không gửi ra ngoài", requiresConfirmation: false,
    acceptance,
  };
}

function freshDb(): Database.Database {
  const opened = openDatabase(":memory:");
  migrateDatabase(opened.db, undefined, opened.sqlite);
  return opened.sqlite;
}

// The fixture's own acceptance column stays "[]" on purpose: an implementation that counts from that column gets the wrong number.
function insertRow(sqlite: Database.Database, seed: Seed) {
  const name = `tool_${seed.id.replace(/-/g, "_")}`;
  sqlite.prepare(`INSERT INTO improvement_requests (id, kind, title, problem, proposal, evidence, acceptance, status, weight, fingerprint, created_at, updated_at, done_at, task_ref)
    VALUES (?, ?, 'Tiêu đề', 'Vấn đề', ?, '[]', '[]', ?, 1, ?, ?, ?, ?, ?)`)
    .run(seed.id, seed.kind ?? "tool", seed.proposal ?? JSON.stringify(proposalFor(name)), seed.status,
      `tool:internal:${name}`, OLD, seed.updatedAt ?? OLD, seed.doneAt ?? null, seed.taskRef ?? null);
}

function rowOf(sqlite: Database.Database, id: string): Record<string, unknown> {
  return sqlite.prepare("SELECT * FROM improvement_requests WHERE id = ?").get(id) as Record<string, unknown>;
}

function withoutNewColumns(row: Record<string, unknown>): Record<string, unknown> {
  const { acceptance_result: _result, acceptance_checked_at: _checkedAt, ...rest } = row;
  return rest;
}

function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to throw");
}

const TWO_PASS = [{ verdict: "passed" }, { verdict: "passed" }];

describe("TASK-074c-5e-2a-1: recordAcceptanceResult stores acceptance verdicts on a done tool row", () => {
  it("stores one verdict per acceptance item and sets acceptance_checked_at to a valid ISO time", () => {
    const sqlite = freshDb();
    insertRow(sqlite, { id: "row-done", status: "done", doneAt: "2026-11-19T00:00:00.000Z", taskRef: "TASK-OK" });
    const results = [{ verdict: "passed" }, { verdict: "not_checkable" }];
    recordAcceptanceResult(sqlite, "row-done", results);
    const after = rowOf(sqlite, "row-done");
    expect(after.acceptance_result).toBe(JSON.stringify(results));
    expect(typeof after.acceptance_checked_at).toBe("string");
    expect(new Date(after.acceptance_checked_at as string).toISOString()).toBe(after.acceptance_checked_at);
  });

  it("refuses a result count that differs from proposal.acceptance, and leaves both columns NULL", () => {
    const sqlite = freshDb();
    insertRow(sqlite, { id: "row-count", status: "done" });
    const error = thrownBy(() => recordAcceptanceResult(sqlite, "row-count", [{ verdict: "passed" }]));
    expect(error).toMatchObject({ code: "OPERATOR_ACCEPTANCE_MISMATCH" });
    const after = rowOf(sqlite, "row-count");
    expect(after.acceptance_result).toBeNull();
    expect(after.acceptance_checked_at).toBeNull();
  });

  it("refuses an unknown verdict with INVALID_ACCEPTANCE_RESULT, and leaves both columns NULL", () => {
    const sqlite = freshDb();
    insertRow(sqlite, { id: "row-verdict", status: "done" });
    const error = thrownBy(() => recordAcceptanceResult(sqlite, "row-verdict", [{ verdict: "maybe" }, { verdict: "passed" }]));
    expect(error).toMatchObject({ code: "INVALID_ACCEPTANCE_RESULT" });
    const after = rowOf(sqlite, "row-verdict");
    expect(after.acceptance_result).toBeNull();
    expect(after.acceptance_checked_at).toBeNull();
  });

  it("refuses every non-done status, with the status unchanged and both columns NULL", () => {
    const sqlite = freshDb();
    for (const status of ["open", "accepted", "in_progress", "rejected"]) {
      insertRow(sqlite, { id: `row-${status}`, status });
      const error = thrownBy(() => recordAcceptanceResult(sqlite, `row-${status}`, TWO_PASS));
      expect(error, status).toMatchObject({ code: "OPERATOR_TOOL_PROPOSAL_NOT_DONE" });
      const after = rowOf(sqlite, `row-${status}`);
      expect(after.status).toBe(status);
      expect(after.acceptance_result).toBeNull();
      expect(after.acceptance_checked_at).toBeNull();
    }
  });

  it("refuses an unknown id with NOT_FOUND", () => {
    const sqlite = freshDb();
    const error = thrownBy(() => recordAcceptanceResult(sqlite, "row-missing", TWO_PASS));
    expect(error).toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuses a non-tool row even when its proposal is tool-shaped, and leaves both columns NULL", () => {
    const sqlite = freshDb();
    insertRow(sqlite, { id: "row-other", kind: "research", status: "done" });
    const error = thrownBy(() => recordAcceptanceResult(sqlite, "row-other", TWO_PASS));
    expect(error).toMatchObject({ code: "NOT_FOUND" });
    const after = rowOf(sqlite, "row-other");
    expect(after.acceptance_result).toBeNull();
    expect(after.acceptance_checked_at).toBeNull();
  });

  it("refuses an unreadable or invalid proposal with OPERATOR_TOOL_PROPOSAL_UNREADABLE, and leaves both columns NULL", () => {
    const sqlite = freshDb();
    insertRow(sqlite, { id: "row-bad-json", status: "done", proposal: "{not json" });
    insertRow(sqlite, { id: "row-bad-shape", status: "done", proposal: JSON.stringify({ kind: "internal" }) });
    for (const id of ["row-bad-json", "row-bad-shape"]) {
      const error = thrownBy(() => recordAcceptanceResult(sqlite, id, TWO_PASS));
      expect(error, id).toMatchObject({ code: "OPERATOR_TOOL_PROPOSAL_UNREADABLE" });
      expect(rowOf(sqlite, id).acceptance_result).toBeNull();
      expect(rowOf(sqlite, id).acceptance_checked_at).toBeNull();
    }
  });

  it("a second write does not overwrite the first result or its checked_at", () => {
    const sqlite = freshDb();
    insertRow(sqlite, { id: "row-twice", status: "done" });
    recordAcceptanceResult(sqlite, "row-twice", TWO_PASS);
    const first = rowOf(sqlite, "row-twice");
    const error = thrownBy(() => recordAcceptanceResult(sqlite, "row-twice", [{ verdict: "failed" }, { verdict: "failed" }]));
    expect(error).toMatchObject({ code: "OPERATOR_ACCEPTANCE_ALREADY_RECORDED" });
    const after = rowOf(sqlite, "row-twice");
    expect(after.acceptance_result).toBe(first.acceptance_result);
    expect(after.acceptance_checked_at).toBe(first.acceptance_checked_at);
  });

  it("changes no other column, including done_at, task_ref and updated_at", () => {
    const sqlite = freshDb();
    insertRow(sqlite, {
      id: "row-keep", status: "done",
      doneAt: "2026-11-19T00:00:00.000Z", taskRef: "TASK-KEEP", updatedAt: "2026-11-18T12:00:00.000Z",
    });
    const before = rowOf(sqlite, "row-keep");
    recordAcceptanceResult(sqlite, "row-keep", TWO_PASS);
    const after = rowOf(sqlite, "row-keep");
    expect(after.acceptance_result).not.toBeNull();
    expect(withoutNewColumns(after)).toEqual(withoutNewColumns(before));
  });
});
