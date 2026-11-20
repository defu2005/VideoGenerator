import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AUTONOMY_PRESETS, AutonomySettingsSchema, PROTECTED_PROJECT_ID, nextLadderAction, repairActionsFor } from "@vg/shared";

const hooks = vi.hoisted(() => ({
  script: async (_args: unknown, _ctx: unknown): Promise<unknown> => ({}),
  scene: async (_args: unknown, _ctx: unknown): Promise<unknown> => ({}),
  stage: async (_args: unknown, _ctx: unknown): Promise<unknown> => ({}),
}));
vi.mock("../src/operator/repairActions.js", async (original) => {
  const real = await original<typeof import("../src/operator/repairActions.js")>();
  return {
    ...real,
    executeRepairScript: (args: unknown, ctx: unknown) => hooks.script(args, ctx),
    executeRepairScene: (args: unknown, ctx: unknown) => hooks.scene(args, ctx),
    executeRepairRenderStage: (args: unknown, ctx: unknown) => hooks.stage(args, ctx),
  };
});

import { ASSISTANT_TOOLS } from "../src/assistant/tools.js";
import { openDatabase } from "../src/db/client.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { saveAutonomySettings } from "../src/operator/autonomy.js";
import { buildDigest } from "../src/operator/autopilot.js";
import {
  diagnose, listRepairLog, repairStats, reopenShelved, runQualityRepair, repairStep, type RepairEnv, type SceneView,
} from "../src/operator/qualityRepair.js";
import { listAgentEvents } from "../src/events/agentBus.js";
import { hardBlockMessage } from "../src/registry/policy.js";
import { UsageService } from "../src/services/usageService.js";

const roots: string[] = [];
const opens: Array<{ close: () => void }> = [];
afterEach(() => {
  for (const handle of opens.splice(0)) { try { handle.close(); } catch { /* already closed */ } }
  for (const root of roots.splice(0)) { try { rmSync(root, { recursive: true, force: true }); } catch { /* Windows keeps the file briefly */ } }
  hooks.script = async () => ({});
  hooks.scene = async () => ({});
  hooks.stage = async () => ({});
});

const projectId = "33333333-3333-4333-8333-333333333333";
const profileId = "22222222-2222-4222-8222-222222222222";
const defaultClock = () => new Date();
const now = () => defaultClock().toISOString();

function setup(options: {
  level?: "autonomous" | "supervised" | "assist";
  repair?: Record<string, unknown>;
  mode?: string;
  clock?: () => Date;
} = {}) {
  const clock = options.clock ?? defaultClock;
  const clockIso = () => clock().toISOString();
  const root = mkdtempSync(join(tmpdir(), "vg-repair-"));
  roots.push(root);
  const opened = openDatabase(join(root, "app.db"));
  migrateDatabase(opened.db);
  const sqlite = opened.sqlite;
  opens.push(sqlite);
  sqlite.prepare(`INSERT INTO profiles (id, name, default_brief, guidelines, created_at, updated_at) VALUES (?, 'Hồ sơ', '{}', '{}', ?, ?)`).run(profileId, clockIso(), clockIso());
  sqlite.prepare(`INSERT INTO projects (id, title, topic, mode, settings, status, stage, profile_id, created_at, updated_at)
    VALUES (?, 'Video thử', 'lịch sử', 'ASSISTED', ?, 'REVIEW', 'SCRIPT', ?, ?, ?)`)
    .run(projectId, JSON.stringify({ targetDurationSec: 100, budget: { mode: options.mode ?? "BALANCED" } }), profileId, clockIso(), clockIso());
  const level = options.level ?? "autonomous";
  const settings = AutonomySettingsSchema.parse({ level, grants: AUTONOMY_PRESETS[level], ...(options.repair ? { repair: options.repair } : {}) });
  saveAutonomySettings(sqlite, settings);
  saveAutonomySettings(sqlite, settings, profileId);
  const calls: string[] = [];
  const ctx = {
    sqlite,
    config: {},
    usage: new UsageService(sqlite, 26_000),
    projects: { getProject: async () => ({ id: projectId, profileId, topic: "lịch sử" }) },
    orchestrator: {
      approveGate: () => { calls.push("approve"); return { ok: true }; },
      runStage: (_id: string, stage: string) => { calls.push(`run:${stage}`); },
      runStageThenContinue: (_id: string, stage: string) => { calls.push(`cont:${stage}`); },
    },
    gated: true,
  } as never;
  return { sqlite, ctx, calls, clock };
}

