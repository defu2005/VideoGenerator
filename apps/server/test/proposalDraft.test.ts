import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "../src/db/client.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { consumeSelfImprovementBudget, selfImprovementBudgetStatus } from "../src/operator/autonomyBudget.js";
import { draftProposal } from "../src/operator/proposalDraft.js";

// TASK-074c-4b-3b: the draft path. The runner and the root are injected: every test uses a temp root, never docs/proposals/.
const OLD = "2026-11-20T00:00:00.000Z";

function freshDb() {
  const opened = openDatabase(":memory:");
  migrateDatabase(opened.db, undefined, opened.sqlite);
  return opened.sqlite;
}
type Sqlite = ReturnType<typeof freshDb>;

const roots: string[] = [];
function tempRoot(): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "imp-draft-")));
  roots.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function seed(sqlite: Sqlite, id: string, status = "accepted", kind = "tool") {
  sqlite.prepare(`INSERT INTO improvement_requests (id, kind, title, problem, proposal, evidence, acceptance, status, weight, fingerprint, created_at, updated_at)
    VALUES (?, ?, ?, 'Thiếu công cụ mẫu', '{"name":"tool_draft"}', '[]', '[]', ?, 1, ?, ?, ?)`)
    .run(id, kind, `title_${id}`, status, `tool:internal:${id}`, OLD, OLD);
}
const row = (sqlite: Sqlite, id: string) => sqlite.prepare("SELECT imp_number, drafted_at FROM improvement_requests WHERE id = ?")
  .get(id) as { imp_number: number | null; drafted_at: string | null };
const spentLlm = (sqlite: Sqlite) => selfImprovementBudgetStatus(sqlite).used.llmCalls;
const runnerReturning = (text: string) => vi.fn(async (_request: unknown) => text);

