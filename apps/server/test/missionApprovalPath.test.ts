import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { parseConfig } from "../src/lib/config.js";
import { runAsActor } from "../src/auth/requestContext.js";
import { invokeRegistryTool } from "../src/registry/invoke.js";
import { createMission, getMission } from "../src/missions/missions.js";
import { saveAutonomySettings } from "../src/operator/autonomy.js";
import { AUTONOMY_PRESETS, AutonomySettingsSchema } from "@vg/shared";
import { TEST_WORKSPACE_ID, testActor } from "./testActor.js";

// TASK-129c acceptance line 3, through the real assistant path: an approve_gate from chat with a
// mission attached. The level is read from app settings (effectiveAutonomy), not from the mission row.
// Refusal at the default level creates a pending action and holds the mission; the user's confirm
// runs the tool and resumes it. A supervised level (grants SCRIPT) runs the same call directly.
const fixtures: Array<{ app: ReturnType<typeof buildApp>; root: string }> = [];
afterEach(async () => { for (const { app, root } of fixtures.splice(0)) { await app.close(); rmSync(root, { recursive: true, force: true }); } });

const userActor = (role = "owner") => ({ ...testActor, kind: "user", isInstanceOwner: role === "owner", role }) as never;

async function setup() {
  const root = mkdtempSync(join(tmpdir(), "vg-mission-approval-"));
  const config = parseConfig({ DATA_DIR: root, DATABASE_PATH: join(root, "app.db"), WORKER_ENABLED: "false", LOG_LEVEL: "silent", LLM_ENABLE_MOCK: "true", LLM_DEFAULT_PROVIDER: "mock", TTS_PROVIDER: "mock", IMAGE_PROVIDERS: "mock" });
  const app = buildApp({ config, testActor: testActor as never });
  fixtures.push({ app, root });
  const service = app.vgAssistant.service;
  const ctx = service.toolContext();
  const sqlite = ctx.sqlite;
  const projectId = randomUUID();
  const now = new Date().toISOString();
  sqlite.prepare("INSERT INTO projects (id, title, description, topic, mode, settings, status, stage, thumbnail_path, duration_sec, version, created_at, updated_at, archived_at, run_mode) VALUES (?, 'Chat gate', '', 'lịch sử', 'ASSISTED', '{\"language\":\"vi\",\"targetDurationSec\":120}', 'ACTIVE', 'SCRIPT', NULL, 0, 1, ?, ?, NULL, 'MANUAL')").run(projectId, now, now);
  // A passing script so the script quality gate does not hold the autonomous run.
  sqlite.prepare(`INSERT INTO scripts (project_id, data, origin, edited, input_hash, version, provider, model, updated_at, quality_score, blocking_facts, revise_round)
    VALUES (?, '{}', 'AGENT', 0, 'h', 1, 'mock', 'mock', ?, 9, 0, 0)`).run(projectId, now);
  const mission = createMission(sqlite, TEST_WORKSPACE_ID, { command: "làm video", channelProfileId: null, projectIds: [] } as never, { createdBy: "user", owner: "codex/music" });
  sqlite.prepare("UPDATE missions SET state = 'producing', project_ids = ? WHERE id = ?").run(JSON.stringify([projectId]), mission.id);
  return { service, ctx, sqlite, projectId, missionId: mission.id };
}

const call = (h: Awaited<ReturnType<typeof setup>>, createPending: () => unknown) => runAsActor(userActor(), () => invokeRegistryTool({
  name: "approve_gate", args: { projectId: h.projectId, gate: "SCRIPT" }, source: "assistant",
  ctx: h.ctx, actor: userActor(),
  createPending: createPending as never,
}));

describe("mission approval path from chat (TASK-129c)", () => {
  it("refuses an ungranted gate at the default level as pending, holds the mission, and runs only after the user confirms", async () => {
    const h = await setup();
    expect(AUTONOMY_PRESETS.assist.approveGates).not.toContain("SCRIPT");
    const approve = vi.spyOn(h.ctx.orchestrator, "approveGate").mockImplementation(() => ({ ok: true }) as never);

    const refused = await call(h, () => h.service.createPendingApproveGate({ projectId: h.projectId, gate: "SCRIPT" }));
    expect(refused.kind).toBe("pending");
    expect(getMission(h.sqlite, TEST_WORKSPACE_ID, h.missionId).state).toBe("waiting_user");
    expect(approve).not.toHaveBeenCalled();

    const pendingId = (refused as { pendingActionId: string }).pendingActionId;
    await runAsActor(userActor(), () => h.service.confirmAction(pendingId));
    expect(approve).toHaveBeenCalledTimes(1);
    expect(getMission(h.sqlite, TEST_WORKSPACE_ID, h.missionId).state).toBe("producing");
  });

  it("runs the same call directly at a level that grants SCRIPT, with no pending row and the mission still producing", async () => {
    const h = await setup();
    expect(AUTONOMY_PRESETS.supervised.approveGates).toContain("SCRIPT");
    saveAutonomySettings(h.sqlite, AutonomySettingsSchema.parse({ level: "supervised", grants: AUTONOMY_PRESETS.supervised }));
    const approve = vi.spyOn(h.ctx.orchestrator, "approveGate").mockImplementation(() => ({ ok: true }) as never);
    const createPending = vi.fn(() => { throw new Error("granted gate must not create a pending action"); });

    const result = await call(h, createPending);
    expect(result.kind).toBe("result");
    expect(createPending).not.toHaveBeenCalled();
    expect(approve).toHaveBeenCalledTimes(1);
    expect(getMission(h.sqlite, TEST_WORKSPACE_ID, h.missionId).state).toBe("producing");
  });

  it("a confirmed action whose tool throws fails with ACTION_FAILED and leaves the mission waiting_user", async () => {
    const h = await setup();
    vi.spyOn(h.ctx.orchestrator, "approveGate").mockImplementation(() => { throw new Error("pipeline down"); });
    const refused = await call(h, () => h.service.createPendingApproveGate({ projectId: h.projectId, gate: "SCRIPT" }));
    expect(refused.kind).toBe("pending");
    const pendingId = (refused as { pendingActionId: string }).pendingActionId;
    await expect(runAsActor(userActor(), () => h.service.confirmAction(pendingId))).rejects.toMatchObject({ code: "ACTION_FAILED" });
    expect(getMission(h.sqlite, TEST_WORKSPACE_ID, h.missionId).state).toBe("waiting_user");
  });
});