function script(sqlite: import("better-sqlite3").Database, score: number | null, blocking = 0, round = 0, clockIso: () => string = now) {
  sqlite.prepare("DELETE FROM scripts WHERE project_id = ?").run(projectId);
  sqlite.prepare(`INSERT INTO scripts (project_id, data, origin, edited, input_hash, version, provider, model, updated_at, quality_score, blocking_facts, revise_round)
    VALUES (?, '{}', 'AGENT', 0, 'h', 1, 'mock', 'mock', ?, ?, ?, ?)`).run(projectId, clockIso(), score, blocking, round);
}

function render(sqlite: import("better-sqlite3").Database, file: string, duration: number, report: Record<string, unknown>) {
  sqlite.prepare("DELETE FROM renders").run();
  sqlite.prepare(`INSERT INTO renders (id, project_id, input_hash, status, output_path, duration_sec, size_bytes, width, height, report, created_at)
    VALUES (?, ?, 'h', 'DONE', ?, ?, 1, 160, 90, ?, ?)`).run("77777777-7777-4777-8777-777777777777", projectId, file, duration, JSON.stringify(report), now());
}

const GOOD = { maxVolumeDb: -10, subtitlesInSync: true };
const sceneA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const sceneB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function view(over: Partial<SceneView> & { sceneId: string }): SceneView {
  return {
    order: 0, startSec: 0, durationSec: 10, noVisual: false, owned: false, reason: null,
    hasPassingAlternative: false, selectedBy: "AGENT", candidateId: "c1", ...over,
  };
}

