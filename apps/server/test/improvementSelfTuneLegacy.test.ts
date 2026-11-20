import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/client.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { improvementSelfTuneStats } from "../src/operator/improvementSelfTune.js";
import { acceptToolProposal, copyLegacyToolProposals, dismissToolProposal, ToolProposalArgs } from "../src/operator/toolProposals.js";

// TASK-074c-5d: rows copied from the old operator_tool_proposals table carry no acceptance signal,
// so they must not feed the self-tune window. A copied row is marked by evidence ref "operator_tool_proposals:<id>",
// and it keeps updated_at = created_at until someone changes it.

function freshSqlite() {
  const opened = openDatabase(":memory:");
  migrateDatabase(opened.db, undefined, opened.sqlite);
  return opened.sqlite;
}
type Sqlite = ReturnType<typeof freshSqlite>;

const at = (minute: number) => new Date(Date.UTC(2026, 10, 1) + minute * 60_000).toISOString();

function legacyDetails(name: string) {
  return JSON.stringify(ToolProposalArgs.parse({
    kind: "internal", name,
    operation: "Đọc bản chép lời đã tạo", reproduction: "Mở dự án thử có file chép lời",
    impact: "Agent lấy được văn bản", inputSchema: { type: "object" }, outputSchema: { type: "object" },
    permissions: ["Đọc dự án được chọn"], dataSent: "Không gửi ra ngoài", requiresConfirmation: false,
    acceptance: ["Trả bản chép lời đúng dự án"],
  }));
}

/** Old-table rows: ids are legacy-<startMinute>-<i>, created one minute apart from startMinute. */
function seedLegacy(sqlite: Sqlite, count: number, status: string, startMinute: number) {
  for (let i = 0; i < count; i += 1) {
    const name = `legacy_${startMinute}_${i}`;
    sqlite.prepare("INSERT INTO operator_tool_proposals (id, kind, name, details, status, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(`legacy-${startMinute}-${i}`, "internal", name, legacyDetails(name), status, at(startMinute + i));
  }
}

/** Native rows written straight into improvement_requests; updated_at defaults to created_at. */
function seedNative(sqlite: Sqlite, rows: Array<{ status: string; minute: number; evidence?: string }>) {
  rows.forEach((row, index) => {
    sqlite.prepare(`INSERT INTO improvement_requests (id, kind, title, problem, proposal, evidence, acceptance, status, weight, fingerprint, created_at, updated_at)
      VALUES (?, 'tool', ?, 'Thiếu', '{}', ?, '[]', ?, 1, ?, ?, ?)`)
      .run(`native-${row.minute}-${index}`, `native_${row.minute}_${index}`, row.evidence ?? "[]", row.status,
        `tool:internal:native_${row.minute}_${index}`, at(row.minute), at(row.minute));
  });
}

describe("TASK-074c-5d: rows copied from the old table do not feed the self-tune window", () => {
  it("20 legacy rows copied as rejected are not decided and do not halve the limit", () => {
    const sqlite = freshSqlite();
    seedLegacy(sqlite, 20, "dismissed", 0);
    expect(copyLegacyToolProposals(sqlite)).toEqual({ copied: 20, skipped: 0 });
    expect(improvementSelfTuneStats(sqlite)).toEqual({ window: 20, decided: 0, accepted: 0, rate: null, halved: false });
  });

  it("a copied open row that the user later dismisses still counts", () => {
    const sqlite = freshSqlite();
    seedLegacy(sqlite, 20, "pending", 0);
    copyLegacyToolProposals(sqlite);
    const ids = sqlite.prepare("SELECT id FROM improvement_requests ORDER BY id").all() as Array<{ id: string }>;
    for (const { id } of ids) dismissToolProposal(sqlite, id);
    expect(improvementSelfTuneStats(sqlite)).toMatchObject({ decided: 20, accepted: 0, halved: true });
  });

  it("a native rejected row with equal timestamps counts, with or without the marker text in its note", () => {
    const sqlite = freshSqlite();
    const marker = `"ref":"operator_tool_proposals:legacy-0-0`;
    const evidence = (note: string) => JSON.stringify([{ type: "error", ref: "propose_missing_tool", note }]);
    seedNative(sqlite, Array.from({ length: 20 }, (_, i) => ({ status: "rejected", minute: i, evidence: evidence(i % 2 ? marker : "ghi chú thường") })));
    expect(improvementSelfTuneStats(sqlite)).toMatchObject({ decided: 20, accepted: 0, halved: true });
  });

  it("legacy copies take no slot in the 20-row window, so newer legacy rows do not push out accepted native rows", () => {
    const sqlite = freshSqlite();
    seedNative(sqlite, Array.from({ length: 20 }, (_, i) => ({ status: "accepted", minute: i })));
    seedLegacy(sqlite, 20, "dismissed", 100);
    copyLegacyToolProposals(sqlite);
    expect(improvementSelfTuneStats(sqlite)).toEqual({ window: 20, decided: 20, accepted: 20, rate: 1, halved: false });
  });

  // Pin, green from the start: a copied row that the user accepts later is a real acceptance and must count.
  it("a copied pending row that the user accepts later counts as accepted", () => {
    const sqlite = freshSqlite();
    seedLegacy(sqlite, 20, "pending", 0);
    copyLegacyToolProposals(sqlite);
    const ids = sqlite.prepare("SELECT id FROM improvement_requests ORDER BY id").all() as Array<{ id: string }>;
    for (const { id } of ids) acceptToolProposal(sqlite, id);
    expect(improvementSelfTuneStats(sqlite)).toEqual({ window: 20, decided: 20, accepted: 20, rate: 1, halved: false });
  });

  // Pin for the status condition: a directly seeded accepted row with legacy-shaped evidence and equal timestamps still counts.
  // Production never produces this row (copies are open or rejected, and accept moves updated_at), so this guards the condition itself.
  it("an accepted row with legacy-shaped evidence and equal timestamps still counts", () => {
    const sqlite = freshSqlite();
    const evidence = JSON.stringify([{ type: "error", ref: "operator_tool_proposals:legacy-0-0", note: "x" }]);
    seedNative(sqlite, Array.from({ length: 20 }, (_, i) => ({ status: "accepted", minute: i, evidence })));
    expect(improvementSelfTuneStats(sqlite)).toEqual({ window: 20, decided: 20, accepted: 20, rate: 1, halved: false });
  });
});
