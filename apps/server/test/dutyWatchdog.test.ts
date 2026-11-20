import { buildDigest } from "../src/operator/autopilot.js";
import { afterEach, beforeEach, expect, it } from "vitest";
import { openDatabase } from "../src/db/client.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { dutyHeartbeat, DUTY_WATCHDOG_MS, watchdogDuty } from "../src/supervision/duty.js";
import { runAsActor } from "../src/auth/requestContext.js";
import { actorWith } from "./testActor.js";

// TASK-129c: the duty watchdog. Fakes only: fixed clock, in-memory db, no network.
let opened: ReturnType<typeof openDatabase>;
const t0 = new Date("2026-11-18T03:00:00Z");
const keyA = { kind: "hermes" as const, name: "a", instance: "hermes/a", model: null, environment: "wsl", canSupervise: true, trusted: true };
const keyB = { ...keyA, name: "b", instance: "hermes/b" };
beforeEach(() => {
  opened = openDatabase(":memory:"); migrateDatabase(opened.db, undefined, opened.sqlite);
  opened.sqlite.prepare("INSERT INTO organization (id,name,slug,created_at) VALUES ('A','A','A',1)").run();
});
afterEach(() => opened.sqlite.close());
const at = (ms: number) => new Date(t0.getTime() + ms);
const run = <T>(fn: () => T) => runAsActor(actorWith({ role: "owner", workspaceId: "A" }), fn);

it("does nothing when no duty holder has ever existed", () => run(() => {
  const alerts: string[] = [];
  expect(watchdogDuty(opened.sqlite, (t) => alerts.push(t), t0)).toBe(false);
  expect(alerts).toHaveLength(0);
}));

it("stays quiet while the holder heartbeats, and alerts once after 5 minutes of silence", () => run(() => {
  const alerts: string[] = [];
  const notify = (t: string) => alerts.push(t);
  dutyHeartbeat(opened.sqlite, keyA, null, t0);
  expect(watchdogDuty(opened.sqlite, notify, at(60_000))).toBe(false);
  // Silent past the duty lease and the 5-min watchdog window.
  const silent = at(DUTY_WATCHDOG_MS + 1_000);
  expect(watchdogDuty(opened.sqlite, notify, silent)).toBe(true);
  expect(watchdogDuty(opened.sqlite, notify, at(DUTY_WATCHDOG_MS + 60_000))).toBe(false);
  expect(alerts).toHaveLength(1);
}));

it("a standby takes duty on its first heartbeat after the holder goes silent, and the watchdog re-arms when the new holder goes silent", () => run(() => {
  const alerts: string[] = [];
  const notify = (t: string) => alerts.push(t);
  dutyHeartbeat(opened.sqlite, keyA, null, t0);
  const silentA = at(DUTY_WATCHDOG_MS + 1_000);
  expect(watchdogDuty(opened.sqlite, notify, silentA)).toBe(true);
  const takeover = dutyHeartbeat(opened.sqlite, keyB, null, silentA);
  expect(takeover.holder).toBe("hermes/b");
  // B is live: no alert.
  expect(watchdogDuty(opened.sqlite, notify, at(DUTY_WATCHDOG_MS + 60_000))).toBe(false);
  // B goes silent too: a new outage, measured from B's heartbeat, alerts once more.
  const silentB = new Date(silentA.getTime() + DUTY_WATCHDOG_MS + 1_000);
  expect(watchdogDuty(opened.sqlite, notify, silentB)).toBe(true);
  expect(alerts).toHaveLength(2);
}));

// TASK-129c: the digest's mission section. Same in-memory db; counts open, ended-today and published-today missions.
it("the digest lists missions in flight, ended today, and published today", () => run(() => {
  const db = opened.sqlite;
  const today = "2026-11-18T05:00:00.000Z";
  const insert = (id: string, state: string, updated: string) => db.prepare(
    `INSERT INTO missions (id, workspace_id, created_by, command, channel_profile_id, project_ids, plan, state, owner, autonomy_level, created_at, updated_at)
     VALUES (?, 'A', 'user', ?, NULL, '[]', '[]', ?, NULL, 'assist', ?, ?)`,
  ).run(id, `lệnh ${id}`, state, updated, updated);
  insert("m-run", "producing", today);
  insert("m-done", "done", today);
  insert("m-old", "done", "2026-11-10T05:00:00.000Z");
  db.prepare("INSERT INTO mission_checkpoints (mission_id, kind, at, metrics, report) VALUES ('m-run', 'published', ?, NULL, NULL)").run(today);
  const digest = buildDigest(db, () => new Date("2026-11-18T06:00:00.000Z"));
  expect(digest.missions.inFlight.map((m) => m.id)).toEqual(["m-run"]);
  expect(digest.missions.endedToday.map((m) => m.id)).toEqual(["m-done"]);
  expect(digest.missions.publishedToday).toBe(1);
}));

it("after a restart the watchdog waits 5 min from process start before alerting", () => run(() => {
  const alerts: string[] = [];
  const notify = (t: string) => alerts.push(t);
  dutyHeartbeat(opened.sqlite, keyA, null, t0);
  // The app was off for 20 min: start happens at t0+20min; no alert on the first tick.
  const started = at(20 * 60_000);
  expect(watchdogDuty(opened.sqlite, notify, at(20 * 60_000 + 1_000), started)).toBe(false);
  expect(watchdogDuty(opened.sqlite, notify, new Date(started.getTime() + DUTY_WATCHDOG_MS + 1_000), started)).toBe(true);
  expect(alerts).toHaveLength(1);
}));

it("the digest counts publishes on the Vietnam day and separates failed and waiting missions, with or without an actor", () => {
  const db = opened.sqlite;
  const at0 = "2026-11-18T00:00:00.000Z";
  const ins = (id: string, state: string) => db.prepare(
    `INSERT INTO missions (id, workspace_id, created_by, command, channel_profile_id, project_ids, plan, state, owner, autonomy_level, created_at, updated_at)
     VALUES (?, 'A', 'user', ?, NULL, '[]', '[]', ?, NULL, 'assist', ?, ?)`,
  ).run(id, `lệnh ${id}`, state, at0, "2026-11-18T03:00:00.000Z");
  ins("m-wait", "waiting_user");
  ins("m-fail", "failed");
  ins("m-pub", "measuring");
  // 2026-11-17 18:30 UTC is 2026-11-18 01:30 in Vietnam: it counts for day 2026-11-18.
  db.prepare("INSERT INTO mission_checkpoints (mission_id, kind, at, metrics, report) VALUES ('m-pub', 'published', '2026-11-17T18:30:00.000Z', NULL, NULL)").run();
  const clock = () => new Date("2026-11-18T06:00:00.000Z");
  // No actor: the supervisor tick path.
  const noActor = buildDigest(db, clock);
  expect(noActor.missions.publishedToday).toBe(1);
  expect(noActor.missions.waitingUser).toBe(1);
  expect(noActor.missions.failedToday).toBe(1);
  expect(noActor.missions.inFlight.map((m) => m.id).sort()).toEqual(["m-pub", "m-wait"]);
});
