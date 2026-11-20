import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { parseConfig } from "../src/lib/config.js";
import { findRule } from "../src/auth/routePermissions.js";
import { cancelMission, createMission, getMission } from "../src/missions/missions.js";
import {
  advanceMissions, enterWaitingUser, markPinged, missionsToPing, PING_INTERVAL_MS, recordPublicationPublished, recordPublished, resumeMissionByUser, type MeasureFn,
} from "../src/missions/checkpoints.js";
import { TEST_WORKSPACE_ID, testActor } from "./testActor.js";

// TASK-129c slice 2: checkpoints (fake clock via injected `now`, mock measure), waiting_user gate, reminders.
// No duty holder exists in these tests: the tick must still run.
const apps: Array<{ close(): Promise<unknown> }> = [];
const roots: string[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function setup() {
  const root = mkdtempSync(join(tmpdir(), "vg-mission-checkpoints-")); roots.push(root);
  const config = parseConfig({ DATA_DIR: root, DATABASE_PATH: join(root, "app.db"), WORKER_ENABLED: "false", LOG_LEVEL: "silent", LLM_ENABLE_MOCK: "true", LLM_DEFAULT_PROVIDER: "mock", TTS_PROVIDER: "mock", IMAGE_PROVIDERS: "mock" });
  const app = buildApp({ config, testActor: { ...testActor } as never });
  apps.push(app);
  const sqlite = app.vgAssistant.service.toolContext().sqlite;
  const mission = createMission(sqlite, TEST_WORKSPACE_ID, { command: "làm 3 video", channelProfileId: null, projectIds: [] } as never, { createdBy: "user", owner: null });
  // Scheduled is set directly: the publish scheduler is not part of this slice.
  sqlite.prepare("UPDATE missions SET state = 'scheduled' WHERE id = ?").run(mission.id);
  return { app, sqlite, id: mission.id };
}

const T0 = new Date("2026-11-18T00:00:00.000Z");
const at = (hours: number) => new Date(T0.getTime() + hours * 3_600_000);
const okMeasure = (): MeasureFn => vi.fn(async (_m, kind) => ({ report: `Báo cáo ${kind}: 120 lượt xem.`, metrics: { views: 120 } }));

describe("mission checkpoints (slice 2)", () => {
  it("records publish only from scheduled, and writes the published row once", () => {
    const h = setup();
    recordPublished(h.sqlite, TEST_WORKSPACE_ID, h.id, T0);
    expect(getMission(h.sqlite, TEST_WORKSPACE_ID, h.id).state).toBe("published");
    expect(() => recordPublished(h.sqlite, TEST_WORKSPACE_ID, h.id, T0)).toThrow();
    expect(h.sqlite.prepare("SELECT COUNT(*) AS n FROM mission_checkpoints WHERE mission_id = ? AND kind = 'published'").get(h.id)).toEqual({ n: 1 });
  });

  it("fires no checkpoint before +2 h, then fires each once across reruns", async () => {
    const h = setup();
    recordPublished(h.sqlite, TEST_WORKSPACE_ID, h.id, T0);
    const measure = okMeasure();
    expect(await advanceMissions(h.sqlite, at(1), measure)).toEqual([]);
    expect(await advanceMissions(h.sqlite, at(2), measure)).toEqual([{ missionId: h.id, kind: "2h" }]);
    expect(await advanceMissions(h.sqlite, at(2), measure)).toEqual([]);
    expect(measure).toHaveBeenCalledTimes(1);
    expect(getMission(h.sqlite, TEST_WORKSPACE_ID, h.id).state).toBe("measuring");
  });

  it("retries a checkpoint whose numbers are not ready and keeps the order", async () => {
    const h = setup();
    recordPublished(h.sqlite, TEST_WORKSPACE_ID, h.id, T0);
    let ready = false;
    const measure: MeasureFn = vi.fn(async (_m, kind) => (kind === "2h" || ready ? { report: kind, metrics: {} } : null));
    await advanceMissions(h.sqlite, at(2), measure);
    await advanceMissions(h.sqlite, at(25), measure); // 24 h not ready: nothing fires after 2 h
    expect(h.sqlite.prepare("SELECT kind FROM mission_checkpoints WHERE mission_id = ? AND kind != 'published' ORDER BY kind").all(h.id)).toEqual([{ kind: "2h" }]);
    ready = true;
    expect((await advanceMissions(h.sqlite, at(26), measure)).map((f) => f.kind)).toEqual(["24h"]);
  });

  it("runs all four checkpoints to +7 d and closes the mission as done", async () => {
    const h = setup();
    recordPublished(h.sqlite, TEST_WORKSPACE_ID, h.id, T0);
    const fired = await advanceMissions(h.sqlite, at(24 * 7), okMeasure());
    expect(fired.map((f) => f.kind)).toEqual(["2h", "24h", "72h", "7d"]);
    expect(getMission(h.sqlite, TEST_WORKSPACE_ID, h.id).state).toBe("done");
  });

  it("does not depend on any duty holder being present", async () => {
    const h = setup();
    expect(h.sqlite.prepare("SELECT COUNT(*) AS n FROM agent_instances WHERE on_duty = 1").get()).toEqual({ n: 0 });
    recordPublished(h.sqlite, TEST_WORKSPACE_ID, h.id, T0);
    expect((await advanceMissions(h.sqlite, at(3), okMeasure())).length).toBe(1);
  });

  it("holds a mission at waiting_user until the user resumes it; resume from elsewhere is refused", () => {
    const h = setup();
    h.sqlite.prepare("UPDATE missions SET state = 'producing' WHERE id = ?").run(h.id);
    enterWaitingUser(h.sqlite, TEST_WORKSPACE_ID, h.id, T0);
    expect(getMission(h.sqlite, TEST_WORKSPACE_ID, h.id).state).toBe("waiting_user");
    expect(resumeMissionByUser(h.sqlite, TEST_WORKSPACE_ID, h.id, T0).state).toBe("producing");
    expect(() => resumeMissionByUser(h.sqlite, TEST_WORKSPACE_ID, h.id, T0)).toThrow();
  });

  it("pings a waiting mission once, then at most every 6 h", () => {
    const h = setup();
    h.sqlite.prepare("UPDATE missions SET state = 'producing' WHERE id = ?").run(h.id);
    enterWaitingUser(h.sqlite, TEST_WORKSPACE_ID, h.id, T0);
    expect(missionsToPing(h.sqlite, T0)).toEqual([h.id]);
    markPinged(h.sqlite, h.id, T0);
    expect(missionsToPing(h.sqlite, new Date(T0.getTime() + PING_INTERVAL_MS - 1))).toEqual([]);
    expect(missionsToPing(h.sqlite, new Date(T0.getTime() + PING_INTERVAL_MS))).toEqual([h.id]);
  });

  it("a failed ping send is not recorded, so the next tick retries", () => {
    const h = setup();
    h.sqlite.prepare("UPDATE missions SET state = 'producing' WHERE id = ?").run(h.id);
    enterWaitingUser(h.sqlite, TEST_WORKSPACE_ID, h.id, T0);
    // Nothing calls markPinged: the send "failed", so the mission is still due a moment later.
    expect(missionsToPing(h.sqlite, new Date(T0.getTime() + 60_000))).toEqual([h.id]);
  });

  it("a resume clears the old ping, so the next wait pings at once", () => {
    const h = setup();
    h.sqlite.prepare("UPDATE missions SET state = 'producing' WHERE id = ?").run(h.id);
    enterWaitingUser(h.sqlite, TEST_WORKSPACE_ID, h.id, T0);
    markPinged(h.sqlite, h.id, T0);
    resumeMissionByUser(h.sqlite, TEST_WORKSPACE_ID, h.id, T0);
    enterWaitingUser(h.sqlite, TEST_WORKSPACE_ID, h.id, new Date(T0.getTime() + 60_000));
    expect(missionsToPing(h.sqlite, new Date(T0.getTime() + 60_000))).toEqual([h.id]);
  });

  it("a throwing measure stops only its own mission; the others still fire", async () => {
    const a = setup();
    const other = createMission(a.sqlite, TEST_WORKSPACE_ID, { command: "làm 2 video", channelProfileId: null, projectIds: [] } as never, { createdBy: "user", owner: null });
    a.sqlite.prepare("UPDATE missions SET state = 'scheduled' WHERE id = ?").run(other.id);
    const b = { id: other.id };
    recordPublished(a.sqlite, TEST_WORKSPACE_ID, a.id, T0);
    recordPublished(a.sqlite, TEST_WORKSPACE_ID, b.id, T0);
    const measure: MeasureFn = vi.fn(async (m) => {
      if (m.id === a.id) throw new Error("analytics down");
      return { report: "ok", metrics: {} };
    });
    const fired = await advanceMissions(a.sqlite, at(2), measure);
    expect(fired).toEqual([{ missionId: b.id, kind: "2h" }]);
  });

  it("concurrent ticks report each checkpoint once", async () => {
    const h = setup();
    recordPublished(h.sqlite, TEST_WORKSPACE_ID, h.id, T0);
    const measure = okMeasure();
    const [x, y] = await Promise.all([advanceMissions(h.sqlite, at(2), measure), advanceMissions(h.sqlite, at(2), measure)]);
    expect(x.length + y.length).toBe(1);
  });

  it("a mission publication going out starts the clock; an ordinary publication does nothing", () => {
    const h = setup();
    const pub = (id: string, missionId: string | null, status: string) => h.sqlite.prepare(`INSERT INTO publications (id, project_id, render_id, account_id, status, visibility_requested, visibility_used, mission_id, created_at, updated_at)
      VALUES (?, 'p', 'r', 'a', ?, 'public', 'public', ?, ?, ?)`).run(id, status, missionId, T0.toISOString(), T0.toISOString());
    h.sqlite.pragma("foreign_keys = OFF");
    pub("pub-ordinary", null, "PUBLISHED");
    recordPublicationPublished(h.sqlite, "pub-ordinary", T0);
    expect(getMission(h.sqlite, TEST_WORKSPACE_ID, h.id).state).toBe("scheduled");
    pub("pub-1", h.id, "PUBLISHED");
    recordPublicationPublished(h.sqlite, "pub-1", T0);
    expect(getMission(h.sqlite, TEST_WORKSPACE_ID, h.id).state).toBe("published");
    // A second video of the same mission finds it already published: nothing happens, nothing throws.
    pub("pub-2", h.id, "PUBLISHED");
    expect(() => recordPublicationPublished(h.sqlite, "pub-2", T0)).not.toThrow();
  });

  it("cancelling a scheduled mission withdraws queued publications but not uploads in progress", () => {
    const h = setup();
    h.sqlite.pragma("foreign_keys = OFF");
    const pub = (id: string, status: string) => h.sqlite.prepare(`INSERT INTO publications (id, project_id, render_id, account_id, status, visibility_requested, visibility_used, mission_id, created_at, updated_at)
      VALUES (?, 'p', 'r', 'a', ?, 'public', 'public', ?, ?, ?)`).run(id, status, h.id, T0.toISOString(), T0.toISOString());
    pub("q1", "QUEUED");
    pub("s1", "SCHEDULED");
    pub("u1", "UPLOADING");
    cancelMission(h.sqlite, TEST_WORKSPACE_ID, h.id, T0);
    const statuses = Object.fromEntries((h.sqlite.prepare("SELECT id, status FROM publications WHERE mission_id = ?").all(h.id) as Array<{ id: string; status: string }>).map((r) => [r.id, r.status]));
    expect(statuses).toEqual({ q1: "CANCELLED", s1: "CANCELLED", u1: "UPLOADING" });
    expect(getMission(h.sqlite, TEST_WORKSPACE_ID, h.id).state).toBe("cancelled");
  });

  it("has the resume route for the user only, under operator.use", () => {
    expect(findRule("POST", "/api/missions/abc/resume")?.action).toBe("operator.use");
  });
});