describe("TASK-074c-4b-3b: draftProposal writes IMP-<n>.md once and marks the row", () => {
  it("assigns the number, spends one llmCalls, writes the draft and sets drafted_at", async () => {
    const sqlite = freshDb();
    const root = tempRoot();
    seed(sqlite, "acc-1");
    const runner = runnerReturning("# IMP-1\nBản nháp");
    expect(await draftProposal(sqlite, "acc-1", { runner, root })).toMatchObject({ status: "drafted", impNumber: 1, path: join(root, "IMP-1.md") });
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner.mock.calls[0][0]).toMatchObject({ impNumber: 1, title: "title_acc-1" });
    expect(readFileSync(join(root, "IMP-1.md"), "utf8")).toBe("# IMP-1\nBản nháp");
    expect(row(sqlite, "acc-1").imp_number).toBe(1);
    expect(row(sqlite, "acc-1").drafted_at).not.toBeNull();
    expect(spentLlm(sqlite)).toBe(1);
  });

  it("makes no spend and no runner call for a row that already has drafted_at", async () => {
    const sqlite = freshDb();
    const root = tempRoot();
    seed(sqlite, "acc-2");
    const runner = runnerReturning("# IMP-1");
    await draftProposal(sqlite, "acc-2", { runner, root });
    expect(await draftProposal(sqlite, "acc-2", { runner, root })).toEqual({ status: "skipped", reason: "already_drafted" });
    expect(runner).toHaveBeenCalledTimes(1);
    expect(spentLlm(sqlite)).toBe(1);
  });

  it("rejects when the runner throws, keeps the number, and leaves drafted_at NULL with no file", async () => {
    const sqlite = freshDb();
    const root = tempRoot();
    seed(sqlite, "acc-3");
    const runner = vi.fn(async (_request: unknown) => { throw new Error("llm down"); });
    await expect(draftProposal(sqlite, "acc-3", { runner, root })).rejects.toThrow("llm down");
    expect(row(sqlite, "acc-3")).toEqual({ imp_number: 1, drafted_at: null });
    expect(() => readFileSync(join(root, "IMP-1.md"))).toThrow();
    expect(spentLlm(sqlite)).toBe(1);
  });

  it("refuses an empty draft as bad_content and leaves drafted_at NULL", async () => {
    const sqlite = freshDb();
    const root = tempRoot();
    seed(sqlite, "acc-4");
    const runner = runnerReturning("   ");
    expect(await draftProposal(sqlite, "acc-4", { runner, root }))
      .toEqual({ status: "refused", reason: "bad_content", impNumber: 1 });
    expect(await draftProposal(sqlite, "acc-4", { runner, root }))
      .toEqual({ status: "refused", reason: "bad_content", impNumber: 1 });
    expect(runner).toHaveBeenCalledTimes(2);
    expect(row(sqlite, "acc-4")).toEqual({ imp_number: 1, drafted_at: null });
  });

  it("keeps the row unmarked when IMP-<n>.md already exists, and never overwrites it", async () => {
    const sqlite = freshDb();
    const root = tempRoot();
    writeFileSync(join(root, "IMP-1.md"), "bản cũ");
    seed(sqlite, "acc-5");
    const runner = runnerReturning("# mới");
    expect(await draftProposal(sqlite, "acc-5", { runner, root }))
      .toEqual({ status: "refused", reason: "exists", impNumber: 1 });
    expect(runner).not.toHaveBeenCalled();
    expect(spentLlm(sqlite)).toBe(0);
    expect(readFileSync(join(root, "IMP-1.md"), "utf8")).toBe("bản cũ");
    expect(row(sqlite, "acc-5")).toEqual({ imp_number: 1, drafted_at: null });
  });

  it("refuses a retry against an existing IMP-<n>.md before any spend or runner call, on every attempt", async () => {
    const sqlite = freshDb();
    const root = tempRoot();
    writeFileSync(join(root, "IMP-1.md"), "bản cũ");
    seed(sqlite, "acc-6");
    const runner = runnerReturning("# mới");
    expect(await draftProposal(sqlite, "acc-6", { runner, root }))
      .toEqual({ status: "refused", reason: "exists", impNumber: 1 });
    expect(await draftProposal(sqlite, "acc-6", { runner, root }))
      .toEqual({ status: "refused", reason: "exists", impNumber: 1 });
    expect(runner).not.toHaveBeenCalled();
    expect(spentLlm(sqlite)).toBe(0);
    expect(row(sqlite, "acc-6").drafted_at).toBeNull();
  });

  it("stops at the llmCalls limit before the runner, keeping the number and drafted_at NULL", async () => {
    const sqlite = freshDb();
    const root = tempRoot();
    seed(sqlite, "acc-7");
    const limit = selfImprovementBudgetStatus(sqlite).limits.llmCalls;
    for (let i = 0; i < limit; i++) consumeSelfImprovementBudget(sqlite, "llmCalls");
    const runner = runnerReturning("# IMP-1");
    expect(await draftProposal(sqlite, "acc-7", { runner, root })).toEqual({ status: "pending", reason: "budget_limit", impNumber: 1 });
    expect(runner).not.toHaveBeenCalled();
    expect(row(sqlite, "acc-7")).toEqual({ imp_number: 1, drafted_at: null });
  });

  it.each([
    ["an open row", "acc-open", "open", "tool"],
    ["a rejected row", "acc-rej", "rejected", "tool"],
    ["an accepted feature row", "acc-feat", "accepted", "feature"],
  ])("skips %s before any spend, number or runner call", async (_label, id, status, kind) => {
    const sqlite = freshDb();
    const root = tempRoot();
    seed(sqlite, id, status, kind);
    const runner = runnerReturning("# IMP-1");
    expect(await draftProposal(sqlite, id, { runner, root })).toEqual({ status: "skipped", reason: "not_accepted" });
    expect(runner).not.toHaveBeenCalled();
    expect(spentLlm(sqlite)).toBe(0);
    expect(row(sqlite, id)).toEqual({ imp_number: null, drafted_at: null });
  });

  it("skips an unknown id with no spend and no runner call", async () => {
    const sqlite = freshDb();
    const runner = runnerReturning("# IMP-1");
    expect(await draftProposal(sqlite, "no-such", { runner, root: tempRoot() })).toEqual({ status: "skipped", reason: "not_accepted" });
    expect(runner).not.toHaveBeenCalled();
    expect(spentLlm(sqlite)).toBe(0);
  });

  // Added after the full suite run (same tree otherwise). The marker write is conditional, so a concurrent change is reported, not overwritten.
  it("reports state_changed and keeps a draft marker that another run set during the runner call", async () => {
    const sqlite = freshDb();
    const root = tempRoot();
    seed(sqlite, "acc-8");
    const runner = vi.fn(async (_request: unknown) => {
      sqlite.prepare("UPDATE improvement_requests SET drafted_at = 'sentinel' WHERE id = 'acc-8'").run();
      return "# IMP-1";
    });
    expect(await draftProposal(sqlite, "acc-8", { runner, root })).toEqual({ status: "skipped", reason: "state_changed" });
    expect(row(sqlite, "acc-8").drafted_at).toBe("sentinel");
    expect(readFileSync(join(root, "IMP-1.md"), "utf8")).toBe("# IMP-1");
  });

  it("reports state_changed and leaves drafted_at NULL when the row left accepted during the runner call", async () => {
    const sqlite = freshDb();
    const root = tempRoot();
    seed(sqlite, "acc-9");
    const runner = vi.fn(async (_request: unknown) => {
      sqlite.prepare("UPDATE improvement_requests SET status = 'open' WHERE id = 'acc-9'").run();
      return "# IMP-1";
    });
    expect(await draftProposal(sqlite, "acc-9", { runner, root })).toEqual({ status: "skipped", reason: "state_changed" });
    expect(row(sqlite, "acc-9").drafted_at).toBeNull();
    expect(readFileSync(join(root, "IMP-1.md"), "utf8")).toBe("# IMP-1");
  });

  it("returns in_flight for a second call on the same row while the first is running: no spend, no second runner call", async () => {
    const sqlite = freshDb();
    const root = tempRoot();
    seed(sqlite, "acc-10");
    let release: (text: string) => void = () => {};
    let calls = 0;
    // First call holds on a deferred promise. Any later call resolves at once, so without the guard the second call finishes and the test fails on its assertion, not on a timeout.
    const runner = vi.fn((_request: unknown) => {
      calls += 1;
      if (calls === 1) return new Promise<string>((resolve) => { release = resolve; });
      return Promise.resolve("# IMP-1");
    });
    const first = draftProposal(sqlite, "acc-10", { runner, root });
    expect(await draftProposal(sqlite, "acc-10", { runner, root })).toEqual({ status: "skipped", reason: "in_flight" });
    expect(runner).toHaveBeenCalledTimes(1);
    expect(spentLlm(sqlite)).toBe(1);
    release("# IMP-1");
    expect(await first).toMatchObject({ status: "drafted", impNumber: 1 });
    expect(row(sqlite, "acc-10").drafted_at).not.toBeNull();
  });

  it("keys the in-flight guard by database and row: another row on the same db, or the same id on another db, is not blocked", async () => {
    const dbA = freshDb();
    const dbB = freshDb();
    const rootA = tempRoot();
    const rootB = tempRoot();
    seed(dbA, "acc-13");
    seed(dbA, "acc-14");
    seed(dbB, "acc-13");
    let release: (text: string) => void = () => {};
    const hold = vi.fn((_request: unknown) => new Promise<string>((resolve) => { release = resolve; }));
    const first = draftProposal(dbA, "acc-13", { runner: hold, root: rootA });
    const fast = runnerReturning("# IMP-x");
    expect(await draftProposal(dbA, "acc-14", { runner: fast, root: rootA })).toMatchObject({ status: "drafted", impNumber: 2 });
    expect(await draftProposal(dbB, "acc-13", { runner: fast, root: rootB })).toMatchObject({ status: "drafted", impNumber: 1 });
    expect(hold).toHaveBeenCalledTimes(1);
    release("# IMP-1");
    expect(await first).toMatchObject({ status: "drafted", impNumber: 1 });
  });

  it("refuses an invalid root with the writer's reason before any spend or runner call", async () => {
    const sqlite = freshDb();
    seed(sqlite, "acc-12");
    const runner = runnerReturning("# IMP-1");
    const missing = join(tmpdir(), `imp-no-such-${process.pid}-${Date.now()}`);
    expect(await draftProposal(sqlite, "acc-12", { runner, root: missing }))
      .toEqual({ status: "refused", reason: "bad_root", impNumber: 1 });
    expect(runner).not.toHaveBeenCalled();
    expect(spentLlm(sqlite)).toBe(0);
    expect(row(sqlite, "acc-12")).toEqual({ imp_number: 1, drafted_at: null });
  });

  it("releases the in-flight guard when the runner throws, so a later call runs again", async () => {
    const sqlite = freshDb();
    const root = tempRoot();
    seed(sqlite, "acc-11");
    const failing = vi.fn(async (_request: unknown) => { throw new Error("llm down"); });
    await expect(draftProposal(sqlite, "acc-11", { runner: failing, root })).rejects.toThrow("llm down");
    const ok = runnerReturning("# IMP-1");
    expect(await draftProposal(sqlite, "acc-11", { runner: ok, root })).toMatchObject({ status: "drafted", impNumber: 1 });
    expect(ok).toHaveBeenCalledTimes(1);
  });
});