describe("diagnose", () => {
  it("maps each gate input to issues and action lists", () => {
    const { sqlite } = setup();
    script(sqlite, 5, 1, 0);
    const issues = diagnose(sqlite, projectId, "SCRIPT");
    expect(issues.map((issue) => issue.kind).sort()).toEqual(["script_facts", "script_score"]);
    expect(issues.find((issue) => issue.kind === "script_facts")!.actions).toContain("rerun_research_then_script");
    expect(issues.find((issue) => issue.kind === "script_score")!.actions).not.toContain("rerun_research_then_script");
    script(sqlite, 9, 0, 0);
    expect(diagnose(sqlite, projectId, "SCRIPT")).toEqual([]);

    const risky = { repairSceneView: () => [view({ sceneId: sceneA, reason: "source_risk" }), view({ sceneId: sceneB, reason: "vision_missing", hasPassingAlternative: true })], repairWebAllowed: () => false };
    const scenes = diagnose(sqlite, projectId, "VISUALS", risky);
    const sourceRisk = scenes.find((issue) => issue.kind === "scene_source_risk")!;
    expect(sourceRisk.actions).not.toContain("pick_next_candidate");
    expect(sourceRisk.actions).not.toContain("web_search_scene");
    expect(sourceRisk.actions).toContain("switch_shot_type");
    const missing = scenes.find((issue) => issue.kind === "scene_vision_missing")!;
    expect(missing.actions[0]).toBe("vision_recheck");
    expect(missing.actions).toContain("pick_next_candidate");
    const owned = { repairSceneView: () => [view({ sceneId: sceneA, reason: "vision_reject", owned: true })], repairWebAllowed: () => true };
    expect(diagnose(sqlite, projectId, "VISUALS", owned)).toEqual([]);
  });

  it("TASK-141 P2: continuity findings map to scene repair actions only for color_jump and motif_missing", () => {
    const { sqlite } = setup();
    const finding = (code: "color_jump" | "motif_missing" | "pacing" | "character_mismatch", sceneIds: string[]) =>
      ({ code, sceneIds, message: "m", suggestedFix: "f" });
    const withAlt = { repairSceneView: () => [view({ sceneId: sceneA }), view({ sceneId: sceneB, hasPassingAlternative: true })], repairWebAllowed: () => false };
    const color = diagnose(sqlite, projectId, "VISUALS", withAlt, { continuityFindings: [finding("color_jump", [sceneA, sceneB])] });
    // Hành động đi tới cảnh sau của cặp (sceneIds[1]) và chỉ có pick_next_candidate.
    expect(color).toEqual([expect.objectContaining({ kind: "continuity_color", sceneIds: [sceneB], actions: ["pick_next_candidate"] })]);

    const noAlt = { repairSceneView: () => [view({ sceneId: sceneA }), view({ sceneId: sceneB })], repairWebAllowed: () => false };
    expect(diagnose(sqlite, projectId, "VISUALS", noAlt, { continuityFindings: [finding("color_jump", [sceneA, sceneB])] })).toEqual([]);

    const motif = diagnose(sqlite, projectId, "VISUALS", withAlt, { continuityFindings: [finding("motif_missing", [sceneA])] });
    expect(motif).toEqual([expect.objectContaining({ kind: "continuity_motif", sceneIds: [sceneA], actions: ["research_scene"] })]);

    const owned = { repairSceneView: () => [view({ sceneId: sceneB, owned: true, hasPassingAlternative: true })], repairWebAllowed: () => false };
    expect(diagnose(sqlite, projectId, "VISUALS", owned, { continuityFindings: [finding("color_jump", [sceneA, sceneB])] })).toEqual([]);

    expect(diagnose(sqlite, projectId, "VISUALS", withAlt, { continuityFindings: [finding("pacing", [sceneA]), finding("character_mismatch", [sceneA])] })).toEqual([]);
    expect(diagnose(sqlite, projectId, "VISUALS", withAlt, { continuityFindings: [] })).toEqual([]);
  });

  it("TASK-141 P2: a continuity colour repair ends when its only action is tried", () => {
    expect(nextLadderAction("continuity_color", repairActionsFor("continuity_color", { hasPassingCandidate: true }), ["pick_next_candidate"])).toBeNull();
    expect(nextLadderAction("continuity_motif", repairActionsFor("continuity_motif", { hasPassingCandidate: false }), ["research_scene"])).toBeNull();
  });

  it("maps render failures and freeze times to scenes", () => {
    const { sqlite } = setup();
    const file = join(roots[0]!, "v.mp4");
    writeFileSync(file, "x");
    const visuals = { repairSceneView: () => [view({ sceneId: sceneA, startSec: 0, durationSec: 10 }), view({ sceneId: sceneB, startSec: 10, durationSec: 10, hasPassingAlternative: true })], repairWebAllowed: () => false };
    render(sqlite, file, 100, { ...GOOD, freezeSegments: 1, freezeAtSec: [12] });
    const freeze = diagnose(sqlite, projectId, "RENDER", visuals)[0]!;
    expect(freeze.kind).toBe("freeze");
    expect(freeze.sceneIds).toEqual([sceneB]);
    render(sqlite, file, 100, { maxVolumeDb: -80, subtitlesInSync: false });
    expect(diagnose(sqlite, projectId, "RENDER", visuals).map((issue) => issue.kind).sort()).toEqual(["audio_silent", "subtitle_sync"]);
    render(sqlite, file, 150, GOOD);
    expect(diagnose(sqlite, projectId, "RENDER", visuals)[0]!.kind).toBe("duration_long");
    render(sqlite, join(roots[0]!, "gone.mp4"), 100, GOOD);
    expect(diagnose(sqlite, projectId, "RENDER", visuals)[0]!.kind).toBe("file_missing");
  });
});

