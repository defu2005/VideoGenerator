import { describe, expect, it, vi } from "vitest";
import { openDatabase } from "../src/db/client.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { consumeSelfImprovementBudget, saveSelfImprovementSettings, selfImprovementBudgetStatus } from "../src/operator/autonomyBudget.js";
import { fillOpenSource, isOpenSourcePending } from "../src/operator/improvementOpenSource.js";

// TASK-074c-3: openSource for M/L requests. The runner is injected, so these tests make no web or LLM call.
function freshDb() {
  const opened = openDatabase(":memory:");
  migrateDatabase(opened.db, undefined, opened.sqlite);
  return opened.sqlite;
}
type Sqlite = ReturnType<typeof freshDb>;

const ITEM = { name: "example-lib", url: "https://github.com/example/lib", licence: "MIT", note: "Thư viện mẫu" };

function seed(sqlite: Sqlite, id: string, effort: string | null, openSource: string | null = null) {
  sqlite.prepare(`INSERT INTO improvement_requests (id, kind, title, problem, proposal, evidence, acceptance, effort, open_source, status, weight, fingerprint, created_at, updated_at)
    VALUES (?, 'tool', ?, 'Thiếu công cụ mẫu', '{}', '[]', '[]', ?, ?, 'open', 1, ?, '2026-11-20T00:00:00.000Z', '2026-11-20T00:00:00.000Z')`)
    .run(id, `title_${id}`, effort, openSource, `tool:internal:${id}`);
}
const openSourceOf = (sqlite: Sqlite, id: string) =>
  (sqlite.prepare("SELECT open_source FROM improvement_requests WHERE id = ?").get(id) as { open_source: string | null }).open_source;
const spentResearch = (sqlite: Sqlite) => selfImprovementBudgetStatus(sqlite).used.researchRuns;
const runnerReturning = (value: unknown) => vi.fn(async (_request: unknown) => value);

