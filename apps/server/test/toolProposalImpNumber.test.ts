import { describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { openDatabase } from "../src/db/client.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { assignImpNumber, listAcceptedToolProposals } from "../src/operator/toolProposals.js";

// TASK-074c-4b-3a: stable IMP number for an accepted tool row, and the drafted marker in the list. DB only: no LLM, no writer call.
const OLD = "2026-11-20T00:00:00.000Z";

function freshSqlite(): Database.Database {
  const opened = openDatabase(":memory:");
  migrateDatabase(opened.db, undefined, opened.sqlite);
  return opened.sqlite;
}

function proposalFor(name: string) {
  return JSON.stringify({
    kind: "internal", name,
    operation: "Đọc bản chép lời đã tạo", reproduction: "Mở dự án thử có file chép lời",
    impact: "Agent lấy được văn bản", inputSchema: { type: "object" }, outputSchema: { type: "object" },
    permissions: ["Đọc dự án được chọn"], dataSent: "Không gửi ra ngoài", requiresConfirmation: false,
    acceptance: ["Trả bản chép lời đúng dự án"],
  });
}

function insertRow(sqlite: Database.Database, id: string, status: string, kind = "tool") {
  sqlite.prepare(`INSERT INTO improvement_requests (id, kind, title, problem, proposal, evidence, acceptance, status, weight, fingerprint, created_at, updated_at)
    VALUES (?, ?, 'Tiêu đề', 'Vấn đề', ?, '[]', '[]', ?, 1, ?, ?, ?)`)
    .run(id, kind, proposalFor(`tool_${id.replace(/[^a-z0-9]/gi, "_")}`), status, `tool:internal:${id}`, OLD, OLD);
}

function impNumberOf(sqlite: Database.Database, id: string): number | null {
  return (sqlite.prepare("SELECT imp_number AS n FROM improvement_requests WHERE id = ?").get(id) as { n: number | null }).n;
}

describe("TASK-074c-4b-3a: assignImpNumber", () => {
  it("gives an accepted tool row a number, and returns the same number on a repeat call", () => {
    const sqlite = freshSqlite();
    insertRow(sqlite, "acc-1", "accepted");
    expect(assignImpNumber(sqlite, "acc-1")).toBe(1);
    expect(assignImpNumber(sqlite, "acc-1")).toBe(1);
    expect(impNumberOf(sqlite, "acc-1")).toBe(1);
  });

  it("gives each row its own number, in the order they are assigned", () => {
    const sqlite = freshSqlite();
    insertRow(sqlite, "acc-a", "accepted");
    insertRow(sqlite, "acc-b", "accepted");
    expect(assignImpNumber(sqlite, "acc-a")).toBe(1);
    expect(assignImpNumber(sqlite, "acc-b")).toBe(2);
    expect(assignImpNumber(sqlite, "acc-a")).toBe(1);
  });

  it("gives no number to a row that is not an accepted tool row, or to an unknown id", () => {
    const sqlite = freshSqlite();
    insertRow(sqlite, "open-1", "open");
    insertRow(sqlite, "rej-1", "rejected");
    insertRow(sqlite, "prog-1", "in_progress");
    insertRow(sqlite, "feat-1", "accepted", "feature");
    for (const id of ["open-1", "rej-1", "prog-1", "feat-1"]) {
      expect(assignImpNumber(sqlite, id), id).toBeNull();
      expect(impNumberOf(sqlite, id), id).toBeNull();
    }
    expect(assignImpNumber(sqlite, "missing")).toBeNull();
  });

  it("the database refuses two rows with the same number", () => {
    const sqlite = freshSqlite();
    insertRow(sqlite, "acc-x", "accepted");
    insertRow(sqlite, "acc-y", "accepted");
    assignImpNumber(sqlite, "acc-x");
    expect(() => sqlite.prepare("UPDATE improvement_requests SET imp_number = 1 WHERE id = 'acc-y'").run()).toThrow(/UNIQUE/);
  });
});

describe("TASK-074c-4b-3a: the accepted list shows the number and the drafted marker", () => {
  it("shows impNumber and draftedAt, with draftedAt null until a draft exists", () => {
    const sqlite = freshSqlite();
    insertRow(sqlite, "acc-l", "accepted");
    insertRow(sqlite, "acc-m", "accepted");
    assignImpNumber(sqlite, "acc-l");
    const items = listAcceptedToolProposals(sqlite);
    expect(items.find((item) => item.id === "acc-l")).toMatchObject({ impNumber: 1, draftedAt: null });
    expect(items.find((item) => item.id === "acc-m")).toMatchObject({ impNumber: null, draftedAt: null });
    // A stored marker must come back as-is, so a hard-coded null cannot pass.
    sqlite.prepare("UPDATE improvement_requests SET drafted_at = ? WHERE id = 'acc-l'").run("2026-11-20T01:00:00.000Z");
    expect(listAcceptedToolProposals(sqlite).find((item) => item.id === "acc-l"))
      .toMatchObject({ impNumber: 1, draftedAt: "2026-11-20T01:00:00.000Z" });
  });
});
