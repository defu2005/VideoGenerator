import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentEvent } from "@vg/shared";
import { subscribeAgentEvents } from "../src/events/agentBus.js";
import { createUserRequest } from "../src/operator/autopilot.js";
import { recordBudgetFindings } from "../src/operator/autonomyBudget.js";

const PROFILE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WS = "ws-test-main";
const NOW = new Date("2026-11-19T10:00:00.000Z");

function db() {
  const sqlite = new Database(":memory:");
  sqlite.exec(
    "CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);"
    + "CREATE TABLE profiles (id TEXT PRIMARY KEY, automation TEXT, archived_at TEXT, workspace_id TEXT);"
    + "CREATE TABLE supervisor_findings (id TEXT PRIMARY KEY, profile_id TEXT, kind TEXT NOT NULL, severity TEXT NOT NULL, dedupe_key TEXT NOT NULL UNIQUE, detail TEXT NOT NULL, first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, status TEXT NOT NULL);"
    + "CREATE TABLE agent_instances (instance TEXT PRIMARY KEY, kind TEXT, last_seen_at TEXT, on_duty INTEGER, duty_heartbeat_at TEXT);"
    + "CREATE TABLE agent_escalations (id TEXT PRIMARY KEY, from_kind TEXT, from_instance TEXT, to_kind TEXT, kind TEXT, object_ref TEXT, summary TEXT, evidence TEXT, status TEXT, deadline_at TEXT, hops INTEGER, note TEXT, created_at TEXT, updated_at TEXT);"
    + "CREATE TABLE operator_requests (id TEXT PRIMARY KEY, profile_id TEXT, kind TEXT NOT NULL, title TEXT NOT NULL, why_vi TEXT NOT NULL, action_url TEXT NOT NULL, dedupe_key TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, resolved_at TEXT, check_kind TEXT NOT NULL, check_args TEXT NOT NULL);",
  );
  sqlite.prepare("INSERT INTO profiles (id, automation, archived_at, workspace_id) VALUES (?, '{}', NULL, ?)").run(PROFILE, WS);
  return sqlite;
}

// Hand-built status: recordBudgetFindings reads only day, state and scopes[].
function status(spentDaily: number, limitDaily: number, profileId: string | null = PROFILE) {
  return {
    day: "2026-11-19", state: spentDaily >= limitDaily ? "stop" : "warn", retryAt: null,
    scopes: [{ profileId, limits: { dailyUsd: limitDaily, monthlyUsd: null }, spend: { dailyUsd: spentDaily, monthlyUsd: spentDaily } }],
  } as never;
}

function request(sqlite: Database.Database, over: Partial<Parameters<typeof createUserRequest>[1]> = {}) {
  return createUserRequest(sqlite, {
    profileId: PROFILE, kind: "info", title: "Chọn chủ đề", whyVi: "Cần bạn chọn.",
    actionUrl: "/operator", dedupeKey: "k:1", checkKind: "unclear_instruction", now: () => NOW, maxQuestionsPerDay: 10,
    ...over,
  });
}

