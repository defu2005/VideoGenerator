import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PROTECTED_PROJECT_ID } from "@vg/shared";
import { buildApp } from "../src/app.js";
import { parseConfig } from "../src/lib/config.js";
import { dutyHeartbeat, sweepDuty } from "../src/supervision/duty.js";
import { saveKeyProfile } from "../src/supervision/identity.js";
import { assertTransition, canTransition, handOverMissions } from "../src/missions/missions.js";
import { TEST_OTHER_WORKSPACE_ID, TEST_WORKSPACE_ID, testActor } from "./testActor.js";

// TASK-129c slice 1: mission create + plan, transitions, autonomy cap, protected project, handover, isolation, non-duty key.
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

/** Fresh app; `music` holds duty now; a machine key for `review` is registered with a fixed name. */
function setup() {
  const root = mkdtempSync(join(tmpdir(), "vg-missions-")); roots.push(root);
  const seed = makeApp(root, { kind: "apikey", keyId: "mission-music" });
  const sqlite = seed.vgAssistant.service.toolContext().sqlite;
  saveKeyProfile(sqlite, "mission-music", { agentKind: "codex", instanceName: "music" });
  saveKeyProfile(sqlite, "mission-review", { agentKind: "codex", instanceName: "review" });
  const now = new Date().toISOString();
  // Projects must belong to the test workspace; the other workspace gets its own, so cross-workspace refs fail.
  for (const [id, ws] of [["p-1", TEST_WORKSPACE_ID], ["p-2", TEST_WORKSPACE_ID], ["p-other", TEST_OTHER_WORKSPACE_ID]] as const) {
    sqlite.prepare("INSERT INTO projects (id, workspace_id, title, topic, mode, settings, status, stage, created_at, updated_at) VALUES (?, ?, ?, 't', 'm', '{}', 'draft', 'idea', ?, ?)")
      .run(id, ws, id, now, now);
  }
  for (const instance of ["codex/music", "codex/review"]) {
    sqlite.prepare("INSERT INTO agent_instances (instance, kind, environment, last_seen_at, on_duty, duty_heartbeat_at) VALUES (?, 'codex', 'test', ?, ?, ?)")
      .run(instance, now, instance === "codex/music" ? 1 : 0, instance === "codex/music" ? now : null);
  }
  return { root, sqlite };
}

const create = (app: ReturnType<typeof makeApp>, payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url: "/api/missions", payload: { command: "làm 3 video", ...payload } });

