import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/client.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { AppError } from "../src/lib/errors.js";
import { consumeSelfImprovementBudget, saveSelfImprovementSettings, selfImprovementBudgetStatus } from "../src/operator/autonomyBudget.js";
import { effectiveImprovementRequestLimit, improvementSelfTuneStats, type SelfTuneStats } from "../src/operator/improvementSelfTune.js";
import { recordToolProposal, ToolProposalArgs } from "../src/operator/toolProposals.js";

// TASK-074c-5a: the operator halves its daily request limit when fewer than 30% of its last 20 decided requests were accepted.
// Derived on every call; nothing is stored and no setting is written.

function freshDb() {
  const opened = openDatabase(":memory:");
  migrateDatabase(opened.db, undefined, opened.sqlite);
  return opened.sqlite;
}
type Sqlite = ReturnType<typeof freshDb>;

const at = (minute: number) => new Date(Date.UTC(2026, 10, 1) + minute * 60_000).toISOString();
const NOW = new Date("2026-11-20T03:00:00Z");

/** Rows are inserted oldest first; each gets created_at from its position unless a minute is given. */
function seedStatuses(sqlite: Sqlite, statuses: string[], minutes?: number[]) {
  statuses.forEach((status, index) => {
    const minute = minutes?.[index] ?? index;
    sqlite.prepare(`INSERT INTO improvement_requests (id, kind, title, problem, proposal, evidence, acceptance, status, weight, fingerprint, created_at, updated_at)
      VALUES (?, 'tool', ?, 'Thiếu', '{}', '[]', '[]', ?, 1, ?, ?, ?)`)
      .run(`row-${minute}-${index}`, `title_${index}`, status, `tool:internal:seed_${minute}_${index}`, at(minute), at(minute));
  });
}

const repeat = (value: string, count: number) => Array.from({ length: count }, () => value);

function proposalArgs(overrides: Record<string, unknown> = {}) {
  return ToolProposalArgs.parse({
    kind: "internal", name: "read_fixture_transcript",
    operation: "Đọc bản chép lời đã tạo", reproduction: "Mở dự án thử có file chép lời",
    impact: "Agent lấy được văn bản", inputSchema: { type: "object" }, outputSchema: { type: "object" },
    permissions: ["Đọc dự án được chọn"], dataSent: "Không gửi ra ngoài", requiresConfirmation: false,
    acceptance: ["Trả bản chép lời đúng dự án"], ...overrides,
  });
}