describe("script repair", () => {
  it("revises, then uses the stronger model, then passes without a user request", async () => {
    const { sqlite, ctx, calls } = setup();
    script(sqlite, 5);
    const seen: unknown[] = [];
    hooks.script = async (args) => { seen.push(args); return { ok: true }; };
    const run = () => ASSISTANT_TOOLS.approve_gate.execute({ projectId, gate: "SCRIPT" }, ctx);
    expect(await run()).toMatchObject({ held: false, waiting: "repair", attempt: 1 });
    script(sqlite, 6);
    expect(await run()).toMatchObject({ waiting: "repair", attempt: 2 });
    script(sqlite, 8);
    await run();
    expect(calls).toContain("approve");
    expect(seen.map((item) => (item as { action: string }).action)).toEqual(["revise_script", "revise_script_stronger_model"]);
    const log = listRepairLog(sqlite, projectId);
    expect(log.rows.map((row) => row.outcome)).toEqual(["failed", "passed"]);
    expect(log.rows.every((row) => row.chosenBy === "ladder")).toBe(true);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM operator_requests").get()).toEqual({ n: 0 });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM operator_tool_audit WHERE tool = 'repair_script' AND origin = 'supervisor'").get()).toEqual({ n: 2 });
  });

  it("TASK-141 P2: a continuity colour fix runs once per window, then the VISUALS gate passes instead of shelving", async () => {
    const { sqlite, ctx } = setup();
    const calls: Array<Record<string, unknown>> = [];
    hooks.scene = async (args) => { calls.push(args as Record<string, unknown>); return {}; };
    const visuals = {
      repairSceneView: () => [view({ sceneId: sceneA }), view({ sceneId: sceneB, hasPassingAlternative: true })],
      repairWebAllowed: () => false,
      repairContinuityFindings: async () => [{ code: "color_jump" as const, sceneIds: [sceneA, sceneB], message: "m", suggestedFix: "f" }],
    };
    const env: RepairEnv = { ctx, visuals };
    expect((await repairStep(env, projectId, "VISUALS")).status).toBe("repairing");
    expect(calls).toEqual([expect.objectContaining({ action: "pick_next_candidate", sceneIds: [sceneB] })]);
    // Vòng sau: finding vẫn còn nhưng loại này đã thử trong cửa sổ, nên cổng qua; không gọi thêm và không shelve.
    expect(await repairStep(env, projectId, "VISUALS")).toEqual({ status: "passed" });
    expect(calls).toHaveLength(1);
    expect(sqlite.prepare("SELECT status FROM projects WHERE id = ?").get(projectId)).not.toEqual({ status: "SHELVED" });
  });

  it("TASK-141 P2: a missing motif walks its ladder (research_scene, then pick_next_candidate) before the gate passes", async () => {
    const { ctx } = setup();
    const calls: Array<Record<string, unknown>> = [];
    hooks.scene = async (args) => { calls.push(args as Record<string, unknown>); return {}; };
    const visuals = {
      repairSceneView: () => [view({ sceneId: sceneA, hasPassingAlternative: true })],
      repairWebAllowed: () => false,
      repairContinuityFindings: async () => [{ code: "motif_missing" as const, sceneIds: [sceneA], message: "m", suggestedFix: "f" }],
    };
    const env: RepairEnv = { ctx, visuals };
    expect((await repairStep(env, projectId, "VISUALS")).status).toBe("repairing");
    expect(calls.map((c) => c.action)).toEqual(["research_scene"]);
    expect((await repairStep(env, projectId, "VISUALS")).status).toBe("repairing");
    expect(calls.map((c) => c.action)).toEqual(["research_scene", "pick_next_candidate"]);
    // Cả hai bậc đã thử trong cửa sổ: cổng qua, không exhausted.
    expect(await repairStep(env, projectId, "VISUALS")).toEqual({ status: "passed" });
    expect(calls).toHaveLength(2);
  });

  it("TASK-141 P2: with two colour jumps, one window attempt runs (the loop guard stops a repeat on the same gate input); the second pair is not retried and the gate passes", async () => {
    const { ctx } = setup();
    const calls: Array<Record<string, unknown>> = [];
    hooks.scene = async (args) => { calls.push(args as Record<string, unknown>); return {}; };
    const visuals = {
      repairSceneView: () => [
        view({ sceneId: sceneA }), view({ sceneId: sceneB, hasPassingAlternative: true }),
        view({ sceneId: "scene-c" }), view({ sceneId: "scene-d", hasPassingAlternative: true }),
      ],
      repairWebAllowed: () => false,
      repairContinuityFindings: async () => [
        { code: "color_jump" as const, sceneIds: [sceneA, sceneB], message: "m", suggestedFix: "f" },
        { code: "color_jump" as const, sceneIds: ["scene-c", "scene-d"], message: "m", suggestedFix: "f" },
      ],
    };
    const env: RepairEnv = { ctx, visuals };
    expect((await repairStep(env, projectId, "VISUALS")).status).toBe("repairing");
    expect(calls.map((c) => c.sceneIds)).toEqual([[sceneB]]);
    expect(await repairStep(env, projectId, "VISUALS")).toEqual({ status: "passed" });
    expect(calls).toHaveLength(1);
  });

  async function exerciseShelveAt(clock: () => Date) {
    const clockIso = () => clock().toISOString();
    const { sqlite, ctx } = setup({
      repair: { maxAttemptsPerProject: 2, maxRendersPerProject: 2, maxUsdPerProject: null, onExhausted: "shelve" },
      clock,
    });
    sqlite.prepare(`INSERT INTO profile_topics (id, profile_id, topic, source, status, priority, project_id, created_at, updated_at)
      VALUES ('t1', ?, 'lịch sử', 'USER', 'IN_PRODUCTION', 5, ?, ?, ?)`).run(profileId, projectId, clockIso(), clockIso());
    script(sqlite, 5, 0, 0, clockIso);
    hooks.script = async () => ({});
    const env: RepairEnv = { ctx, now: clock };
    expect((await repairStep(env, projectId, "SCRIPT")).status).toBe("repairing");
    expect((await repairStep(env, projectId, "SCRIPT")).status).toBe("repairing");
    const last = await repairStep(env, projectId, "SCRIPT");
    expect(last).toMatchObject({ status: "exhausted", handled: "shelved" });
    expect(sqlite.prepare("SELECT status FROM projects WHERE id = ?").get(projectId)).toEqual({ status: "SHELVED" });
    expect(sqlite.prepare("SELECT status, project_id, notes FROM profile_topics WHERE id = 't1'").get())
      .toMatchObject({ status: "APPROVED", project_id: null });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM operator_requests").get()).toEqual({ n: 0 });
    const digest = buildDigest(sqlite, clock) as { shelved: string[] };
    expect(digest.shelved[0]).toMatch(/Đã gác video «Video thử»/);
    expect(reopenShelved(sqlite, projectId, clock()).status).toBe("REVIEW");
    expect(listRepairLog(sqlite, projectId).attempts).toBe(0);
  }

  it("shelves the project when the budget runs out", async () => {
    await exerciseShelveAt(() => new Date("2026-11-13T12:00:00.000Z"));
  });

  it("TASK-131: passes shelve test at 23:59:59Z across UTC midnight", async () => {
    await exerciseShelveAt(() => new Date("2026-11-13T23:59:59.000Z"));
  });

  it("TASK-131: passes shelve test at 00:00:01Z across UTC midnight", async () => {
    await exerciseShelveAt(() => new Date("2026-11-14T00:00:01.000Z"));
  });

  it("asks the user when onExhausted is ask and lists what was tried", async () => {
    const { sqlite, ctx } = setup({ level: "supervised", repair: { maxAttemptsPerProject: 1, maxRendersPerProject: 2, maxUsdPerProject: null, onExhausted: "ask" } });
    script(sqlite, 5);
    await repairStep({ ctx }, projectId, "SCRIPT");
    const result = await repairStep({ ctx }, projectId, "SCRIPT");
    expect(result).toMatchObject({ status: "exhausted", handled: "asked" });
    const request = sqlite.prepare("SELECT why_vi AS why FROM operator_requests WHERE dedupe_key = ?").get(`script-gate:${projectId}`) as { why: string };
    expect(request.why).toContain("revise_script");
  });

  it("TASK-129a: announces repair_exhausted once per exhaustion, not on each repeated call", async () => {
    const { sqlite, ctx } = setup({ level: "supervised", repair: { maxAttemptsPerProject: 1, maxRendersPerProject: 2, maxUsdPerProject: null, onExhausted: "ask" } });
    script(sqlite, 5);
    const startedCount = () => listAgentEvents({ types: ["repair_started"] }).filter((e) => e.projectId === projectId).length;
    const startedBefore = startedCount();
    expect((await runQualityRepair({ ctx }, projectId, "SCRIPT")).status).toBe("repairing");
    expect(startedCount() - startedBefore).toBe(1);
    const before = listAgentEvents({ types: ["repair_exhausted"] }).length;
    expect((await runQualityRepair({ ctx }, projectId, "SCRIPT")).status).toBe("exhausted");
    expect((await runQualityRepair({ ctx }, projectId, "SCRIPT")).status).toBe("exhausted");
    const events = listAgentEvents({ types: ["repair_exhausted"] });
    expect(events.length - before).toBe(1);
    expect(events.at(-1)).toMatchObject({ projectId, stage: "SCRIPT" });
    // repair_started stays at one for the episode: the exhausted calls start nothing new.
    expect(startedCount() - startedBefore).toBe(1);
  });

  it("falls back to the ladder when the agent picks an action outside the list, and logs it", async () => {
    const { sqlite, ctx } = setup();
    script(sqlite, 5);
    const env: RepairEnv = { ctx, chooser: async () => ({ choices: [{ issueIndex: 0, action: "rerender" }] }) };
    await repairStep(env, projectId, "SCRIPT");
    const row = sqlite.prepare("SELECT chosen_by, action, gate_before FROM quality_repairs").get() as { chosen_by: string; action: string; gate_before: string };
    expect(row).toMatchObject({ chosen_by: "ladder", action: "revise_script" });
    expect(JSON.parse(row.gate_before).rejectedChoice).toBe("rerender");
  });

  it("uses the agent's valid pick, and never calls it in ECO", async () => {
    const a = setup();
    script(a.sqlite, 5);
    await repairStep({ ctx: a.ctx, chooser: async () => ({ choices: [{ issueIndex: 0, action: "new_angle" }] }) }, projectId, "SCRIPT");
    expect(a.sqlite.prepare("SELECT chosen_by, action FROM quality_repairs").get()).toEqual({ chosen_by: "agent", action: "new_angle" });
    const b = setup({ mode: "ECO" });
    script(b.sqlite, 5);
    const chooser = vi.fn(async () => ({ choices: [] }));
    await repairStep({ ctx: b.ctx, chooser }, projectId, "SCRIPT");
    expect(chooser).not.toHaveBeenCalled();
  });

  it("stops when the same action repeats with unchanged gate input", async () => {
    const { sqlite, ctx } = setup();
    script(sqlite, 5);
    const chooser = async () => ({ choices: [{ issueIndex: 0, action: "revise_script" as const }] });
    expect((await repairStep({ ctx, chooser }, projectId, "SCRIPT")).status).toBe("repairing");
    expect((await repairStep({ ctx, chooser }, projectId, "SCRIPT")).status).toBe("exhausted");
  });
});