describe("missions (slice 1)", () => {
  it("creates a mission owned by the duty holder and lets the owner write its plan and project", async () => {
    const { root } = setup();
    const user = makeApp(root, {});
    const created = await create(user, { projectIds: ["p-1"] });
    expect(created.statusCode).toBe(201);
    const mission = (created.json() as { mission: { id: string; state: string; owner: string; projectIds: string[] } }).mission;
    expect(mission).toMatchObject({ state: "planning", owner: "codex/music", projectIds: ["p-1"] });

    const key = makeApp(root, { kind: "apikey", keyId: "mission-music" });
    const plan = await key.inject({ method: "PUT", url: `/api/mission-agents/${mission.id}/plan`, payload: { steps: [{ kind: "topic", title: "Berserk" }] } });
    expect(plan.statusCode).toBe(200);
    expect((plan.json() as { mission: { plan: unknown[] } }).mission.plan).toHaveLength(1);
    const attach = await key.inject({ method: "POST", url: `/api/mission-agents/${mission.id}/projects`, payload: { projectId: "p-2" } });
    expect((attach.json() as { mission: { projectIds: string[] } }).mission.projectIds).toEqual(["p-1", "p-2"]);
  });

  it("refuses an illegal transition and a second cancel", async () => {
    const { root } = setup();
    const user = makeApp(root, {});
    const id = ((await create(user, {})).json() as { mission: { id: string } }).mission.id;
    expect((await user.inject({ method: "POST", url: `/api/missions/${id}/cancel` })).statusCode).toBe(200);
    const again = await user.inject({ method: "POST", url: `/api/missions/${id}/cancel` });
    expect(again.statusCode).toBe(409);
    expect((again.json() as { error?: { code?: string }; code?: string }).error?.code ?? (again.json() as { code?: string }).code).toBe("MISSION_ILLEGAL_TRANSITION");
  });

  it("pure transition table: planning cannot jump to published, done is terminal", () => {
    expect(canTransition("planning", "published")).toBe(false);
    expect(() => assertTransition("planning", "published")).toThrow();
    expect(() => assertTransition("done", "producing")).toThrow();
    expect(canTransition("planning", "producing")).toBe(true);
  });

  it("caps the mission autonomy at the profile maximum (assist by default)", async () => {
    const { root } = setup();
    const user = makeApp(root, {});
    const res = await create(user, { autonomyLevel: "autonomous" });
    expect(res.statusCode).toBe(422);
    const ok = await create(user, { autonomyLevel: "assist" });
    expect(ok.statusCode).toBe(201);
  });

  it("refuses the protected project", async () => {
    const { root } = setup();
    const user = makeApp(root, {});
    const res = await create(user, { projectIds: [PROTECTED_PROJECT_ID] });
    expect(res.statusCode).toBe(403);
    const key = makeApp(root, { kind: "apikey", keyId: "mission-music" });
    const id = ((await create(user, {})).json() as { mission: { id: string } }).mission.id;
    const attach = await key.inject({ method: "POST", url: `/api/mission-agents/${id}/projects`, payload: { projectId: PROTECTED_PROJECT_ID } });
    expect(attach.statusCode).toBe(403);
  });

  it("refuses plan writes from a machine key that is not the owner", async () => {
    const { root } = setup();
    const user = makeApp(root, {});
    const id = ((await create(user, {})).json() as { mission: { id: string } }).mission.id;
    const other = makeApp(root, { kind: "apikey", keyId: "mission-review" });
    const res = await other.inject({ method: "PUT", url: `/api/mission-agents/${id}/plan`, payload: { steps: [] } });
    expect(res.statusCode).toBe(403);
    const anon = makeApp(root, { kind: "apikey", keyId: "no-such-key" });
    expect((await anon.inject({ method: "PUT", url: `/api/mission-agents/${id}/plan`, payload: { steps: [] } })).statusCode).toBe(403);
  });

  it("hands open missions to the new duty holder and keeps closed ones where they are", async () => {
    const { root, sqlite } = setup();
    const user = makeApp(root, {});
    const open = ((await create(user, {})).json() as { mission: { id: string } }).mission.id;
    const closed = ((await create(user, {})).json() as { mission: { id: string } }).mission.id;
    await user.inject({ method: "POST", url: `/api/missions/${closed}/cancel` });
    // music's heartbeat expires; review takes duty and inherits the open mission.
    sqlite.prepare("UPDATE agent_instances SET duty_heartbeat_at = ? WHERE instance = 'codex/music'").run(new Date(Date.now() - 10 * 60_000).toISOString());
    const reviewAgent = { instance: "codex/review", kind: "codex", environment: "test", canSupervise: true } as never;
    dutyHeartbeat(sqlite, reviewAgent, null, new Date());
    expect((await user.inject({ method: "GET", url: `/api/missions/${open}` })).json()).toMatchObject({ mission: { owner: "codex/review" } });
    expect((await user.inject({ method: "GET", url: `/api/missions/${closed}` })).json()).toMatchObject({ mission: { owner: "codex/music" } });
  });

  it("after sweepDuty clears the expired holder, the next heartbeat still moves the owner", async () => {
    const { root, sqlite } = setup();
    const user = makeApp(root, {});
    const open = ((await create(user, {})).json() as { mission: { id: string } }).mission.id;
    sqlite.prepare("UPDATE agent_instances SET duty_heartbeat_at = ? WHERE instance = 'codex/music'").run(new Date(Date.now() - 10 * 60_000).toISOString());
    sweepDuty(sqlite, new Date());
    dutyHeartbeat(sqlite, { instance: "codex/review", kind: "codex", environment: "test", canSupervise: true } as never, null, new Date());
    expect((await user.inject({ method: "GET", url: `/api/missions/${open}` })).json()).toMatchObject({ mission: { owner: "codex/review" } });
  });

  it("agent move cannot clear a user gate or publish", async () => {
    const { root, sqlite } = setup();
    const user = makeApp(root, {});
    const id = ((await create(user, {})).json() as { mission: { id: string } }).mission.id;
    sqlite.prepare("UPDATE missions SET state = 'waiting_user' WHERE id = ?").run(id);
    const key = makeApp(root, { kind: "apikey", keyId: "mission-music" });
    const res = await key.inject({ method: "POST", url: `/api/mission-agents/${id}/move`, payload: { to: "producing" } });
    expect(res.statusCode).toBe(403);
    expect((await user.inject({ method: "GET", url: `/api/missions/${id}` })).json()).toMatchObject({ mission: { state: "waiting_user" } });
  });

  it("handover with no previous owner assigns unowned open missions", () => {
    const { sqlite } = setup();
    sqlite.prepare("INSERT INTO missions (id, workspace_id, created_by, command, project_ids, plan, state, owner, autonomy_level, created_at, updated_at) VALUES ('m-free', ?, 'user', 'x', '[]', '[]', 'planning', NULL, 'assist', ?, ?)")
      .run(TEST_WORKSPACE_ID, new Date().toISOString(), new Date().toISOString());
    expect(handOverMissions(sqlite, "codex/review")).toBe(1);
    expect((sqlite.prepare("SELECT owner FROM missions WHERE id = 'm-free'").get() as { owner: string }).owner).toBe("codex/review");
  });

  it("isolates workspaces: another workspace sees no missions and gets 404", async () => {
    const { root } = setup();
    const user = makeApp(root, {});
    const id = ((await create(user, {})).json() as { mission: { id: string } }).mission.id;
    const other = makeApp(root, { workspaceId: TEST_OTHER_WORKSPACE_ID });
    expect((await other.inject({ method: "GET", url: "/api/missions" })).json()).toEqual({ missions: [] });
    expect((await other.inject({ method: "GET", url: `/api/missions/${id}` })).statusCode).toBe(404);
  });

  it("refuses machine keys on user routes", async () => {
    const { root } = setup();
    const key = makeApp(root, { kind: "apikey", keyId: "mission-music" });
    expect((await key.inject({ method: "POST", url: "/api/missions", payload: { command: "x" } })).statusCode).toBe(403);
    expect((await key.inject({ method: "GET", url: "/api/missions" })).statusCode).toBe(403);
  });
});
