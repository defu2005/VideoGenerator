import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { subjectKeyForEvent, type NotificationEvent } from "@vg/shared";
import { buildApp } from "../src/app.js";
import { parseConfig } from "../src/lib/config.js";
import { createMission } from "../src/missions/missions.js";
import { advanceMissions, enterWaitingUser, holdMissionsForProject, markMissionScheduled, recordPublished, resumeMissionByUser, PING_INTERVAL_MS } from "../src/missions/checkpoints.js";
import { deliverMissionNotices, RETRY_BACKOFF_MS, type MissionNotifier } from "../src/missions/delivery.js";
import { localMeasure } from "../src/missions/measure.js";
import { listAgentEvents, resetAgentEvents } from "../src/events/agentBus.js";
import type { NotifyOutcome } from "../src/notifications/notificationService.js";
import { TEST_WORKSPACE_ID, testActor } from "./testActor.js";

// TASK-129c slice 2b: checkpoint and reminder delivery with a fake notifier (no Telegram, no network).
const apps: Array<{ close(): Promise<unknown> }> = [];
const roots: string[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function setup() {
  const root = mkdtempSync(join(tmpdir(), "vg-mission-delivery-")); roots.push(root);
  const config = parseConfig({ DATA_DIR: root, DATABASE_PATH: join(root, "app.db"), WORKER_ENABLED: "false", LOG_LEVEL: "silent", LLM_ENABLE_MOCK: "true", LLM_DEFAULT_PROVIDER: "mock", TTS_PROVIDER: "mock", IMAGE_PROVIDERS: "mock" });
  const app = buildApp({ config, testActor: { ...testActor } as never });
  apps.push(app);
  const sqlite = app.vgAssistant.service.toolContext().sqlite;
  const mission = createMission(sqlite, TEST_WORKSPACE_ID, { command: "làm 3 video", channelProfileId: null, projectIds: [] } as never, { createdBy: "user", owner: null });
  sqlite.prepare("UPDATE missions SET state = 'scheduled' WHERE id = ?").run(mission.id);
  return { sqlite, id: mission.id };
}

const T0 = new Date("2026-11-18T00:00:00.000Z");
const at = (hours: number) => new Date(T0.getTime() + hours * 3_600_000);

function fakeNotifier(outcome: NotifyOutcome | "throw" = "sent") {
  const events: NotificationEvent[] = [];
  const notifier: MissionNotifier = {
    deliver: vi.fn(async (event: NotificationEvent) => {
      events.push(event);
      if (outcome === "throw") throw new Error("telegram down");
      return outcome;
    }),
  };
  return { notifier, events };
}

describe("mission delivery (slice 2b)", () => {
  it("sends the checkpoint report; a failed send does not change the fired list or the mission state", async () => {
    const h = setup();
    recordPublished(h.sqlite, TEST_WORKSPACE_ID, h.id, T0);
    const measure = vi.fn(async () => ({ report: "Báo cáo +2 giờ.", metrics: { views: 5 } }));
    const fired = await advanceMissions(h.sqlite, at(2), measure);
    const { notifier, events } = fakeNotifier("failed");
    await deliverMissionNotices(h.sqlite, notifier, fired, at(2), "http://web");
    expect(events).toEqual([{ kind: "mission_checkpoint", missionId: h.id, command: "làm 3 video", checkpoint: "2h", report: "Báo cáo +2 giờ." }]);
    expect(fired).toEqual([{ missionId: h.id, kind: "2h" }]);
    expect(h.sqlite.prepare("SELECT state FROM missions WHERE id = ?").get(h.id)).toEqual({ state: "measuring" });
  });

  it("a throwing notifier never escapes the delivery step", async () => {
    const h = setup();
    recordPublished(h.sqlite, TEST_WORKSPACE_ID, h.id, T0);
    const fired = await advanceMissions(h.sqlite, at(2), vi.fn(async () => ({ report: "r", metrics: {} })));
    const { notifier } = fakeNotifier("throw");
    await expect(deliverMissionNotices(h.sqlite, notifier, fired, at(2), "http://web")).resolves.toBeUndefined();
  });

  it("a failed reminder is not recorded, so the next tick sends it again", async () => {
    const h = setup();
    h.sqlite.prepare("UPDATE missions SET state = 'producing' WHERE id = ?").run(h.id);
    enterWaitingUser(h.sqlite, TEST_WORKSPACE_ID, h.id, T0);
    const failed = fakeNotifier("failed");
    await deliverMissionNotices(h.sqlite, failed.notifier, [], T0, "http://web");
    const retry = fakeNotifier("sent");
    // Inside the 5-minute backoff after a failure: nothing is attempted.
    await deliverMissionNotices(h.sqlite, retry.notifier, [], new Date(T0.getTime() + 60_000), "http://web");
    expect(retry.events).toEqual([]);
    // After the backoff the failed reminder is sent again.
    await deliverMissionNotices(h.sqlite, retry.notifier, [], new Date(T0.getTime() + RETRY_BACKOFF_MS), "http://web");
    expect(retry.events.map((e) => e.kind)).toEqual(["mission_waiting_user"]);
  });

  it("a skipped reminder (Telegram off) still starts the 6 h throttle", async () => {
    const h = setup();
    h.sqlite.prepare("UPDATE missions SET state = 'producing' WHERE id = ?").run(h.id);
    enterWaitingUser(h.sqlite, TEST_WORKSPACE_ID, h.id, T0);
    const skipped = fakeNotifier("skipped");
    await deliverMissionNotices(h.sqlite, skipped.notifier, [], T0, "http://web");
    const later = fakeNotifier("sent");
    await deliverMissionNotices(h.sqlite, later.notifier, [], new Date(T0.getTime() + 60_000), "http://web");
    expect(later.events).toEqual([]);
    await deliverMissionNotices(h.sqlite, later.notifier, [], new Date(T0.getTime() + PING_INTERVAL_MS), "http://web");
    expect(later.events.length).toBe(1);
  });

  it("wait, ping, resume, wait again at +1 min: the second reminder is sent, not deduped", async () => {
    const h = setup();
    h.sqlite.prepare("UPDATE missions SET state = 'producing' WHERE id = ?").run(h.id);
    enterWaitingUser(h.sqlite, TEST_WORKSPACE_ID, h.id, T0);
    const first = fakeNotifier("sent");
    await deliverMissionNotices(h.sqlite, first.notifier, [], T0, "http://web");
    resumeMissionByUser(h.sqlite, TEST_WORKSPACE_ID, h.id, T0);
    const t1 = new Date(T0.getTime() + 60_000);
    enterWaitingUser(h.sqlite, TEST_WORKSPACE_ID, h.id, t1);
    const second = fakeNotifier("sent");
    await deliverMissionNotices(h.sqlite, second.notifier, [], t1, "http://web");
    expect(second.events.length).toBe(1);
    // The dedupe key differs per reminder, so the real service does not drop it as a duplicate.
    expect(first.events.length).toBe(1);
    expect(subjectKeyForEvent(first.events[0]!)).not.toBe(subjectKeyForEvent(second.events[0]!));
  });

  it("local measure returns null with no snapshot, then sums views across the mission's publications", () => {
    const h = setup();
    h.sqlite.pragma("foreign_keys = OFF");
    const insertPub = (id: string) => h.sqlite.prepare(`INSERT INTO publications (id, project_id, render_id, account_id, status, visibility_requested, visibility_used, mission_id, created_at, updated_at)
      VALUES (?, 'p', 'r', 'a', 'PUBLISHED', 'public', 'public', ?, ?, ?)`).run(id, h.id, T0.toISOString(), T0.toISOString());
    const snap = (pubId: string, views: number, fetchedAt: string) => h.sqlite.prepare(`INSERT INTO publication_metrics_snapshots (id, publication_id, fetched_at, views) VALUES (?, ?, ?, ?)`)
      .run(`${pubId}-${fetchedAt}`, pubId, fetchedAt, views);
    insertPub("v1");
    insertPub("v2");
    const mission = h.sqlite.prepare("SELECT id, workspace_id, command, state FROM missions WHERE id = ?").get(h.id) as never;
    const measure = localMeasure(h.sqlite, () => at(3));
    return measure(mission, "2h", T0.toISOString()).then(async (none) => {
      expect(none).toBeNull();
      snap("v1", 100, at(3).toISOString());
      expect(await measure(mission, "2h", T0.toISOString())).toBeNull(); // v2 still has no snapshot, inside the grace window
      snap("v2", 50, at(3).toISOString());
      const result = await measure(mission, "2h", T0.toISOString());
      expect(result?.metrics).toEqual({ views: 150, publications: 2, coverage: "2/2" });
    });
  });

  it("uses the first snapshot after the due time, so a catch-up tick does not report 7-day numbers as +2 h", async () => {
    const h = setup();
    h.sqlite.pragma("foreign_keys = OFF");
    h.sqlite.prepare(`INSERT INTO publications (id, project_id, render_id, account_id, status, visibility_requested, visibility_used, mission_id, created_at, updated_at)
      VALUES ('c1', 'p', 'r', 'a', 'PUBLISHED', 'public', 'public', ?, ?, ?)`).run(h.id, T0.toISOString(), T0.toISOString());
    h.sqlite.prepare(`INSERT INTO publication_metrics_snapshots (id, publication_id, fetched_at, views) VALUES ('s3', 'c1', ?, 100), ('s30', 'c1', ?, 900)`)
      .run(at(3).toISOString(), at(30).toISOString());
    const mission = h.sqlite.prepare("SELECT id, workspace_id, command, state FROM missions WHERE id = ?").get(h.id) as never;
    const result = await localMeasure(h.sqlite, () => at(40))(mission, "2h", T0.toISOString());
    expect(result?.metrics).toEqual({ views: 100, publications: 1, coverage: "1/1" });
  });

  it("after the grace window, reports the publications that have numbers and states the coverage", async () => {
    const h = setup();
    h.sqlite.pragma("foreign_keys = OFF");
    h.sqlite.prepare(`INSERT INTO publications (id, project_id, render_id, account_id, status, visibility_requested, visibility_used, mission_id, created_at, updated_at)
      VALUES ('g1', 'p', 'r', 'a', 'PUBLISHED', 'public', 'public', ?, ?, ?), ('g2', 'p', 'r', 'a', 'PUBLISHED', 'public', 'public', ?, ?, ?)`)
      .run(h.id, T0.toISOString(), T0.toISOString(), h.id, T0.toISOString(), T0.toISOString());
    h.sqlite.prepare(`INSERT INTO publication_metrics_snapshots (id, publication_id, fetched_at, views) VALUES ('gs', 'g1', ?, 100)`).run(at(3).toISOString());
    const mission = h.sqlite.prepare("SELECT id, workspace_id, command, state FROM missions WHERE id = ?").get(h.id) as never;
    const measure = localMeasure(h.sqlite, () => at(2 + 48 + 1));
    const result = await measure(mission, "2h", T0.toISOString());
    expect(result?.metrics).toEqual({ views: 100, publications: 2, coverage: "1/2" });
    expect(result?.report).toContain("Chỉ 1/2 video có số liệu");
  });

  it("skips a null-views snapshot and uses the next one that has a number", async () => {
    const h = setup();
    h.sqlite.pragma("foreign_keys = OFF");
    h.sqlite.prepare(`INSERT INTO publications (id, project_id, render_id, account_id, status, visibility_requested, visibility_used, mission_id, created_at, updated_at)
      VALUES ('n1', 'p', 'r', 'a', 'PUBLISHED', 'public', 'public', ?, ?, ?)`).run(h.id, T0.toISOString(), T0.toISOString());
    h.sqlite.prepare(`INSERT INTO publication_metrics_snapshots (id, publication_id, fetched_at, views) VALUES ('nn3', 'n1', ?, NULL), ('nn5', 'n1', ?, 100)`)
      .run(at(3).toISOString(), at(5).toISOString());
    const mission = h.sqlite.prepare("SELECT id, workspace_id, command, state FROM missions WHERE id = ?").get(h.id) as never;
    const result = await localMeasure(h.sqlite, () => at(10))(mission, "2h", T0.toISOString());
    expect(result?.metrics).toEqual({ views: 100, publications: 1, coverage: "1/1" });
  });

  it("with no publication measured after grace, prints no views figure and states 0 coverage", async () => {
    const h = setup();
    h.sqlite.pragma("foreign_keys = OFF");
    h.sqlite.prepare(`INSERT INTO publications (id, project_id, render_id, account_id, status, visibility_requested, visibility_used, mission_id, created_at, updated_at)
      VALUES ('z1', 'p', 'r', 'a', 'PUBLISHED', 'public', 'public', ?, ?, ?), ('z2', 'p', 'r', 'a', 'PUBLISHED', 'public', 'public', ?, ?, ?)`)
      .run(h.id, T0.toISOString(), T0.toISOString(), h.id, T0.toISOString(), T0.toISOString());
    const mission = h.sqlite.prepare("SELECT id, workspace_id, command, state FROM missions WHERE id = ?").get(h.id) as never;
    const result = await localMeasure(h.sqlite, () => at(51))(mission, "2h", T0.toISOString());
    expect(result?.metrics).toEqual({ publications: 2, coverage: "0/2" });
    expect(result?.report).toContain("chưa có số liệu từ nền tảng cho 2 video");
    expect(result?.report).not.toContain("lượt xem");
  });

  it("emits mission_state_changed once for published → measuring, and nothing when the tick does not fire", async () => {
    const h = setup();
    recordPublished(h.sqlite, TEST_WORKSPACE_ID, h.id, T0);
    resetAgentEvents();
    const measure = vi.fn(async () => ({ report: "r", metrics: {} }));
    await advanceMissions(h.sqlite, at(1), measure); // before the 2 h mark: nothing fires
    expect(listAgentEvents({ types: ["mission_state_changed"], workspaceId: TEST_WORKSPACE_ID })).toHaveLength(0);
    await advanceMissions(h.sqlite, at(2), measure);
    const events = listAgentEvents({ types: ["mission_state_changed"], workspaceId: TEST_WORKSPACE_ID });
    expect(events).toHaveLength(1);
    expect(h.sqlite.prepare("SELECT state FROM missions WHERE id = ?").get(h.id)).toEqual({ state: "measuring" });
  });

  it("markMissionScheduled moves producing → scheduled once and emits; other states are untouched", () => {
    const h = setup();
    h.sqlite.prepare("UPDATE missions SET state = 'producing' WHERE id = ?").run(h.id);
    resetAgentEvents();
    markMissionScheduled(h.sqlite, TEST_WORKSPACE_ID, h.id, T0);
    expect(h.sqlite.prepare("SELECT state FROM missions WHERE id = ?").get(h.id)).toEqual({ state: "scheduled" });
    expect(listAgentEvents({ types: ["mission_state_changed"], workspaceId: TEST_WORKSPACE_ID })).toHaveLength(1);
    // A second publication for the same mission does nothing.
    markMissionScheduled(h.sqlite, TEST_WORKSPACE_ID, h.id, T0);
    expect(listAgentEvents({ types: ["mission_state_changed"], workspaceId: TEST_WORKSPACE_ID })).toHaveLength(1);
    h.sqlite.prepare("UPDATE missions SET state = 'waiting_user' WHERE id = ?").run(h.id);
    markMissionScheduled(h.sqlite, TEST_WORKSPACE_ID, h.id, T0);
    expect(h.sqlite.prepare("SELECT state FROM missions WHERE id = ?").get(h.id)).toEqual({ state: "waiting_user" });
  });

  it("holdMissionsForProject holds only producing missions that include the project", () => {
    const h = setup();
    h.sqlite.prepare("UPDATE missions SET state = 'producing', project_ids = ? WHERE id = ?").run(JSON.stringify(["proj-a"]), h.id);
    const other = createMission(h.sqlite, TEST_WORKSPACE_ID, { command: "khác", channelProfileId: null, projectIds: [] } as never, { createdBy: "user", owner: null });
    h.sqlite.prepare("UPDATE missions SET state = 'producing', project_ids = ? WHERE id = ?").run(JSON.stringify(["proj-b"]), other.id);
    expect(holdMissionsForProject(h.sqlite, "proj-a", T0)).toEqual([h.id]);
    expect(h.sqlite.prepare("SELECT state FROM missions WHERE id = ?").get(h.id)).toEqual({ state: "waiting_user" });
    expect(h.sqlite.prepare("SELECT state FROM missions WHERE id = ?").get(other.id)).toEqual({ state: "producing" });
    // A mission already waiting, or not started, is left alone.
    expect(holdMissionsForProject(h.sqlite, "proj-a", T0)).toEqual([]);
  });

  it("a rejected resume (mission not waiting) throws and emits nothing", () => {
    const h = setup();
    resetAgentEvents();
    expect(() => resumeMissionByUser(h.sqlite, TEST_WORKSPACE_ID, h.id, T0)).toThrow();
    expect(listAgentEvents({ types: ["mission_state_changed"], workspaceId: TEST_WORKSPACE_ID })).toHaveLength(0);
  });
});
