import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { parseConfig } from "../src/lib/config.js";
import { runAsActor } from "../src/auth/requestContext.js";
import { invokeRegistryTool } from "../src/registry/invoke.js";
import { createMission } from "../src/missions/missions.js";
import { saveKeyProfile } from "../src/supervision/identity.js";
import { AppError } from "../src/lib/errors.js";
import { TEST_WORKSPACE_ID, testActor } from "./testActor.js";

// TASK-129c slice 1: mission tools through the registry with real machine keys.
// Refusals reject with the AppError code (no TypeError, no INTERNAL_ERROR).
const fixtures: Array<{ app: ReturnType<typeof buildApp>; root: string }> = [];
afterEach(async () => { for (const { app, root } of fixtures.splice(0)) { await app.close(); rmSync(root, { recursive: true, force: true }); } });

async function setup() {
  const root = mkdtempSync(join(tmpdir(), "vg-mission-tool-registry-"));
  const config = parseConfig({ DATA_DIR: root, DATABASE_PATH: join(root, "app.db"), WORKER_ENABLED: "false", LOG_LEVEL: "silent", LLM_ENABLE_MOCK: "true", LLM_DEFAULT_PROVIDER: "mock", TTS_PROVIDER: "mock", IMAGE_PROVIDERS: "mock" });
  const app = buildApp({ config, testActor: { ...testActor, kind: "apikey", keyId: "mt-music" } as never }); fixtures.push({ app, root });
  const ctx = app.vgAssistant.service.toolContext();
  const sqlite = ctx.sqlite;
  saveKeyProfile(sqlite, "mt-music", { agentKind: "codex", instanceName: "music" });
  saveKeyProfile(sqlite, "mt-review", { agentKind: "codex", instanceName: "review" });
  saveKeyProfile(sqlite, "mt-anon", { agentKind: "codex", instanceName: "unknown" });
  const now = new Date().toISOString();
  for (const instance of ["codex/music", "codex/review"]) {
    sqlite.prepare("INSERT INTO agent_instances (instance, kind, environment, last_seen_at, on_duty, duty_heartbeat_at) VALUES (?, 'codex', 'test', ?, 1, ?)").run(instance, now, now);
  }
  const mission = createMission(sqlite, TEST_WORKSPACE_ID, { command: "làm 3 video", channelProfileId: null, projectIds: [] } as never, {
    createdBy: "user", owner: "codex/music",
  });
  const who = (keyId: string | null) => ({ ...testActor, kind: keyId ? "apikey" : "user", keyId: keyId ?? undefined, role: "editor" }) as never;
  const call = (keyId: string | null, name: string, args: unknown) => runAsActor(who(keyId), () => invokeRegistryTool({
    name, args, source: "agent", ctx, actor: who(keyId),
    createPending: () => { throw new Error(`${name} is safe and must not create a pending action`); },
  }));
  return { sqlite, mission, call };
}

describe("mission tools through the registry (TASK-129c slice 1)", () => {
  it("lets the owner on duty write the plan", async () => {
    const h = await setup();
    const res = await h.call("mt-music", "mission_set_plan", { id: h.mission.id, steps: [{ title: "bước 1" }] }) as { kind: string; result: { mission: { plan: unknown[] } } };
    expect(res.kind).toBe("result");
    expect(res.result.mission.plan).toHaveLength(1);
  });

  it("refuses the owner when its heartbeat has expired (MISSION_NOT_ON_DUTY)", async () => {
    const h = await setup();
    h.sqlite.prepare("UPDATE agent_instances SET on_duty = 0, duty_heartbeat_at = '2000-01-01T00:00:00.000Z' WHERE instance = 'codex/music'").run();
    await expect(h.call("mt-music", "mission_set_plan", { id: h.mission.id, steps: [] })).rejects.toMatchObject({ code: "MISSION_NOT_ON_DUTY" });
  });

  it("refuses an on-duty instance that does not own the mission (MISSION_NOT_OWNER)", async () => {
    const h = await setup();
    // Music's duty lapsed and review holds fresh duty, but no heartbeat ran the handover, so music still owns the mission.
    h.sqlite.prepare("UPDATE agent_instances SET on_duty = 0, duty_heartbeat_at = '2000-01-01T00:00:00.000Z' WHERE instance = 'codex/music'").run();
    h.sqlite.prepare("UPDATE agent_instances SET on_duty = 1, duty_heartbeat_at = ? WHERE instance = 'codex/review'").run(new Date().toISOString());
    await expect(h.call("mt-review", "mission_set_plan", { id: h.mission.id, steps: [] })).rejects.toMatchObject({ code: "MISSION_NOT_OWNER" });
    await expect(h.call("mt-review", "mission_move", { id: h.mission.id, to: "producing" })).rejects.toMatchObject({ code: "MISSION_NOT_OWNER" });
  });

  it("refuses a caller with no agent identity with a structured code, not a TypeError", async () => {
    const h = await setup();
    // A user (no key) and a key with no instance name are both refused as AppErrors, never a TypeError.
    await expect(h.call(null, "mission_get", { id: h.mission.id })).rejects.toBeInstanceOf(AppError);
    await expect(h.call("mt-anon", "mission_get", { id: h.mission.id })).rejects.toBeInstanceOf(AppError);
  });
});

