import { afterEach, describe, expect, it, vi } from "vitest";
import { createPipelineHarness } from "./pipelineFixtures.js";
import { ProjectRunService } from "../src/node/runService.js";
import { RunCheckpointService } from "../src/node/runCheckpoint.js";
import { NodeService } from "../src/node/nodeService.js";
import { readAppVersion } from "../src/render/appVersion.js";
import { applyProjectSnapshotDelta, exportProjectSnapshot, importProjectSnapshot, projectSnapshotCursor, type ProjectSnapshotDelta } from "../src/node/projectSnapshot.js";
import { StageInputVersions } from "../src/pipeline/inputVersion.js";
import { AppError } from "../src/lib/errors.js";

const fixtures: ReturnType<typeof createPipelineHarness>[] = [];
afterEach(() => fixtures.splice(0).forEach((h) => h.close()));
function setup() {
  const h = createPipelineHarness(); fixtures.push(h);
  h.sqlite.prepare("UPDATE projects SET workspace_id='A' WHERE id=?").run(h.projectId);
  h.repository.ensureStages(h.projectId);
  const nodes = new NodeService(h.sqlite, h.config, h.repository, h.orchestrator, h.clock);
  const joined = nodes.join({ joinToken: nodes.createJoinToken({ workspaceId: "A" }).token, name: "node", version: readAppVersion(), capabilities: ["render"], resources: {} });
  const node = nodes.authenticate(joined.nodeToken)!;
  const runs = new ProjectRunService(h.sqlite, h.orchestrator, h.clock);
  const run = runs.grant(node, { projectId: h.projectId, fromStage: "RESEARCH", stopBefore: ["VISUAL_REVIEW"], budgetCapUsd: 1 });
  const after = vi.fn(() => {
    expect(h.sqlite.inTransaction).toBe(false);
    expect(h.sqlite.prepare("SELECT last_seq AS seq FROM project_runs WHERE id=?").get(run.id)).toEqual({ seq: 1 });
  });
  const checkpoints = new RunCheckpointService(h.sqlite, runs, h.orchestrator, h.config.DATA_DIR, () => { throw new Error("unexpected file"); }, after, h.clock);
  const body = { leaseId: run.leaseId, seq: 1, stage: "RESEARCH" as const,
    inputVersion: h.orchestrator.inputVersions.inputVersion(h.projectId, "RESEARCH"),
    tables: { research_notes: [{ project_id: h.projectId, input_hash: "hash", provider: "mock", model: "mock", cached: 0, created_at: h.clock().toISOString(), data: "{}" }] },
    costs: [{ kind: "llm" as const, amountUsd: 0.05, provider: "mock" }], summary: "Research ready" };
  return { ...h, runs, run, node, checkpoints, after, body };
}

