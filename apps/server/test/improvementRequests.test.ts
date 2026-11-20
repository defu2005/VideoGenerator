import { describe, expect, it, vi } from "vitest";
import { openDatabase } from "../src/db/client.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { saveSelfImprovementSettings, selfImprovementBudgetStatus } from "../src/operator/autonomyBudget.js";
import { dismissToolProposal, listToolProposals, recordToolProposal, ToolProposalArgs } from "../src/operator/toolProposals.js";

function freshDb() {
  const opened = openDatabase(":memory:");
  migrateDatabase(opened.db, undefined, opened.sqlite);
  return opened;
}

function proposalArgs(overrides: Record<string, unknown> = {}) {
  return {
    kind: "internal", name: "read_fixture_transcript",
    operation: "Đọc bản chép lời đã tạo", reproduction: "Mở dự án thử có file chép lời",
    impact: "Agent lấy được văn bản", inputSchema: { type: "object" }, outputSchema: { type: "object" },
    permissions: ["Đọc dự án được chọn"], dataSent: "Không gửi ra ngoài", requiresConfirmation: false,
    acceptance: ["Trả bản chép lời đúng dự án"], ...overrides,
  };
}

function seedLegacy(sqlite: { prepare: (sql: string) => { run: (...args: unknown[]) => unknown } }, row: {
  id: string; kind: string; name: string; status: string; createdAt: string; args: Record<string, unknown>;
}) {
  sqlite.prepare("INSERT INTO operator_tool_proposals (id, kind, name, details, status, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(row.id, row.kind, row.name, JSON.stringify(row.args), row.status, row.createdAt);
}

describe("improvement_requests replaces operator_tool_proposals for tool requests", () => {
  it("copies legacy rows once, mapping pending to open, dismissed to rejected and kind to tool", () => {
    const { db, sqlite } = freshDb();
    seedLegacy(sqlite, { id: "old-1", kind: "internal", name: "alpha_tool", status: "pending",
      createdAt: "2026-11-10T00:00:00.000Z", args: proposalArgs({ name: "alpha_tool" }) });
    seedLegacy(sqlite, { id: "old-2", kind: "external_mcp", name: "beta_mcp", status: "dismissed",
      createdAt: "2026-11-11T00:00:00.000Z", args: proposalArgs({ kind: "external_mcp", name: "beta_mcp", sourceUrl: "https://example.com/mcp" }) });

    migrateDatabase(db, undefined, sqlite);
    migrateDatabase(db, undefined, sqlite);

    const rows = sqlite.prepare("SELECT id, kind, status, fingerprint, created_at FROM improvement_requests ORDER BY id").all();
    expect(rows).toEqual([
      { id: "old-1", kind: "tool", status: "open", fingerprint: "tool:internal:alpha_tool", created_at: "2026-11-10T00:00:00.000Z" },
      { id: "old-2", kind: "tool", status: "rejected", fingerprint: "tool:external_mcp:beta_mcp", created_at: "2026-11-11T00:00:00.000Z" },
    ]);
  });

  it("skips a legacy row whose details are not JSON and still copies the good rows", () => {
    const { db, sqlite } = freshDb();
    seedLegacy(sqlite, { id: "old-good", kind: "internal", name: "theta_tool", status: "pending",
      createdAt: "2026-11-13T00:00:00.000Z", args: proposalArgs({ name: "theta_tool" }) });
    sqlite.prepare("INSERT INTO operator_tool_proposals (id, kind, name, details, status, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run("old-bad", "internal", "broken_tool", "{not json", "pending", "2026-11-13T00:00:01.000Z");
    expect(() => migrateDatabase(db, undefined, sqlite)).not.toThrow();
    const ids = sqlite.prepare("SELECT id FROM improvement_requests ORDER BY id").all();
    expect(ids).toEqual([{ id: "old-good" }]);
  });

  it("keeps a copied row rejected when the copy runs again", () => {
    const { db, sqlite } = freshDb();
    seedLegacy(sqlite, { id: "old-3", kind: "internal", name: "gamma_tool", status: "pending",
      createdAt: "2026-11-12T00:00:00.000Z", args: proposalArgs({ name: "gamma_tool" }) });
    migrateDatabase(db, undefined, sqlite);
    dismissToolProposal(sqlite, "old-3");
    migrateDatabase(db, undefined, sqlite);
    const row = sqlite.prepare("SELECT status FROM improvement_requests WHERE id = 'old-3'").get();
    expect(row).toEqual({ status: "rejected" });
  });

  it("files an internal and an external proposal with the same name as two rows", () => {
    const { sqlite } = freshDb();
    const first = recordToolProposal(sqlite, proposalArgs({ name: "delta_tool" }) as never, new Set());
    const second = recordToolProposal(sqlite, proposalArgs({ kind: "external_mcp", name: "delta_tool", sourceUrl: "https://example.com/mcp" }) as never, new Set());
    expect(first.status).toBe("proposed");
    expect(second.status).toBe("proposed");
    const count = sqlite.prepare("SELECT count(*) AS total FROM improvement_requests WHERE kind = 'tool'").get();
    expect(count).toEqual({ total: 2 });
  });

  it("writes a new proposal to improvement_requests and leaves the legacy table untouched", () => {
    const { sqlite } = freshDb();
    const result = recordToolProposal(sqlite, proposalArgs({ name: "epsilon_tool" }) as never, new Set());
    expect(result.status).toBe("proposed");
    const fresh = sqlite.prepare("SELECT kind, status, fingerprint FROM improvement_requests WHERE id = ?").get(result.id);
    expect(fresh).toEqual({ kind: "tool", status: "open", fingerprint: "tool:internal:epsilon_tool" });
    const legacy = sqlite.prepare("SELECT count(*) AS total FROM operator_tool_proposals").get();
    expect(legacy).toEqual({ total: 0 });
  });

  it("does not count copied legacy rows against the new-request budget", () => {
    const { db, sqlite } = freshDb();
    const now = new Date().toISOString();
    for (let index = 0; index < 10; index += 1) {
      seedLegacy(sqlite, { id: `old-day-${index}`, kind: "internal", name: `tool_${index}`, status: "dismissed",
        createdAt: now, args: proposalArgs({ name: `tool_${index}` }) });
    }
    migrateDatabase(db, undefined, sqlite);
    expect(recordToolProposal(sqlite, proposalArgs({ name: "eleventh_tool" }) as never, new Set()).status).toBe("proposed");
  });

  it("dismiss only rejects tool rows", () => {
    const { sqlite } = freshDb();
    sqlite.prepare(`INSERT INTO improvement_requests (id, kind, title, problem, proposal, evidence, acceptance, status, weight, fingerprint, created_at, updated_at)
      VALUES ('feat-1', 'feature', 'Tính năng', 'Thiếu', '{}', '[]', '[]', 'open', 1, 'feature:x', '2026-11-20T00:00:00.000Z', '2026-11-20T00:00:00.000Z')`).run();
    dismissToolProposal(sqlite, "feat-1");
    const row = sqlite.prepare("SELECT status FROM improvement_requests WHERE id = 'feat-1'").get();
    expect(row).toEqual({ status: "open" });
  });

  it("lists only open tool rows", () => {
    const { sqlite } = freshDb();
    const result = recordToolProposal(sqlite, proposalArgs({ name: "zeta_tool" }) as never, new Set());
    const listed = listToolProposals(sqlite);
    expect(listed.map((item) => item.id)).toEqual([result.id]);
    expect(listed[0]).toMatchObject({ name: "zeta_tool", kind: "internal" });
  });

  it("lists the good open rows and skips a row whose stored proposal is not JSON or fails the schema", () => {
    const { sqlite } = freshDb();
    const good = recordToolProposal(sqlite, proposalArgs({ name: "eta_tool" }) as never, new Set());
    const insertBad = sqlite.prepare(`INSERT INTO improvement_requests (id, kind, title, problem, proposal, evidence, acceptance, status, weight, fingerprint, created_at, updated_at)
      VALUES (?, 'tool', ?, 'Thiếu', ?, '[]', '[]', 'open', 1, ?, '2026-11-20T00:00:00.000Z', '2026-11-20T00:00:00.000Z')`);
    insertBad.run("bad-json", "bad_json_tool", "{not json", "tool:internal:bad_json_tool");
    insertBad.run("bad-schema", "bad_schema_tool", JSON.stringify({ name: "bad_schema_tool" }), "tool:internal:bad_schema_tool");
    const warn = vi.fn();
    const listed = listToolProposals(sqlite, { warn });
    expect(listed.map((item) => item.id)).toEqual([good.id]);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls.map(([obj]) => (obj as { id: string }).id).sort()).toEqual(["bad-json", "bad-schema"]);
  });

  it.each([
    ["not JSON", "{not json"],
    ["fails the schema", JSON.stringify({ name: "swallow_tool" })],
  ])("a valid repeat is not swallowed by an open row whose stored proposal %s: it repairs that row in place and the name is listed", (_label, storedProposal) => {
    const { sqlite } = freshDb();
    sqlite.prepare(`INSERT INTO improvement_requests (id, kind, title, problem, proposal, evidence, acceptance, status, weight, fingerprint, created_at, updated_at)
      VALUES ('corrupt-open', 'tool', 'swallow_tool', 'Thiếu', ?, '[]', '[]', 'open', 1, 'tool:internal:swallow_tool', '2026-11-20T00:00:00.000Z', '2026-11-20T00:00:00.000Z')`).run(storedProposal);
    const result = recordToolProposal(sqlite, parsed({ name: "swallow_tool" }), new Set());
    expect(result).toMatchObject({ status: "duplicate", id: "corrupt-open" });
    expect(listToolProposals(sqlite, { warn: () => {} }).map((item) => item.name)).toEqual(["swallow_tool"]);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM improvement_requests").get()).toEqual({ n: 1 });
    expect(sqlite.prepare("SELECT weight FROM improvement_requests WHERE id = 'corrupt-open'").get()).toEqual({ weight: 2 });
    expect(selfImprovementBudgetStatus(sqlite).used.improvementRequests).toBe(0);
  });

  it("a repeat with a different operation leaves a healthy open row's stored proposal unchanged", () => {
    const { sqlite } = freshDb();
    const first = recordToolProposal(sqlite, parsed({ name: "healthy_guard_tool" }), new Set());
    const before = sqlite.prepare("SELECT proposal FROM improvement_requests WHERE id = ?").get(first.id);
    const repeat = recordToolProposal(sqlite, parsed({ name: "healthy_guard_tool", operation: "Một thao tác khác hẳn để thử" }), new Set());
    expect(repeat).toMatchObject({ status: "duplicate", id: first.id });
    expect(sqlite.prepare("SELECT proposal FROM improvement_requests WHERE id = ?").get(first.id)).toEqual(before);
  });

  it("names the legacy copy, not a migration, when the copy fails, and does not tell the user to delete app.db", () => {
    const { db, sqlite } = freshDb();
    seedLegacy(sqlite, { id: "old-broken-copy", kind: "internal", name: "omega_tool", status: "pending",
      createdAt: "2026-11-14T00:00:00.000Z", args: proposalArgs({ name: "omega_tool" }) });
    sqlite.exec("DROP TABLE improvement_requests");
    let message = "";
    try {
      migrateDatabase(db, undefined, sqlite);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/legacy tool proposal/i);
    expect(message).not.toMatch(/delete data\/app\.db/);
  });
});

describe("TASK-074c-1 fix: a repeat after a finished or rejected request opens a new row and spends budget", () => {
  it("does not merge into done, verified, failed_verification or rejected rows", () => {
    const { sqlite } = freshDb();
    const statuses = ["done", "verified", "failed_verification", "rejected"];
    for (const status of statuses) {
      const name = `lock_${status}_tool`;
      expect(recordToolProposal(sqlite, parsed({ name }), new Set()).status).toBe("proposed");
      sqlite.prepare("UPDATE improvement_requests SET status = ? WHERE title = ?").run(status, name);
      expect(recordToolProposal(sqlite, parsed({ name }), new Set()).status).toBe("proposed");
      expect(sqlite.prepare("SELECT count(*) AS total FROM improvement_requests WHERE title = ?").get(name)).toEqual({ total: 2 });
    }
    expect(selfImprovementBudgetStatus(sqlite).used.improvementRequests).toBe(statuses.length * 2);
  });
});

type Sqlite = ReturnType<typeof freshDb>["sqlite"];

function parsed(overrides: Record<string, unknown> = {}) {
  return ToolProposalArgs.parse(proposalArgs(overrides));
}

function rowOf(sqlite: Sqlite, title: string) {
  return sqlite.prepare("SELECT id, weight, evidence FROM improvement_requests WHERE kind = 'tool' AND title = ?")
    .get(title) as { id: string; weight: number; evidence: string };
}

describe("TASK-074c-2: merge by fingerprint and the improvementRequests budget", () => {
  it("merges a repeat of an open request: weight +1, one evidence entry added, no new row", () => {
    const { sqlite } = freshDb();
    expect(recordToolProposal(sqlite, parsed({ name: "merge_me_tool" }), new Set()).status).toBe("proposed");
    expect(recordToolProposal(sqlite, parsed({ name: "merge_me_tool" }), new Set()).status).toBe("duplicate");
    const row = rowOf(sqlite, "merge_me_tool");
    expect(row.weight).toBe(2);
    expect(JSON.parse(row.evidence)).toHaveLength(2);
    expect(sqlite.prepare("SELECT count(*) AS total FROM improvement_requests WHERE title = 'merge_me_tool'").get()).toEqual({ total: 1 });
  });

  it("keeps only the latest 10 evidence entries while weight keeps growing", () => {
    const { sqlite } = freshDb();
    for (let index = 0; index < 12; index += 1) recordToolProposal(sqlite, parsed({ name: "many_repeats_tool" }), new Set());
    const row = rowOf(sqlite, "many_repeats_tool");
    expect(row.weight).toBe(12);
    expect(JSON.parse(row.evidence)).toHaveLength(10);
  });

  it("tolerates stored evidence that is not an array", () => {
    const { sqlite } = freshDb();
    recordToolProposal(sqlite, parsed({ name: "odd_evidence_tool" }), new Set());
    sqlite.prepare(`UPDATE improvement_requests SET evidence = '{"x":1}' WHERE title = 'odd_evidence_tool'`).run();
    expect(recordToolProposal(sqlite, parsed({ name: "odd_evidence_tool" }), new Set()).status).toBe("duplicate");
    const row = rowOf(sqlite, "odd_evidence_tool");
    expect(row.weight).toBe(2);
    expect(Array.isArray(JSON.parse(row.evidence))).toBe(true);
  });

  it("limits new requests to the improvementRequests budget (set to 2), and merges do not count", () => {
    const { sqlite } = freshDb();
    saveSelfImprovementSettings(sqlite, { budget: { improvementRequests: 2 } });
    expect(recordToolProposal(sqlite, parsed({ name: "budget_a_tool" }), new Set()).status).toBe("proposed");
    expect(recordToolProposal(sqlite, parsed({ name: "budget_b_tool" }), new Set()).status).toBe("proposed");
    let caught: unknown;
    try {
      recordToolProposal(sqlite, parsed({ name: "budget_c_tool" }), new Set());
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ statusCode: 429, code: "TOOL_PROPOSAL_LIMIT" });
    expect(selfImprovementBudgetStatus(sqlite).used.improvementRequests).toBe(2);
    expect(sqlite.prepare("SELECT count(*) AS total FROM improvement_requests WHERE kind = 'tool'").get()).toEqual({ total: 2 });
    expect(recordToolProposal(sqlite, parsed({ name: "budget_a_tool" }), new Set()).status).toBe("duplicate");
    expect(selfImprovementBudgetStatus(sqlite).used.improvementRequests).toBe(2);
  });

  it("merges a repeat into an accepted or in-progress request too, so it never opens a second row or spends budget", () => {
    const { sqlite } = freshDb();
    saveSelfImprovementSettings(sqlite, { budget: { improvementRequests: 1 } });
    expect(recordToolProposal(sqlite, parsed({ name: "active_merge_tool" }), new Set()).status).toBe("proposed");
    for (const status of ["accepted", "in_progress"]) {
      sqlite.prepare("UPDATE improvement_requests SET status = ? WHERE title = 'active_merge_tool'").run(status);
      expect(recordToolProposal(sqlite, parsed({ name: "active_merge_tool" }), new Set()).status).toBe("duplicate");
    }
    expect(rowOf(sqlite, "active_merge_tool").weight).toBe(3);
    expect(sqlite.prepare("SELECT count(*) AS total FROM improvement_requests WHERE title = 'active_merge_tool'").get()).toEqual({ total: 1 });
    expect(selfImprovementBudgetStatus(sqlite).used.improvementRequests).toBe(1);
  });
});