describe("budget_wait and needs_user publishers (TASK-149)", () => {
  let sqlite: Database.Database;
  let seen: AgentEvent[];
  let seenWs: (string | undefined)[];
  let unsub: () => void;
  beforeEach(() => {
    sqlite = db();
    seen = [];
    seenWs = [];
    unsub = subscribeAgentEvents((event, ws) => { seen.push(event); seenWs.push(ws); });
  });
  afterEach(() => { unsub(); sqlite.close(); });

  it("budget at 100% publishes exactly one budget_wait for the profile workspace", () => {
    recordBudgetFindings(sqlite, status(12, 10), NOW);
    const waits = seen.filter((e) => e.type === "budget_wait");
    expect(waits).toHaveLength(1);
    expect(waits[0].summary).toBe("Ngân sách kênh đã đạt 100% hạn mức (trong ngày)");
    expect(seenWs[seen.indexOf(waits[0])]).toBe(WS);
  });

  it("a repeat with the same dedupe key publishes no second budget_wait", () => {
    recordBudgetFindings(sqlite, status(12, 10), NOW);
    recordBudgetFindings(sqlite, status(12, 10), NOW);
    expect(seen.filter((e) => e.type === "budget_wait")).toHaveLength(1);
  });

  it("80% (budget_warn) publishes no budget_wait but still publishes supervisor_finding", () => {
    recordBudgetFindings(sqlite, status(8.5, 10), NOW);
    expect(seen.some((e) => e.type === "budget_wait")).toBe(false);
    expect(seen.some((e) => e.type === "supervisor_finding")).toBe(true);
  });

  it("a null profile publishes budget_wait with no workspace filter and the app-wide summary", () => {
    recordBudgetFindings(sqlite, status(12, 10, null), NOW);
    const idx = seen.findIndex((e) => e.type === "budget_wait");
    expect(seen[idx].summary).toBe("Ngân sách toàn ứng dụng đã đạt 100% hạn mức (trong ngày)");
    expect(seenWs[idx]).toBeUndefined();
  });

  it("a new open request publishes exactly one needs_user, with the scope prefix and actionUrl as link", () => {
    const out = request(sqlite);
    expect(out.created).toBe(true);
    const events = seen.filter((e) => e.type === "needs_user");
    expect(events).toHaveLength(1);
    expect(events[0].summary).toBe("[kênh] Chọn chủ đề");
    expect(events[0].link).toBe("/operator");
  });

  it("a dedupe hit on an open request publishes no needs_user", () => {
    request(sqlite);
    const again = request(sqlite);
    expect(again.created).toBe(false);
    expect(seen.filter((e) => e.type === "needs_user")).toHaveLength(1);
  });

  it("the QUESTION_CAP throw publishes no needs_user", () => {
    expect(() => request(sqlite, { maxQuestionsPerDay: 0, dedupeKey: "k:cap" })).toThrow();
    expect(seen.some((e) => e.type === "needs_user")).toBe(false);
  });

  it("Hermes on duty with an agent-solvable kind escalates to Hermes and publishes no needs_user", () => {
    sqlite.prepare("INSERT INTO agent_instances (instance, kind, last_seen_at, on_duty, duty_heartbeat_at) VALUES ('hermes/1', 'hermes', ?, 1, ?)").run(NOW.toISOString(), NOW.toISOString());
    const out = request(sqlite, { dedupeKey: "k:hermes", checkKind: "unclear_instruction" });
    expect(out.created).toBe(true);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM operator_requests").get()).toEqual({ n: 0 });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM agent_escalations").get()).toEqual({ n: 1 });
    expect(seen.some((e) => e.type === "needs_user")).toBe(false);
  });

  it("needs_user summary is at most 200 characters", () => {
    request(sqlite, { title: "x".repeat(400), dedupeKey: "k:long" });
    const ev = seen.find((e) => e.type === "needs_user");
    expect(ev?.summary.length).toBeLessThanOrEqual(200);
  });

  it("publish runs outside any transaction (budget path and createUserRequest)", () => {
    const flags: boolean[] = [];
    const probe = subscribeAgentEvents((e) => { if (e.type === "budget_wait" || e.type === "needs_user") flags.push(sqlite.inTransaction); });
    recordBudgetFindings(sqlite, status(12, 10), NOW);
    request(sqlite, { dedupeKey: "k:tx" });
    probe();
    expect(flags).toEqual([false, false]);
  });

  it("a throwing listener for budget_wait/needs_user does not break the budget loop or createUserRequest", () => {
    const boom = subscribeAgentEvents((e) => {
      if (e.type === "budget_wait" || e.type === "needs_user") throw new Error("listener down");
    });
    expect(() => recordBudgetFindings(sqlite, status(12, 10), NOW)).not.toThrow();
    const out = request(sqlite, { dedupeKey: "k:boom" });
    boom();
    expect(out.created).toBe(true);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM operator_requests WHERE id = ?").get(out.id)).toEqual({ n: 1 });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM supervisor_findings").get()).toEqual({ n: 1 });
  });
});