describe("TASK-074c-5a: self-tune halves the request limit when acceptance is below 30% of the last 20 decided rows", () => {
  it("is off below 20 decided rows: the rate is null and open rows are not counted", () => {
    const sqlite = freshDb();
    seedStatuses(sqlite, [...repeat("accepted", 19), ...repeat("open", 5)]);
    expect(improvementSelfTuneStats(sqlite)).toEqual({ window: 20, decided: 19, accepted: 19, rate: null, halved: false });
    expect(effectiveImprovementRequestLimit(10, improvementSelfTuneStats(sqlite))).toBe(10);
  });

  it("halves at 5 accepted of 20, and does not halve at 6 (30% is not below 30%)", () => {
    const halvedDb = freshDb();
    seedStatuses(halvedDb, [...repeat("rejected", 15), ...repeat("accepted", 5)]);
    expect(improvementSelfTuneStats(halvedDb)).toEqual({ window: 20, decided: 20, accepted: 5, rate: 0.25, halved: true });
    expect(effectiveImprovementRequestLimit(10, improvementSelfTuneStats(halvedDb))).toBe(5);

    const boundaryDb = freshDb();
    seedStatuses(boundaryDb, [...repeat("rejected", 14), ...repeat("accepted", 6)]);
    expect(improvementSelfTuneStats(boundaryDb)).toEqual({ window: 20, decided: 20, accepted: 6, rate: 0.3, halved: false });
    expect(effectiveImprovementRequestLimit(10, improvementSelfTuneStats(boundaryDb))).toBe(10);
  });

  it("ignores open rows, even newer ones, when choosing the 20 decided rows", () => {
    const sqlite = freshDb();
    seedStatuses(sqlite, [...repeat("rejected", 15), ...repeat("accepted", 5), ...repeat("open", 10)]);
    expect(improvementSelfTuneStats(sqlite)).toMatchObject({ decided: 20, accepted: 5, halved: true });
  });

  it("uses only the newest 20 decided rows, not every decided row", () => {
    const sqlite = freshDb();
    // Oldest five accepted, then 15 rejected, then five accepted. The newest 20 hold 5 accepted (halved). All 25 hold 10 accepted (40%), so a rule over all rows would not halve.
    seedStatuses(sqlite, [...repeat("accepted", 5), ...repeat("rejected", 15), ...repeat("accepted", 5)]);
    expect(improvementSelfTuneStats(sqlite)).toEqual({ window: 20, decided: 20, accepted: 5, rate: 0.25, halved: true });
  });

  it("orders the window by created_at, not by insertion order", () => {
    const sqlite = freshDb();
    // The first five rows are inserted first but have the newest created_at (minutes 100-104). The newest 20 are those 5 accepted rows plus the 15 newest rejected rows.
    const statuses = [...repeat("accepted", 5), ...repeat("rejected", 15), ...repeat("rejected", 5)];
    const minutes = [...Array.from({ length: 5 }, (_, i) => 100 + i), ...Array.from({ length: 20 }, (_, i) => i)];
    seedStatuses(sqlite, statuses, minutes);
    expect(improvementSelfTuneStats(sqlite)).toMatchObject({ decided: 20, accepted: 5, halved: true });
  });

  it("counts every decided status except rejected as accepted", () => {
    const sqlite = freshDb();
    // Only the plain "accepted" status would give 2 here. The other four statuses are accepted too, so the total is 6 and not halved.
    seedStatuses(sqlite, [...repeat("rejected", 14), "accepted", "in_progress", "done", "verified", "failed_verification", "accepted"]);
    expect(improvementSelfTuneStats(sqlite)).toMatchObject({ decided: 20, accepted: 6, halved: false });
  });

  it("maps the limit: halves a non-zero limit with a floor of 1, keeps zero, and leaves an unhalved limit alone", () => {
    const halved: SelfTuneStats = { window: 20, decided: 20, accepted: 5, rate: 0.25, halved: true };
    const open: SelfTuneStats = { window: 20, decided: 20, accepted: 6, rate: 0.3, halved: false };
    expect(effectiveImprovementRequestLimit(10, halved)).toBe(5);
    expect(effectiveImprovementRequestLimit(7, halved)).toBe(3);
    expect(effectiveImprovementRequestLimit(1, halved)).toBe(1);
    expect(effectiveImprovementRequestLimit(0, halved)).toBe(0);
    expect(effectiveImprovementRequestLimit(10, open)).toBe(10);
  });

  it("recovers by itself when accepted rows push the rate back up, without storing any state", () => {
    const sqlite = freshDb();
    seedStatuses(sqlite, [...repeat("rejected", 15), ...repeat("accepted", 5)]);
    expect(effectiveImprovementRequestLimit(10, improvementSelfTuneStats(sqlite))).toBe(5);
    // One newer accepted row pushes the oldest rejected row out of the window: 6 of 20 accepted, not halved.
    seedStatuses(sqlite, ["accepted"], [100]);
    expect(improvementSelfTuneStats(sqlite)).toMatchObject({ decided: 20, accepted: 6, halved: false });
    expect(effectiveImprovementRequestLimit(10, improvementSelfTuneStats(sqlite))).toBe(10);
    expect(selfImprovementBudgetStatus(sqlite, NOW).limits.improvementRequests).toBe(10);
  });

  it("never raises the user's limit: an override above it is capped at the user's limit", () => {
    const sqlite = freshDb();
    for (let i = 0; i < 10; i++) consumeSelfImprovementBudget(sqlite, "improvementRequests", { now: NOW, limit: 50 });
    expect(() => consumeSelfImprovementBudget(sqlite, "improvementRequests", { now: NOW, limit: 50 })).toThrow("Đã đạt giới hạn");
    expect(selfImprovementBudgetStatus(sqlite, NOW).used.improvementRequests).toBe(10);
  });

  it("refuses new requests at the halved limit with the existing TOOL_PROPOSAL_LIMIT code", () => {
    const sqlite = freshDb();
    seedStatuses(sqlite, [...repeat("rejected", 15), ...repeat("accepted", 5)]);
    for (let i = 1; i <= 5; i++) {
      expect(recordToolProposal(sqlite, proposalArgs({ name: `halve_tool_${i}` }), new Set()).status).toBe("proposed");
    }
    let caught: unknown;
    try {
      recordToolProposal(sqlite, proposalArgs({ name: "halve_tool_6" }), new Set());
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect(caught).toMatchObject({ statusCode: 429, code: "TOOL_PROPOSAL_LIMIT" });
    // The refused call spent nothing and wrote no setting: the user's limit stays 10 and the spend stays at the 5 that succeeded.
    expect(selfImprovementBudgetStatus(sqlite).limits.improvementRequests).toBe(10);
    expect(selfImprovementBudgetStatus(sqlite).used.improvementRequests).toBe(5);
  });

  it("keeps the full limit below 20 decided rows, end to end through recordToolProposal", () => {
    const sqlite = freshDb();
    seedStatuses(sqlite, repeat("rejected", 19));
    for (let i = 1; i <= 10; i++) {
      expect(recordToolProposal(sqlite, proposalArgs({ name: `full_tool_${i}` }), new Set()).status).toBe("proposed");
    }
    expect(() => recordToolProposal(sqlite, proposalArgs({ name: "full_tool_11" }), new Set())).toThrow("Đã đạt giới hạn đề xuất công cụ trong ngày.");
  });
});

// TASK-074c-5c: the refusal names the halved limit only when halving caused it. The unhalved message stays byte-identical.
const PLAIN_MESSAGE = "Đã đạt giới hạn đề xuất công cụ trong ngày.";
const HALVED_MESSAGE = "Đã đạt giới hạn đề xuất công cụ trong ngày. Hạn mức hôm nay đã được hạ xuống còn 5 vì tỉ lệ đề xuất được chấp nhận dưới 30%; người dùng đặt 10.";

function refusalOf(sqlite: Sqlite, name: string): AppError {
  try {
    recordToolProposal(sqlite, proposalArgs({ name }), new Set());
  } catch (error) {
    return error as AppError;
  }
  throw new Error(`expected ${name} to be refused`);
}

describe("TASK-074c-5c: the refusal says when the halved limit caused it", () => {
  it("names the halved limit, the user's limit and the reason when halving caused the refusal", () => {
    const sqlite = freshDb();
    seedStatuses(sqlite, [...repeat("rejected", 15), ...repeat("accepted", 5)]);
    for (let i = 1; i <= 5; i++) expect(recordToolProposal(sqlite, proposalArgs({ name: `msg_tool_${i}` }), new Set()).status).toBe("proposed");
    const err = refusalOf(sqlite, "msg_tool_6");
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(429);
    expect(err.code).toBe("TOOL_PROPOSAL_LIMIT");
    expect(err.message).toBe(HALVED_MESSAGE);
    expect(err.details).toEqual({ halved: true, userLimit: 10, effectiveLimit: 5 });
  });

  it("keeps the old message byte-identical, with no details, when the user's own limit caused the refusal", () => {
    const sqlite = freshDb();
    for (let i = 1; i <= 10; i++) expect(recordToolProposal(sqlite, proposalArgs({ name: `plain_tool_${i}` }), new Set()).status).toBe("proposed");
    const err = refusalOf(sqlite, "plain_tool_11");
    expect(err.code).toBe("TOOL_PROPOSAL_LIMIT");
    expect(err.message).toBe(PLAIN_MESSAGE);
    expect(err.details).toBeUndefined();
  });

  it("keeps the old message when the user's limit was already used up before the rate dropped", () => {
    const sqlite = freshDb();
    for (let i = 1; i <= 10; i++) expect(recordToolProposal(sqlite, proposalArgs({ name: `used_tool_${i}` }), new Set()).status).toBe("proposed");
    seedStatuses(sqlite, [...repeat("rejected", 15), ...repeat("accepted", 5)]);
    const err = refusalOf(sqlite, "used_tool_11");
    expect(err.message).toBe(PLAIN_MESSAGE);
    expect(err.details).toBeUndefined();
  });

  it("keeps the old message when the user's limit is 1, because halving cannot lower it", () => {
    const sqlite = freshDb();
    saveSelfImprovementSettings(sqlite, { budget: { improvementRequests: 1 } });
    seedStatuses(sqlite, [...repeat("rejected", 15), ...repeat("accepted", 5)]);
    expect(recordToolProposal(sqlite, proposalArgs({ name: "one_tool_1" }), new Set()).status).toBe("proposed");
    const err = refusalOf(sqlite, "one_tool_2");
    expect(err.message).toBe(PLAIN_MESSAGE);
    expect(err.details).toBeUndefined();
  });
});

describe("TASK-074c-5c: the budget cap guard (pins existing behaviour)", () => {
  it("treats a negative cap as zero: the call refuses and spends nothing", () => {
    const sqlite = freshDb();
    expect(() => consumeSelfImprovementBudget(sqlite, "improvementRequests", { now: NOW, limit: -5 })).toThrow("Đã đạt giới hạn");
    expect(selfImprovementBudgetStatus(sqlite, NOW).used.improvementRequests).toBe(0);
  });

  it("ignores a NaN cap, so the user's limit still bounds the budget", () => {
    const sqlite = freshDb();
    for (let i = 0; i < 10; i++) consumeSelfImprovementBudget(sqlite, "improvementRequests", { now: NOW, limit: NaN });
    expect(() => consumeSelfImprovementBudget(sqlite, "improvementRequests", { now: NOW, limit: NaN })).toThrow("Đã đạt giới hạn");
    expect(selfImprovementBudgetStatus(sqlite, NOW).used.improvementRequests).toBe(10);
  });
});
