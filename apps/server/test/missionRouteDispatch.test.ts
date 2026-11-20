import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { parseConfig } from "../src/lib/config.js";
import { saveKeyProfile } from "../src/supervision/identity.js";
import { TEST_OTHER_WORKSPACE_ID, TEST_WORKSPACE_ID, testActor } from "./testActor.js";

// TASK-129c slice 1: real dispatch with machine keys. Duty gates writes; workspace refs are checked.
const apps: Array<{ close(): Promise<unknown> }> = [];
const roots: string[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function makeApp(root: string, actor: Record<string, unknown>) {
  const config = parseConfig({ DATA_DIR: root, DATABASE_PATH: join(root, "app.db"), WORKER_ENABLED: "false", LOG_LEVEL: "silent", LLM_ENABLE_MOCK: "true", LLM_DEFAULT_PROVIDER: "mock", TTS_PROVIDER: "mock", IMAGE_PROVIDERS: "mock" });
  const app = buildApp({ config, testActor: { ...testActor, ...actor } as never });
  apps.push(app);
  return app;
}

function setup() {
  const root = mkdtempSync(join(tmpdir(), "vg-mission-dispatch-")); roots.push(root);
  const seed = makeApp(root, { kind: "apikey", keyId: "mission-music" });
  const sqlite = seed.vgAssistant.service.toolContext().sqlite;
  saveKeyProfile(sqlite, "mission-music", { agentKind: "codex", instanceName: "music" });
  const now = new Date().toISOString();
  for (const [id, ws] of [["p-1", TEST_WORKSPACE_ID], ["p-other", TEST_OTHER_WORKSPACE_ID]] as const) {
    sqlite.prepare("INSERT INTO projects (id, workspace_id, title, topic, mode, settings, status, stage, created_at, updated_at) VALUES (?, ?, ?, 't', 'm', '{}', 'draft', 'idea', ?, ?)")
      .run(id, ws, id, now, now);
  }
  sqlite.prepare("INSERT INTO agent_instances (instance, kind, environment, last_seen_at, on_duty, duty_heartbeat_at) VALUES (?, 'codex', 'test', ?, 1, ?)")
    .run("codex/music", now, now);
  // Profiles: one in this workspace, one in the other workspace.
  for (const [id, ws] of [["prof-ok", TEST_WORKSPACE_ID], ["prof-other", TEST_OTHER_WORKSPACE_ID]] as const) {
    sqlite.prepare("INSERT INTO profiles (id, workspace_id, name, default_brief, guidelines, created_at, updated_at) VALUES (?, ?, ?, '{}', '{}', ?, ?)").run(id, ws, id, now, now);
  }
  return { root, sqlite };
}

describe("mission routes: dispatch with machine keys", () => {
  it("refuses plan writes from an instance that is not on duty (403 MISSION_NOT_ON_DUTY)", async () => {
    const { root, sqlite } = setup();
    const user = makeApp(root, {});
    const created = await user.inject({ method: "POST", url: "/api/missions", payload: { command: "làm 3 video", projectIds: ["p-1"] } });
    expect(created.statusCode).toBe(201);
    const id = (created.json() as { mission: { id: string } }).mission.id;
    // Music's heartbeat expires: it stops holding duty.
    sqlite.prepare("UPDATE agent_instances SET on_duty = 0, duty_heartbeat_at = '2000-01-01T00:00:00.000Z' WHERE instance = 'codex/music'").run();
    const key = makeApp(root, { kind: "apikey", keyId: "mission-music" });
    const res = await key.inject({ method: "PUT", url: `/api/mission-agents/${id}/plan`, payload: { steps: [] } });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: { code: string } }).error.code).toBe("MISSION_NOT_ON_DUTY");
  });

  it("rejects a project from another workspace on create and attach (422)", async () => {
    const { root } = setup();
    const user = makeApp(root, {});
    const bad = await user.inject({ method: "POST", url: "/api/missions", payload: { command: "x", projectIds: ["p-other"] } });
    expect(bad.statusCode).toBe(422);
    const created = await user.inject({ method: "POST", url: "/api/missions", payload: { command: "x", projectIds: ["p-1"] } });
    const id = (created.json() as { mission: { id: string } }).mission.id;
    const key = makeApp(root, { kind: "apikey", keyId: "mission-music" });
    const attach = await key.inject({ method: "POST", url: `/api/mission-agents/${id}/projects`, payload: { projectId: "p-other" } });
    expect(attach.statusCode).toBe(422);
  });

  it("rejects a channel profile from another workspace and accepts one in this workspace", async () => {
    const { root } = setup();
    const user = makeApp(root, {});
    const other = await user.inject({ method: "POST", url: "/api/missions", payload: { command: "x", channelProfileId: "prof-other" } });
    expect(other.statusCode).toBe(422);
    const ok = await user.inject({ method: "POST", url: "/api/missions", payload: { command: "x", channelProfileId: "prof-ok" } });
    expect(ok.statusCode).toBe(201);
  });

  it("GET /api/missions/:id returns the checkpoints with their metrics and report", async () => {
    const { root, sqlite } = setup();
    const user = makeApp(root, {});
    const created = await user.inject({ method: "POST", url: "/api/missions", payload: { command: "x", projectIds: ["p-1"] } });
    const id = (created.json() as { mission: { id: string } }).mission.id;
    sqlite.prepare("INSERT INTO mission_checkpoints (mission_id, kind, at, metrics, report) VALUES (?, '2h', '2026-11-18T10:00:00.000Z', ?, ?)")
      .run(id, JSON.stringify({ views: 12 }), JSON.stringify({ text: "ok" }));
    const detail = await user.inject({ method: "GET", url: `/api/missions/${id}` });
    expect(detail.statusCode).toBe(200);
    const body = detail.json() as { mission: { id: string }; checkpoints: Array<{ kind: string; metrics: unknown; report: unknown }> };
    expect(body.mission.id).toBe(id);
    expect(body.checkpoints).toEqual([{ kind: "2h", at: "2026-11-18T10:00:00.000Z", metrics: { views: 12 }, report: { text: "ok" } }]);
  });
});
