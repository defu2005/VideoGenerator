import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ASSISTANT_TOOLS } from "../src/assistant/tools.js";
import { systemActorFor } from "../src/auth/workspaces.js";
import { openDatabase } from "../src/db/client.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { setOperatorToolHooks } from "../src/operator/hooks.js";
import { MAX_ROUTE_CHECK_RUNS, missingRouteChecks, recordRouteCheck } from "../src/operator/proposalGate.js";
import { invokeRegistryTool } from "../src/registry/invoke.js";

// TASK-074c-2 pre-check gate. Each test uses a fresh run id, because the gate map is module state.
function freshDb() {
  const opened = openDatabase(":memory:");
  migrateDatabase(opened.db, undefined, opened.sqlite);
  return opened.sqlite;
}

const hooks = {
  findTools: () => ({ parts: [] }),
  findSkills: () => ({ parts: [] }),
} as any;

function proposalArgs(overrides: Record<string, unknown> = {}) {
  return {
    kind: "internal", name: "read_fixture_transcript",
    operation: "Đọc bản chép lời đã tạo", reproduction: "Mở dự án thử có file chép lời",
    impact: "Agent lấy được văn bản", inputSchema: { type: "object" }, outputSchema: { type: "object" },
    permissions: ["Đọc dự án được chọn"], dataSent: "Không gửi ra ngoài", requiresConfirmation: false,
    acceptance: ["Trả bản chép lời đúng dự án"], ...overrides,
  };
}

const rowCount = (sqlite: { prepare: (sql: string) => { get: () => unknown } }) =>
  (sqlite.prepare("SELECT COUNT(*) AS n FROM improvement_requests").get() as { n: number }).n;
const newRun = () => `run-${randomUUID()}`;

// Same entry point the operator runtime uses (modelRuntime.ts calls invokeRegistryTool with source "operator" and runId).
function invoke(sqlite: ReturnType<typeof freshDb>, name: string, args: unknown, runId?: string, turnId?: string) {
  return invokeRegistryTool({
    name, args, source: "operator", runId: runId ?? null,
    ctx: { sqlite, turnId } as any,
    actor: systemActorFor(sqlite),
    createPending: () => { throw new Error("createPending should not run for these tools"); },
  });
}
const check = (sqlite: ReturnType<typeof freshDb>, runId: string, name: "find_tools" | "find_skills") =>
  invoke(sqlite, name, { query: "đọc bản chép lời" }, runId);
const propose = (sqlite: ReturnType<typeof freshDb>, runId?: string) =>
  invoke(sqlite, "propose_missing_tool", proposalArgs(), runId);

describe("propose_missing_tool route-check gate", () => {
  beforeEach(() => setOperatorToolHooks(hooks));
  afterEach(() => setOperatorToolHooks(null));

  it("refuses when the run made neither check, names both, and records nothing", async () => {
    const sqlite = freshDb();
    const result = await propose(sqlite, newRun());
    expect(result).toMatchObject({ kind: "refused", message: expect.stringMatching(/find_tools.*find_skills/) });
    expect(rowCount(sqlite)).toBe(0);
    expect(sqlite.prepare("SELECT reason, decision FROM operator_tool_audit WHERE tool = 'propose_missing_tool'").all())
      .toEqual([{ reason: "ROUTE_CHECK_REQUIRED", decision: "refused" }]);
  });

  it("names only the missing check after one check", async () => {
    const sqlite = freshDb();
    const runId = newRun();
    await check(sqlite, runId, "find_tools");
    const result = await propose(sqlite, runId);
    expect(result).toMatchObject({ kind: "refused", message: "Cần gọi find_skills trong lượt này trước khi đề xuất công cụ." });
    expect(rowCount(sqlite)).toBe(0);
  });

  it("accepts the proposal once both checks ran in the same run", async () => {
    const sqlite = freshDb();
    const runId = newRun();
    await check(sqlite, runId, "find_tools");
    await check(sqlite, runId, "find_skills");
    await expect(propose(sqlite, runId)).resolves.toMatchObject({ kind: "result", result: { status: "proposed" } });
    expect(rowCount(sqlite)).toBe(1);
  });

  it("does not count checks made in another run", async () => {
    const sqlite = freshDb();
    const runA = newRun();
    await check(sqlite, runA, "find_tools");
    await check(sqlite, runA, "find_skills");
    expect(await propose(sqlite, newRun())).toMatchObject({ kind: "refused" });
    expect(rowCount(sqlite)).toBe(0);
  });

  it("does not treat a turn id as a run key", async () => {
    const sqlite = freshDb();
    await invoke(sqlite, "find_tools", { query: "đọc" }, undefined, "turn-1");
    await invoke(sqlite, "find_skills", { query: "đọc" }, undefined, "turn-1");
    expect(await propose(sqlite, newRun())).toMatchObject({ kind: "refused" });
    expect(await propose(sqlite, undefined)).toMatchObject({ kind: "result", result: { status: "proposed" } });
  });

  it("lets a proposal through when there is no run id", async () => {
    const sqlite = freshDb();
    await expect(propose(sqlite, undefined)).resolves.toMatchObject({ kind: "result", result: { status: "proposed" } });
  });

  it("lets a proposal through when the operator hooks are null", async () => {
    setOperatorToolHooks(null);
    const sqlite = freshDb();
    await expect(propose(sqlite, newRun())).resolves.toMatchObject({ kind: "result", result: { status: "proposed" } });
  });

  it.each([
    ["find_tools", "findTools"],
    ["find_skills", "findSkills"],
  ] as const)("records a %s check only after its hook returns", async (name, hookName) => {
    setOperatorToolHooks({ ...hooks, [hookName]: () => { throw new Error("search failed"); } });
    const sqlite = freshDb();
    const runId = newRun();
    await expect(check(sqlite, runId, name)).rejects.toThrow("search failed");
    expect(missingRouteChecks(runId)).toEqual(["find_tools", "find_skills"]);
  });

  it("evicts the oldest run once the map is full and keeps the newest", () => {
    const old = newRun();
    recordRouteCheck(old, "find_tools");
    recordRouteCheck(old, "find_skills");
    let last = "";
    for (let i = 0; i < MAX_ROUTE_CHECK_RUNS; i++) {
      last = newRun();
      recordRouteCheck(last, "find_tools");
      recordRouteCheck(last, "find_skills");
    }
    expect(missingRouteChecks(old)).toEqual(["find_tools", "find_skills"]);
    expect(missingRouteChecks(last)).toEqual([]);
  });
});