// TASK-129c: the chat tools for the user. Resume and cancel are confirm-risk, so they only become pending actions until the user approves.
describe("mission chat tools through the registry (TASK-129c)", () => {
  const userActor = (ctxTestActor: typeof testActor, role = "owner") => ({ ...ctxTestActor, kind: "user", isInstanceOwner: role === "owner", role }) as never;
  it("holds resume and cancel as pending actions and leaves the state unchanged", async () => {
    const h = await setup();
    h.sqlite.prepare("UPDATE missions SET state = 'waiting_user' WHERE id = ?").run(h.mission.id);
    const pendings: string[] = [];
    const ctx = { sqlite: h.sqlite } as never;
    for (const name of ["mission_resume", "mission_cancel"]) {
      const res = await runAsActor(userActor(testActor), () => invokeRegistryTool({
        name, args: { id: h.mission.id }, source: "assistant", ctx, actor: userActor(testActor),
        createPending: (p) => { pendings.push(p.tool); return { id: `pa-${p.tool}`, summary: p.summary }; },
      }));
      expect(res.kind).toBe("pending");
    }
    expect(pendings).toEqual(["mission_resume", "mission_cancel"]);
    expect((h.sqlite.prepare("SELECT state FROM missions WHERE id = ?").get(h.mission.id) as { state: string }).state).toBe("waiting_user");
  });

  it("holds the chat writers as pending even with autoConfirm, and leaves the state unchanged", async () => {
    const h = await setup();
    h.sqlite.prepare("UPDATE missions SET state = 'waiting_user' WHERE id = ?").run(h.mission.id);
    const ctx = { sqlite: h.sqlite } as never;
    for (const name of ["mission_resume", "mission_cancel"]) {
      const res = await runAsActor(userActor(testActor), () => invokeRegistryTool({
        name, args: { id: h.mission.id }, source: "assistant", ctx, actor: userActor(testActor), autoConfirm: true,
        createPending: (p) => ({ id: `pa-${p.tool}`, summary: p.summary }),
      }));
      expect(res.kind).toBe("pending");
    }
    expect((h.sqlite.prepare("SELECT state FROM missions WHERE id = ?").get(h.mission.id) as { state: string }).state).toBe("waiting_user");
  });

  it("refuses a signed-in editor (not the instance owner) on all three chat writers", async () => {
    const h = await setup();
    const { missionToolDefs } = await import("../src/missions/toolDefs.js");
    const ctx = { sqlite: h.sqlite } as never;
    const editor = userActor(testActor, "editor");
    for (const name of ["mission_create", "mission_resume", "mission_cancel"]) {
      const def = missionToolDefs.find((t) => t.name === name)!;
      const args = name === "mission_create" ? { command: "x" } : { id: h.mission.id };
      await expect(runAsActor(editor, () => def.execute(args, ctx))).rejects.toMatchObject({ code: "MISSION_USER_ONLY" });
    }
  });

  it("refuses an API-key actor in the chat tools' execute step (MISSION_USER_ONLY)", async () => {
    const h = await setup();
    const { missionToolDefs } = await import("../src/missions/toolDefs.js");
    const ctx = { sqlite: h.sqlite } as never;
    const keyActor = { ...testActor, kind: "apikey", keyId: "mt-music", role: "editor" } as never;
    for (const name of ["mission_create", "mission_resume", "mission_cancel"]) {
      const def = missionToolDefs.find((t) => t.name === name)!;
      const args = name === "mission_create" ? { command: "x" } : { id: h.mission.id };
      await expect(runAsActor(keyActor, () => def.execute(args, ctx))).rejects.toMatchObject({ code: "MISSION_USER_ONLY" });
    }
  });
});
