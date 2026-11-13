import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { AUTONOMY_PRESETS } from "@vg/shared";
import { saveAutonomySettings } from "../src/operator/autonomy.js";
import { autonomyBudgetStatus, heldAutonomyUsd, holdAutonomyUsd, recordAutomaticMediaCost } from "../src/operator/autonomyBudget.js";
import { saveGoal } from "../src/operator/autopilot.js";
import { runPlaybooks, setGatewayBypass } from "../src/operator/playbooks.js";
import { runStandingPlans } from "../src/operator/planner.js";
import { undoAudit } from "../src/operator/undo.js";
import { UsageService } from "../src/services/usageService.js";

const profile = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function base(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE organization (id TEXT PRIMARY KEY, created_at INTEGER);
    CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
    CREATE TABLE profiles (id TEXT PRIMARY KEY, archived_at TEXT, automation TEXT, workspace_id TEXT);
    CREATE TABLE projects (id TEXT PRIMARY KEY, profile_id TEXT, title TEXT, workspace_id TEXT);
    CREATE TABLE platform_accounts (id TEXT PRIMARY KEY, profile_id TEXT);
    CREATE TABLE profile_topics (id TEXT PRIMARY KEY, profile_id TEXT, status TEXT, scheduled_for TEXT, project_id TEXT);
    CREATE TABLE publications (id TEXT PRIMARY KEY, project_id TEXT, status TEXT, visibility_used TEXT, guardrail_reason TEXT, scheduled_for TEXT, external_id TEXT, updated_at TEXT);
    CREATE TABLE supervisor_findings (id TEXT PRIMARY KEY, dedupe_key TEXT UNIQUE, status TEXT, resolution TEXT, kind TEXT);
    CREATE TABLE operator_tool_audit (id TEXT PRIMARY KEY, tool TEXT, summary TEXT, undo TEXT);
    CREATE TABLE operator_goals (id TEXT PRIMARY KEY, profile_id TEXT, text TEXT NOT NULL, spec TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, source TEXT NOT NULL, workspace_id TEXT);
    CREATE TABLE operator_preferences (id TEXT PRIMARY KEY, profile_id TEXT, rule TEXT NOT NULL, quote TEXT NOT NULL, scope TEXT NOT NULL, created_at TEXT NOT NULL, active INTEGER NOT NULL, workspace_id TEXT);
    CREATE TABLE operator_requests (id TEXT PRIMARY KEY, profile_id TEXT, kind TEXT NOT NULL, title TEXT NOT NULL, why_vi TEXT NOT NULL, action_url TEXT NOT NULL, dedupe_key TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, resolved_at TEXT, check_kind TEXT NOT NULL, check_args TEXT NOT NULL);
    CREATE TABLE operator_user_touches (object_key TEXT PRIMARY KEY, touched_at TEXT NOT NULL);
    CREATE TABLE routing_canaries (id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, stage TEXT NOT NULL, before TEXT NOT NULL, after TEXT NOT NULL, reason TEXT NOT NULL, remaining INTEGER NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE comments (id TEXT PRIMARY KEY, reply_external_id TEXT, status TEXT);
    CREATE TABLE project_stages (project_id TEXT, stage TEXT, state TEXT);
    CREATE TABLE jobs (id TEXT, project_id TEXT, stage TEXT, scope TEXT, status TEXT, attempt INT, usage TEXT, created_at TEXT, started_at TEXT, finished_at TEXT);
    CREATE TABLE cost_entries (id TEXT PRIMARY KEY, profile_id TEXT, project_id TEXT, kind TEXT, date TEXT, amount REAL, currency TEXT, source TEXT, note TEXT, created_at TEXT, workspace_id TEXT);
  `);
  db.prepare("INSERT INTO profiles (id, archived_at, automation) VALUES (?, NULL, NULL)").run(profile);
  const full = { level: "autonomous" as const, grants: AUTONOMY_PRESETS.autonomous };
  saveAutonomySettings(db, full);
  saveAutonomySettings(db, full, profile);
  return db;
}

describe("task 059 remaining rails", () => {
  it("applies the 05:00 plan and the Monday review", () => {
    const db = base();
    saveGoal(db, {
      profileId: profile,
      text: "1 video mỗi ngày lúc 20h",
      spec: { videosPerDay: 1, publishTime: "20:00", platforms: ["youtube"], formats: ["long"] },
      source: "web",
    });
    const morning = runStandingPlans(db, new Date("2026-11-09T22:10:00.000Z"));
    expect(morning.planner).toBe(true);
    const automation = JSON.parse((db.prepare("SELECT automation FROM profiles WHERE id = ?").get(profile) as { automation: string }).automation);
    expect(automation.publishTimes).toEqual(["20:00"]);
    const review = runStandingPlans(db, new Date("2026-11-08T23:10:00.000Z"));
    expect(review.review).toBe(true);
    const after = JSON.parse((db.prepare("SELECT automation FROM profiles WHERE id = ?").get(profile) as { automation: string }).automation);
    expect(after.publishTimes).toEqual(["20:30"]);
  });

  it("runs slot, topic and gateway playbooks before a model call", () => {
    const db = base();
    const at = "2026-11-10T02:00:00.000Z";
    db.prepare("INSERT INTO profile_topics (id, profile_id, status, scheduled_for, project_id) VALUES ('t1', ?, 'APPROVED', ?, NULL)")
      .run(profile, at);
    db.prepare("INSERT INTO supervisor_findings (id, dedupe_key, status, resolution, kind) VALUES ('1', 'slot_at_risk:s', 'open', NULL, 'slot_at_risk')").run();
    db.prepare("INSERT INTO supervisor_findings (id, dedupe_key, status, resolution, kind) VALUES ('2', 'topics_low:p', 'open', NULL, 'topics_low')").run();
    db.prepare("INSERT INTO supervisor_findings (id, dedupe_key, status, resolution, kind) VALUES ('3', 'gateway_unhealthy:app', 'open', NULL, 'gateway_unhealthy')").run();
    const suggested: string[] = [];
    const actions = runPlaybooks(db, [
      { kind: "slot_at_risk", key: "s", profileId: profile, detail: { publishAt: at } },
      { kind: "topics_low", key: "p", profileId: profile, detail: {} },
      { kind: "gateway_unhealthy", key: "app", detail: {} },
    ], { now: at, suggestTopics: (id) => { suggested.push(id); } });
    expect(actions).toHaveLength(3);
    expect(suggested).toEqual([profile]);
    expect(setGatewayBypass).toBeTypeOf("function");
    const moved = db.prepare("SELECT scheduled_for FROM profile_topics WHERE id = 't1'").get() as { scheduled_for: string };
    expect(Date.parse(moved.scheduled_for)).toBe(Date.parse(at) + 86_400_000);
    const gateway = db.prepare("SELECT value FROM app_settings WHERE key = 'autonomy.gatewayBypass'").get() as { value: string };
    expect(gateway.value).toBe("1");
  });

  it("undoes settings, a publication and a gate that has not moved on", () => {
    const db = base();
    db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES ('llmRouting', '{\"mode\":\"new\"}', '2026-11-10T00:00:00.000Z')").run();
    db.prepare("INSERT INTO publications (id, project_id, status, visibility_used, guardrail_reason, scheduled_for, external_id, updated_at) VALUES ('p1', 'j', 'PUBLISHED', 'public', NULL, NULL, 'yt1', '2026-11-10T00:00:00.000Z')").run();
    db.prepare("INSERT INTO project_stages (project_id, stage, state) VALUES ('j', 'SCRIPT', 'APPROVED')").run();
    const settingsId = "11111111-1111-4111-8111-111111111111";
    const publishId = "22222222-2222-4222-8222-222222222222";
    const gateId = "33333333-3333-4333-8333-333333333333";
    db.prepare("INSERT INTO operator_tool_audit (id, tool, summary, undo) VALUES (?, 'update_llm_settings', 'Đổi route', ?)").run(
      settingsId, JSON.stringify({ type: "settings", key: "llmRouting", value: "{\"mode\":\"old\"}" }),
    );
    db.prepare("INSERT INTO operator_tool_audit (id, tool, summary, undo) VALUES (?, 'publish_project', 'Đăng', ?)").run(
      publishId, JSON.stringify({ type: "publish", publicationId: "p1" }),
    );
    db.prepare("INSERT INTO operator_tool_audit (id, tool, summary, undo) VALUES (?, 'approve_gate', 'Duyệt', ?)").run(
      gateId, JSON.stringify({ type: "gate", projectId: "j", stage: "SCRIPT" }),
    );
    const privates: string[] = [];
    expect(undoAudit(db, settingsId).detail).toMatch(/cấu hình/);
    expect(JSON.parse((db.prepare("SELECT value FROM app_settings WHERE key = 'llmRouting'").get() as { value: string }).value).mode).toBe("old");
    undoAudit(db, publishId, { setPrivate: (id) => { privates.push(id); } });
    expect(privates).toEqual(["yt1"]);
    expect((db.prepare("SELECT status, visibility_used, guardrail_reason FROM publications WHERE id = 'p1'").get() as { status: string; visibility_used: string; guardrail_reason: string })).toMatchObject({
      status: "CANCELLED", visibility_used: "private", guardrail_reason: "withdrawn",
    });
    undoAudit(db, gateId);
    expect((db.prepare("SELECT state FROM project_stages WHERE stage = 'SCRIPT'").get() as { state: string }).state).toBe("WAITING_USER");
  });

  it("counts an automatic image charge and a concurrent hold against the daily cap", () => {
    const db = base();
    db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES ('autonomy.budget', ?, '2026-11-10T00:00:00.000Z')")
      .run(JSON.stringify({ dailyUsd: 0.012, monthlyUsd: 1, maxRendersPerDay: null, maxPublishesPerDayPerAccount: null, maxOperatorRunsPerDay: null, maxQuestionsPerDay: 3 }));
    recordAutomaticMediaCost(db, { profileId: profile, projectId: null, amountUsd: 0.01, note: "Brave", now: new Date("2026-11-10T03:00:00.000Z") });
    const usage = new UsageService(db, 26_000);
    const release = holdAutonomyUsd(0.01);
    const status = autonomyBudgetStatus(db, usage, undefined, new Date("2026-11-10T03:00:00.000Z"));
    expect(status.state).toBe("stop");
    expect(heldAutonomyUsd()).toBe(0.01);
    release();
    expect(autonomyBudgetStatus(db, usage, undefined, new Date("2026-11-10T03:00:00.000Z")).state).toBe("warn");
  });
});