describe("scene and render repair", () => {
  it("hands exhausted visual repairs to the stage service before asking or shelving", async () => {
    const { sqlite, ctx } = setup({ repair: { maxAttemptsPerProject: 1, maxRendersPerProject: 2, maxUsdPerProject: null, onExhausted: "ask" } });
    const handoffAfterRepair = vi.fn(() => ({ id: "rescue-job" }));
    Object.assign(ctx, { agentStages: { handoffAfterRepair } });
    hooks.scene = async () => ({});
    const visuals = { repairSceneView: () => [view({ sceneId: sceneA, reason: "no_candidate", candidateId: null })], repairWebAllowed: () => false };
    const result = await runQualityRepair({ ctx, visuals }, projectId, "VISUALS");
    expect(result).toMatchObject({ status: "exhausted", handled: "agent" });
    expect(handoffAfterRepair).toHaveBeenCalledWith(projectId, expect.any(String));
    expect((sqlite.prepare("SELECT status FROM projects WHERE id=?").get(projectId) as { status: string }).status).not.toBe("SHELVED");
    expect(sqlite.prepare("SELECT 1 FROM operator_requests WHERE dedupe_key=?").get(`visual-gate:${projectId}`)).toBeUndefined();
  });
  it("repairs scenes in one call, never touching user-owned scenes", async () => {
    const { sqlite, ctx } = setup();
    const state: Record<string, SceneView> = {
      [sceneA]: view({ sceneId: sceneA, reason: "vision_reject", hasPassingAlternative: true }),
      [sceneB]: view({ sceneId: sceneB, reason: "vision_reject", owned: true }),
    };
    const touched: string[] = [];
    hooks.scene = async (args) => {
      const { sceneIds, action } = args as { sceneIds: string[]; action: string };
      for (const id of sceneIds) {
        touched.push(`${id}:${action}`);
        if (action === "pick_next_candidate") state[id] = { ...state[id]!, reason: null };
      }
      return {};
    };
    const visuals = { repairSceneView: () => Object.values(state), repairWebAllowed: () => false };
    const result = await runQualityRepair({ ctx, visuals }, projectId, "VISUALS");
    expect(result.status).toBe("passed");
    expect(touched).toEqual([`${sceneA}:pick_next_candidate`]);
  });

  it("walks research then shot switch when no candidate passes", async () => {
    const { sqlite, ctx } = setup();
    let reason: string | null = "vision_reject";
    const actions: string[] = [];
    hooks.scene = async (args) => {
      const { action } = args as { action: string };
      actions.push(action);
      if (action === "switch_shot_type") reason = null;
      return {};
    };
    const visuals = { repairSceneView: () => [view({ sceneId: sceneA, reason })], repairWebAllowed: () => false };
    const result = await runQualityRepair({ ctx, visuals }, projectId, "VISUALS");
    expect(result.status).toBe("passed");
    expect(actions).toEqual(["research_scene", "rephrase_scene_visual", "switch_shot_type"]);
    void sqlite;
  });

  it("re-runs SUBTITLE for a sync failure, maps freeze to a scene, and respects the render cap", async () => {
    const { sqlite, ctx } = setup({ repair: { maxAttemptsPerProject: 6, maxRendersPerProject: 2, maxUsdPerProject: null, onExhausted: "shelve" } });
    const file = join(roots[0]!, "v.mp4");
    writeFileSync(file, "x");
    const stages: string[] = [];
    hooks.stage = async (args) => { stages.push((args as { action: string }).action); return {}; };
    const scenes: unknown[] = [];
    hooks.scene = async (args) => { scenes.push(args); return {}; };
    const visuals = { repairSceneView: () => [view({ sceneId: sceneA, startSec: 0, durationSec: 20, hasPassingAlternative: true })], repairWebAllowed: () => false };
    render(sqlite, file, 100, { maxVolumeDb: -10, subtitlesInSync: false });
    expect((await repairStep({ ctx, visuals }, projectId, "RENDER")).status).toBe("repairing");
    expect(stages).toEqual(["rerun_subtitle"]);
    render(sqlite, file, 100, { ...GOOD, freezeSegments: 1, freezeAtSec: [12] });
    expect((await repairStep({ ctx, visuals }, projectId, "RENDER")).status).toBe("repairing");
    expect(scenes[0]).toMatchObject({ sceneIds: [sceneA], action: "pick_next_candidate", thenTimeline: true });
    // two renders used: a third round is refused and the project is shelved
    const third = await repairStep({ ctx, visuals }, projectId, "RENDER");
    expect(third).toMatchObject({ status: "exhausted", handled: "shelved" });
    expect(stages).toHaveLength(1);
  });

  it("respects maxRendersPerDay", async () => {
    const { sqlite, ctx } = setup();
    sqlite.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES ('autonomy.budget', ?, ?)").run(JSON.stringify({ maxRendersPerDay: 1 }), now());
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());
    sqlite.prepare("INSERT INTO autonomy_job_claims (day, stage, profile_id, account_id) VALUES (?, 'RENDER', ?, NULL)").run(day, profileId);
    const file = join(roots[0]!, "v.mp4");
    writeFileSync(file, "x");
    render(sqlite, file, 100, { maxVolumeDb: -10, subtitlesInSync: false });
    const visuals = { repairSceneView: () => [], repairWebAllowed: () => false };
    expect(await repairStep({ ctx, visuals }, projectId, "RENDER")).toMatchObject({ status: "exhausted" });
  });
});