describe("fenced project checkpoints", () => {
  it("preserves downstream rows when the checkpoint retains the parent scene", () => {
    const h = setup(), at = h.clock().toISOString();
    h.repository.updateStage(h.projectId, "SCRIPT", { state: "DONE" });
    // A node sends the SCRIPT_REVIEW gate as its own checkpoint before SCENE_PLAN, so control holds it DONE here.
    h.repository.updateStage(h.projectId, "SCRIPT_REVIEW", { state: "DONE" });
    h.sqlite.prepare(`INSERT INTO scenes(id,project_id,"order",kind,label,narration,visual_notes,visual_queries,music_mood,energy,est_duration_sec,start_sec,transition_note,input_hash,origin,created_at,updated_at)
      VALUES ('scene',?,0,'content','Scene','old','','{}','neutral','low',3,0,'','hash','AGENT',?,?)`).run(h.projectId, at, at);
    h.sqlite.prepare("INSERT INTO visual_search_state(scene_id,project_id,search_hash,updated_at) VALUES ('scene',?,'old',?)").run(h.projectId, at);
    const scene = h.sqlite.prepare("SELECT * FROM scenes WHERE id='scene'").get() as Record<string, unknown>;
    h.checkpoints.apply(h.node, h.run.id, { leaseId: h.run.leaseId, seq: 1, stage: "SCENE_PLAN",
      inputVersion: h.orchestrator.inputVersions.inputVersion(h.projectId, "SCENE_PLAN"),
      tables: { scenes: [{ ...scene, narration: "new" }] }, costs: [] });
    expect(h.sqlite.prepare("SELECT narration FROM scenes WHERE id='scene'").get()).toEqual({ narration: "new" });
    expect(h.sqlite.prepare("SELECT search_hash FROM visual_search_state WHERE scene_id='scene'").get()).toEqual({ search_hash: "old" });
  });

  it("a SCENE_PLAN checkpoint waits while control still holds the script review gate pending", () => {
    const h = setup();
    h.repository.updateStage(h.projectId, "SCRIPT", { state: "DONE" });
    expect(() => h.checkpoints.apply(h.node, h.run.id, { leaseId: h.run.leaseId, seq: 1, stage: "SCENE_PLAN",
      inputVersion: h.orchestrator.inputVersions.inputVersion(h.projectId, "SCENE_PLAN"), tables: { scenes: [] }, costs: [] }))
      .toThrowError(expect.objectContaining({ code: "RUN_DEPENDENCY_PENDING" }));
    expect(h.repository.getStage(h.projectId, "SCRIPT_REVIEW").state).toBe("PENDING");
  });

  it("a run granted from the script review gate accepts the gate checkpoint, then SCENE_PLAN", () => {
    const h = setup();
    h.repository.updateStage(h.projectId, "SCRIPT", { state: "DONE" });
    // The planner starts at the earliest unfinished stage, so an off gate that is PENDING is the grant's first stage.
    h.runs.cancel(h.projectId, "USER_CANCELLED");
    const gateRun = h.runs.grant(h.node, { projectId: h.projectId, fromStage: "SCRIPT_REVIEW", stopBefore: ["VISUAL_REVIEW"], budgetCapUsd: 1 });
    // No commit assertion here: the setup's afterCommit expects seq 1 only, and this test commits two checkpoints.
    const checkpoints = new RunCheckpointService(h.sqlite, h.runs, h.orchestrator, h.config.DATA_DIR, () => { throw new Error("unexpected file"); }, () => undefined, h.clock);
    expect(checkpoints.apply(h.node, gateRun.id, { leaseId: gateRun.leaseId, seq: 1, stage: "SCRIPT_REVIEW",
      inputVersion: h.orchestrator.inputVersions.inputVersion(h.projectId, "SCRIPT_REVIEW"), tables: {}, costs: [] })).toEqual({ ok: true, seq: 1, duplicate: false });
    expect(h.repository.getStage(h.projectId, "SCRIPT_REVIEW").state).toBe("DONE");
    expect(checkpoints.apply(h.node, gateRun.id, { leaseId: gateRun.leaseId, seq: 2, stage: "SCENE_PLAN",
      inputVersion: h.orchestrator.inputVersions.inputVersion(h.projectId, "SCENE_PLAN"), tables: { scenes: [] }, costs: [] })).toEqual({ ok: true, seq: 2, duplicate: false });
  });

  it("applies once, publishes after commit and adds costs to the ledger once", () => {
    const h = setup();
    h.repository.updateStage(h.projectId, "SCRIPT", { state: "DONE", inputVersion: "a".repeat(64) });
    expect(h.checkpoints.apply(h.node, h.run.id, h.body)).toEqual({ ok: true, seq: 1, duplicate: false });
    expect(h.checkpoints.apply(h.node, h.run.id, h.body)).toEqual({ ok: true, seq: 1, duplicate: true });
    expect(h.after).toHaveBeenCalledTimes(1);
    expect(h.repository.getStage(h.projectId, "RESEARCH")).toMatchObject({ state: "DONE", inputVersion: h.body.inputVersion });
    expect(h.repository.getStage(h.projectId, "SCRIPT").state).toBe("STALE");
    expect(h.sqlite.prepare("SELECT input_version AS version FROM project_stages WHERE project_id=? AND stage='SCRIPT'").get(h.projectId)).toEqual({ version: null });
    expect(h.sqlite.prepare("SELECT COUNT(*) AS n,SUM(amount) AS total FROM cost_entries").get()).toEqual({ n: 1, total: 0.05 });
    expect(() => h.checkpoints.apply(h.node, h.run.id, { ...h.body, summary: "changed" })).toThrowError(expect.objectContaining({ code: "RUN_SEQUENCE_CONFLICT" }));
  });

  it("rejects gaps, wrong leases, foreign rows and control tables without changing state", () => {
    const h = setup();
    expect(() => h.checkpoints.apply(h.node, h.run.id, { ...h.body, seq: 2 })).toThrowError(expect.objectContaining({ code: "RUN_SEQUENCE_GAP" }));
    expect(() => h.checkpoints.apply(h.node, h.run.id, { ...h.body, leaseId: "old" })).toThrowError(expect.objectContaining({ code: "LEASE_STALE" }));
    expect(() => h.checkpoints.apply(h.node, h.run.id, { ...h.body, tables: { jobs: [] } })).toThrowError(expect.objectContaining({ code: "RUN_TABLE_INVALID" }));
    const foreign = structuredClone(h.body); foreign.tables.research_notes[0]!.project_id = "foreign";
    expect(() => h.checkpoints.apply(h.node, h.run.id, foreign)).toThrowError(expect.objectContaining({ code: "RUN_PROJECT_INVALID" }));
    expect(h.runs.get(h.run.id)?.lastSeq).toBe(0);
    expect(h.sqlite.prepare("SELECT COUNT(*) AS n FROM research_notes").get()).toEqual({ n: 0 });
    expect(h.sqlite.prepare("SELECT COUNT(*) AS n FROM cost_entries").get()).toEqual({ n: 0 });
    expect(h.after).not.toHaveBeenCalled();
  });

  it("returns a rebase snapshot after a control edit and accepts the recomputed version", () => {
    const h = setup();
    const runner = createPipelineHarness(); fixtures.push(runner); runner.sqlite.prepare("DELETE FROM projects").run();
    const base = exportProjectSnapshot(h.sqlite, h.config.DATA_DIR, h.projectId);
    h.sqlite.prepare("UPDATE projects SET topic='New topic' WHERE id=?").run(h.projectId);
    try { h.checkpoints.apply(h.node, h.run.id, { ...h.body, snapshotCursor: projectSnapshotCursor(base) }); throw new Error("expected rebase"); }
    catch (error) {
      expect(error).toMatchObject({ code: "RUN_REBASE", details: { delta: { projectId: h.projectId, snapshotVersion: 1 } } });
      const { delta } = (error as AppError).details as { delta: ProjectSnapshotDelta };
      expect(Object.keys(delta.tables)).toEqual(["projects"]);
      expect(delta.files).toBeUndefined();
      importProjectSnapshot(runner.sqlite, applyProjectSnapshotDelta(base, delta), () => { throw new Error("no files"); });
    }
    expect(h.runs.get(h.run.id)?.lastSeq).toBe(0);
    const fresh = { ...h.body, inputVersion: new StageInputVersions(runner.sqlite, runner.config.DATA_DIR).inputVersion(h.projectId, "RESEARCH") };
    expect(h.checkpoints.apply(h.node, h.run.id, fresh).duplicate).toBe(false);
  });

  it("never accepts another checkpoint from a cancelled or expired run", () => {
    const h = setup(); h.advance(91_000); h.runs.expire();
    expect(() => h.checkpoints.apply(h.node, h.run.id, h.body)).toThrowError(expect.objectContaining({ code: "LEASE_STALE" }));
    expect(h.sqlite.prepare("SELECT COUNT(*) AS n FROM run_checkpoints").get()).toEqual({ n: 0 });
  });

  it("carries generated script settings while preserving user choices and other settings", () => {
    const h = setup();
    h.repository.updateStage(h.projectId, "RESEARCH", { state: "DONE" });
    const inputVersion = h.orchestrator.inputVersions.inputVersion(h.projectId, "SCRIPT");
    const body = { leaseId: h.run.leaseId, seq: 1, stage: "SCRIPT", inputVersion, tables: { scripts: [], script_drafts: [], video_metadata: [] }, costs: [], projectSettings: { format: "explainer", formatReason: "Generated choice" } };
    expect(h.checkpoints.apply(h.node, h.run.id, body).ok).toBe(true);
    expect(h.repository.getProject(h.projectId)!.settings).toMatchObject({ format: "explainer", formatReason: "Generated choice", language: "en" });
    expect(h.orchestrator.inputVersions.inputVersion(h.projectId, "SCRIPT")).toBe(inputVersion);
    const project = h.repository.getProject(h.projectId)!;
    h.repository.updateProject(h.projectId, { settings: { ...project.settings, userSet: ["format"] } });
    expect(() => h.checkpoints.apply(h.node, h.run.id, { ...body, seq: 2, inputVersion: h.orchestrator.inputVersions.inputVersion(h.projectId, "SCRIPT"), projectSettings: { format: "different" } }))
      .toThrowError(expect.objectContaining({ code: "RUN_PROJECT_PATCH_INVALID" }));
    expect(h.runs.get(h.run.id)?.lastSeq).toBe(1);
  });
});