describe("TASK-074c-3: fill openSource for M/L requests within the researchRuns budget", () => {
  it("calls the runner once for an M row with budget left, stores the list and spends one researchRuns", async () => {
    const sqlite = freshDb();
    seed(sqlite, "m-row", "M");
    const runner = runnerReturning([ITEM]);
    expect(await fillOpenSource(sqlite, "m-row", runner)).toEqual({ status: "filled", count: 1 });
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner.mock.calls[0][0]).toMatchObject({ id: "m-row", title: "title_m-row" });
    expect(JSON.parse(openSourceOf(sqlite, "m-row")!)).toEqual([ITEM]);
    expect(isOpenSourcePending({ effort: "M", openSource: openSourceOf(sqlite, "m-row") })).toBe(false);
    expect(spentResearch(sqlite)).toBe(1);
  });

  it("leaves an M row NULL, with no runner call and no throw, when the researchRuns budget is spent", async () => {
    const sqlite = freshDb();
    seed(sqlite, "m-spent", "M");
    const limit = selfImprovementBudgetStatus(sqlite).limits.researchRuns;
    for (let i = 0; i < limit; i++) consumeSelfImprovementBudget(sqlite, "researchRuns");
    const runner = runnerReturning([ITEM]);
    expect(await fillOpenSource(sqlite, "m-spent", runner)).toEqual({ status: "pending", reason: "budget_limit" });
    expect(runner).not.toHaveBeenCalled();
    expect(openSourceOf(sqlite, "m-spent")).toBeNull();
    expect(isOpenSourcePending({ effort: "M", openSource: openSourceOf(sqlite, "m-spent") })).toBe(true);
  });

  it.each([
    ["ECO is on", { eco: true }],
    ["automatic research is off", { automaticResearch: false }],
  ])("leaves an M row NULL with no runner call and no spend when %s", async (_label, settings) => {
    const sqlite = freshDb();
    saveSelfImprovementSettings(sqlite, settings);
    seed(sqlite, "m-off", "M");
    const runner = runnerReturning([ITEM]);
    expect(await fillOpenSource(sqlite, "m-off", runner)).toEqual({ status: "pending", reason: "disabled" });
    expect(runner).not.toHaveBeenCalled();
    expect(openSourceOf(sqlite, "m-off")).toBeNull();
    expect(spentResearch(sqlite)).toBe(0);
  });

  it.each([
    ["S", "S"],
    ["no", null],
  ])("skips a %s-effort row without a runner call or spend", async (_label, effort) => {
    const sqlite = freshDb();
    seed(sqlite, "small", effort);
    const runner = runnerReturning([ITEM]);
    expect(await fillOpenSource(sqlite, "small", runner)).toEqual({ status: "skipped", reason: "not_m_or_l" });
    expect(runner).not.toHaveBeenCalled();
    expect(spentResearch(sqlite)).toBe(0);
    expect(openSourceOf(sqlite, "small")).toBeNull();
  });

  it("does not call the runner again for a row already filled, including an empty list", async () => {
    const sqlite = freshDb();
    seed(sqlite, "l-empty", "L");
    const runner = runnerReturning([]);
    expect(await fillOpenSource(sqlite, "l-empty", runner)).toEqual({ status: "filled", count: 0 });
    expect(openSourceOf(sqlite, "l-empty")).toBe("[]");
    expect(await fillOpenSource(sqlite, "l-empty", runner)).toEqual({ status: "skipped", reason: "already_filled" });
    expect(runner).toHaveBeenCalledTimes(1);
    expect(spentResearch(sqlite)).toBe(1);
  });

  it("stores only the items that pass the schema (https url, name, licence, note)", async () => {
    const sqlite = freshDb();
    seed(sqlite, "m-mixed", "M");
    const insecure = { name: "insecure", url: "http://insecure.example/x", licence: "MIT", note: "không hợp lệ" };
    const runner = runnerReturning([ITEM, insecure, { ...ITEM, name: "other-lib" }]);
    expect(await fillOpenSource(sqlite, "m-mixed", runner)).toEqual({ status: "filled", count: 2 });
    expect(JSON.parse(openSourceOf(sqlite, "m-mixed")!).map((item: { name: string }) => item.name)).toEqual(["example-lib", "other-lib"]);
  });

  it("does not report filled when another fill stored the list while the runner was running", async () => {
    const sqlite = freshDb();
    seed(sqlite, "m-race", "M");
    const runner = vi.fn(async () => {
      sqlite.prepare("UPDATE improvement_requests SET open_source = '[]' WHERE id = 'm-race'").run();
      return [ITEM];
    });
    expect(await fillOpenSource(sqlite, "m-race", runner)).toEqual({ status: "skipped", reason: "already_filled" });
    expect(openSourceOf(sqlite, "m-race")).toBe("[]");
  });

  it("rejects and leaves the row pending when the runner throws, after one run is spent", async () => {
    const sqlite = freshDb();
    seed(sqlite, "m-throw", "M");
    const runner = vi.fn(async () => { throw new Error("research down"); });
    await expect(fillOpenSource(sqlite, "m-throw", runner)).rejects.toThrow("research down");
    expect(openSourceOf(sqlite, "m-throw")).toBeNull();
    expect(isOpenSourcePending({ effort: "M", openSource: openSourceOf(sqlite, "m-throw") })).toBe(true);
    expect(spentResearch(sqlite)).toBe(1);
  });

  it.each([
    ["undefined", undefined],
    ["an object", { items: [ITEM] }],
  ])("stores an empty list, not NULL, when the runner returns %s", async (_label, value) => {
    const sqlite = freshDb();
    seed(sqlite, "m-shape", "M");
    const runner = runnerReturning(value);
    expect(await fillOpenSource(sqlite, "m-shape", runner)).toEqual({ status: "filled", count: 0 });
    expect(openSourceOf(sqlite, "m-shape")).toBe("[]");
    expect(await fillOpenSource(sqlite, "m-shape", runner)).toEqual({ status: "skipped", reason: "already_filled" });
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("skips an unknown id with no spend and no runner call", async () => {
    const sqlite = freshDb();
    const runner = runnerReturning([ITEM]);
    expect(await fillOpenSource(sqlite, "no-such-row", runner)).toEqual({ status: "skipped", reason: "missing" });
    expect(runner).not.toHaveBeenCalled();
    expect(spentResearch(sqlite)).toBe(0);
  });

  it("reports pending only for an M or L row whose openSource is still NULL", () => {
    expect(isOpenSourcePending({ effort: "M", openSource: null })).toBe(true);
    expect(isOpenSourcePending({ effort: "L", openSource: null })).toBe(true);
    expect(isOpenSourcePending({ effort: "M", openSource: "[]" })).toBe(false);
    expect(isOpenSourcePending({ effort: "S", openSource: null })).toBe(false);
    expect(isOpenSourcePending({ effort: null, openSource: null })).toBe(false);
  });
});