describe("safety", () => {
  it("does nothing for assist level and refuses the protected project", async () => {
    const { sqlite, ctx } = setup({ level: "assist" });
    script(sqlite, 5);
    expect(await repairStep({ ctx }, projectId, "SCRIPT")).toEqual({ status: "off" });
    const auto = setup();
    expect(await repairStep({ ctx: auto.ctx }, PROTECTED_PROJECT_ID, "SCRIPT")).toEqual({ status: "off" });
  });

  it("opens the breaker after 3 shelved projects with the same issue kind", async () => {
    const { sqlite, ctx } = setup({ repair: { maxAttemptsPerProject: 0, maxRendersPerProject: 2, maxUsdPerProject: null, onExhausted: "shelve" } });
    for (let index = 0; index < 3; index += 1) {
      const id = `4444444${index}-4444-4444-8444-444444444444`;
      sqlite.prepare(`INSERT INTO projects (id, title, topic, mode, settings, status, stage, profile_id, created_at, updated_at)
        VALUES (?, 'P', 't', 'ASSISTED', '{}', 'REVIEW', 'SCRIPT', ?, ?, ?)`).run(id, profileId, now(), now());
      sqlite.prepare(`INSERT INTO scripts (project_id, data, origin, edited, input_hash, version, provider, model, updated_at, quality_score, blocking_facts, revise_round)
        VALUES (?, '{}', 'AGENT', 0, 'h', 1, 'mock', 'mock', ?, 3, 0, 0)`).run(id, now());
      const result = await repairStep({ ctx }, id, "SCRIPT");
      expect(result.status).toBe("exhausted");
      if (index === 2) expect(result).toMatchObject({ handled: "breaker" });
    }
    expect(sqlite.prepare("SELECT kind FROM supervisor_findings WHERE kind = 'breaker_open'").get()).toEqual({ kind: "breaker_open" });
  });

  it("blocks tool args that touch repair settings", () => {
    expect(hardBlockMessage("update_llm_settings", { repair: { maxAttemptsPerProject: 99 } })).toBeTruthy();
    expect(hardBlockMessage("repair_script", { projectId: PROTECTED_PROJECT_ID })).toBeTruthy();
  });

  it("computes stats per issue and action", async () => {
    const { sqlite, ctx } = setup();
    script(sqlite, 5);
    await repairStep({ ctx }, projectId, "SCRIPT");
    script(sqlite, 9);
    await repairStep({ ctx }, projectId, "SCRIPT");
    expect(repairStats(sqlite, profileId).byIssue.script_score?.revise_script).toEqual({ tries: 1, passed: 1 });
  });
});
