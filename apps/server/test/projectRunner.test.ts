import Fastify from "fastify";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { NodeService } from "../src/node/nodeService.js";
import { executeProjectSegment, openProjectRun, runProjectLease, WarmProjectRuns } from "../src/node/projectRunner.js";
import { exportProjectSnapshot, projectSnapshotCursor } from "../src/node/projectSnapshot.js";
import { RunCheckpointService } from "../src/node/runCheckpoint.js";
import { RunCommands } from "../src/node/runCommands.js";
import { createRunnerRuntime } from "../src/node/runnerRuntime.js";
import { createStockRunner } from "../src/node/stockRunner.js";
import { ProjectRunService } from "../src/node/runService.js";
import { readAppVersion } from "../src/render/appVersion.js";
import { createProjectDir } from "../src/storage/paths.js";
import { createPipelineHarness } from "./pipelineFixtures.js";
import { buildKnowledgeBlock } from "../src/retrieval/context.js";

it.each([false, true])("applies runner stage transitions exclusively through fenced checkpoints (failed=%s)", async (failScript) => {
  const control = createPipelineHarness();
  const runner = createPipelineHarness({ config: { FAKE_STAGE_DELAY_MS: 0 },
    failures: failScript ? { SCRIPT: "non_retryable" } : undefined });
  let opened: Awaited<ReturnType<typeof openProjectRun>> | undefined;
  try {
    const { projectId } = control;
    control.sqlite.prepare("UPDATE projects SET workspace_id='A', settings=json_set(settings,'$.researchMode','off','$.userSet',json('[\"researchMode\"]')) WHERE id=?").run(projectId);
    const nodes = new NodeService(control.sqlite, control.config, control.repository, control.orchestrator, control.clock);
    const joined = nodes.join({ joinToken: nodes.createJoinToken({ workspaceId: "A" }).token, name: "fixture",
      version: readAppVersion(), capabilities: ["render"], resources: {} });
    const node = nodes.authenticate(joined.nodeToken)!;
    const runs = new ProjectRunService(control.sqlite, control.orchestrator, control.clock);
    const run = runs.grant(node, { projectId, fromStage: "RESEARCH", stopBefore: ["VISUAL_REVIEW", "VOICE"], budgetCapUsd: 1 });
    const commands = new RunCommands(control.sqlite, runs, control.clock);
    const commandReader = new RunCommands(control.sqlite, runs, control.clock);
    const signal = new AbortController().signal;
    if (!failScript) {
      commands.enqueue(run.id, { kind: "budget", capUsd: 2 });
      commands.enqueue(run.id, { kind: "rebase" });
      expect(runs.get(run.id)?.budgetCapUsd).toBe(2);
      expect(await commandReader.poll(node, run.id, run.leaseId, 1, signal, 0)).toEqual([{ kind: "rebase", sequence: 2 }]);
      await expect(commandReader.poll(node, run.id, "wrong", 0, signal, 0)).rejects.toMatchObject({ code: "LEASE_STALE" });
    }
    const path = join(createProjectDir(control.config.DATA_DIR, projectId), "test.png");
    writeFileSync(path, "fixture artifact");
    control.sqlite.prepare("UPDATE projects SET thumbnail_path='test.png' WHERE id=?").run(projectId);
    const snapshot = exportProjectSnapshot(control.sqlite, control.config.DATA_DIR, projectId);
    const noFile = () => { throw new Error("fixture has no files"); };
    opened = await openProjectRun({ nodeDataDir: runner.config.DATA_DIR, run, snapshot,
      download: async () => path, signal });
    expect(exportProjectSnapshot(opened.sqlite, opened.dataDir, projectId)).toEqual(snapshot);
    const runtime = createRunnerRuntime({
      sqlite: opened.sqlite, config: { ...runner.config, DATA_DIR: opened.dataDir }, logger: Fastify().log, executors: runner.executors,
      projectId, stopBefore: run.stopBefore, canApprove: () => ({ allowed: true }), now: runner.clock,
    });
    const checkpoints = new RunCheckpointService(control.sqlite, runs, control.orchestrator, control.config.DATA_DIR, noFile, () => undefined, control.clock);
    const result = await executeProjectSegment({
      runtime, run, dataDir: opened.dataDir, cursor: projectSnapshotCursor(snapshot), signal,
      send: async (checkpoint) => { checkpoints.apply(node, run.id, checkpoint); }, now: runner.clock,
    });
    const checkpointStages = control.sqlite.prepare("SELECT stage FROM run_checkpoints WHERE run_id=? ORDER BY seq").all(run.id).map((row) => (row as { stage: string }).stage);
    // The off-mode SCRIPT_REVIEW pass is a real stage update on the node, so it crosses the fence as its own checkpoint.
    expect(checkpointStages).toEqual(failScript ? ["RESEARCH", "SCRIPT"] : ["RESEARCH", "SCRIPT", "SCRIPT_REVIEW", "SCENE_PLAN", "VISUAL_SEARCH"]);
    expect(result).toMatchObject({ lastSeq: failScript ? 2 : 5, reason: failScript ? "FAILED" : "BOUNDARY" });
    expect(control.repository.getStage(projectId, "RESEARCH").state).toBe("SKIPPED");
    expect(control.repository.getStage(projectId, "SCRIPT").state).toBe(failScript ? "FAILED" : "DONE");
    expect(control.repository.getStage(projectId, "VISUAL_REVIEW").state).toBe("PENDING");
    expect(control.repository.getStage(projectId, "VOICE").state).toBe("PENDING");
    expect(control.repository.getActiveJobs(projectId)).toEqual([]);
    expect(() => runs.finish(node, run.id, { leaseId: run.leaseId, lastSeq: result.lastSeq - 1, reason: "BOUNDARY" })).toThrow(/checkpoint/);
    const ended = runs.finish(node, run.id, { leaseId: run.leaseId, lastSeq: result.lastSeq, reason: failScript ? "FAILED" : "BOUNDARY" });
    expect(ended.status).toBe(failScript ? "FAILED" : "PAUSED_AT_GATE");
    expect(() => runs.heartbeat(node, run.id, run.leaseId)).toThrow(/hết hạn/);
    await expect(commandReader.poll(node, run.id, run.leaseId, 0, signal, 0)).rejects.toMatchObject({ code: "LEASE_STALE" });
  } finally {
    opened?.sqlite.close();
    runner.close();
    control.close();
  }
});

it("reopens an isolated runtime from a delta after control rejects a stale result", async () => {
  const control = createPipelineHarness();
  const runner = createPipelineHarness({ config: { FAKE_STAGE_DELAY_MS: 0 } });
  try {
    const { projectId } = control;
    control.sqlite.prepare("UPDATE projects SET workspace_id='A' WHERE id=?").run(projectId);
    const nodes = new NodeService(control.sqlite, control.config, control.repository, control.orchestrator, control.clock);
    const token = nodes.createJoinToken({ workspaceId: "A" }).token;
    const { nodeToken } = nodes.join({ joinToken: token, name: "fixture", version: readAppVersion(), capabilities: ["render"], resources: {} });
    const node = nodes.authenticate(nodeToken)!;
    const runs = new ProjectRunService(control.sqlite, control.orchestrator, control.clock);
    const run = runs.grant(node, { projectId, fromStage: "RESEARCH", stopBefore: ["SCRIPT"], budgetCapUsd: 1 });
    const noFile = () => { throw new Error("fixture has no files"); };
    const checkpoints = new RunCheckpointService(control.sqlite, runs, control.orchestrator, control.config.DATA_DIR, noFile, () => undefined, control.clock);
    const observedTopics: string[] = [];
    let attempts = 0;
    await runProjectLease({
      nodeDataDir: runner.config.DATA_DIR, run, signal: new AbortController().signal,
      buildRuntime(opened, stopBefore) {
        const runtime = createRunnerRuntime({
          sqlite: opened.sqlite, config: { ...runner.config, DATA_DIR: opened.dataDir }, logger: Fastify().log,
          executors: runner.executors, projectId, stopBefore, canApprove: () => ({ allowed: true }), now: runner.clock,
        });
        observedTopics.push(runtime.repository.getProject(projectId)!.topic);
        return runtime;
      },
      transport: {
        snapshot: async () => exportProjectSnapshot(control.sqlite, control.config.DATA_DIR, projectId),
        download: async () => noFile(),
        commands: async (_after, signal) => {
          if (!signal.aborted) await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
          return [];
        },
        checkpoint: async (checkpoint) => {
          if (attempts++ === 0) control.sqlite.prepare("UPDATE projects SET topic='Edited during execution' WHERE id=?").run(projectId);
          checkpoints.apply(node, run.id, checkpoint);
        },
        finish: async (reason, lastSeq) => { runs.finish(node, run.id, { leaseId: run.leaseId, lastSeq, reason }); },
      },
    });
    expect(observedTopics).toEqual(["Testing pipeline behavior", "Edited during execution"]);
    expect(attempts).toBe(2);
    expect(runs.get(run.id)).toMatchObject({ lastSeq: 1, status: "PAUSED_AT_GATE" });
  } finally {
    runner.close();
    control.close();
  }
});

it("runs the stock research executor with a mock provider in an isolated runtime", async () => {
  const h = createPipelineHarness();
  try {
    const runtime = createStockRunner({
      sqlite: h.sqlite, config: { ...h.config, LLM_ENABLE_MOCK: true, LLM_DEFAULT_PROVIDER: "mock" },
      logger: Fastify().log, projectId: h.projectId, stopBefore: ["SCRIPT"], now: h.clock,
      retrieve: async ({ query }) => ({
        mode: "text", matches: [{ chunkId: 7, kind: "memory", sourceId: "fixture", sourceVersion: "1",
          title: "Guide", text: query, score: 1, breakdown: { bm25: 1, vector: null, boost: 0 } }],
      }),
    });
    try {
      runtime.orchestrator.runAll(h.projectId);
      await runtime.worker.tick();
      expect(runtime.repository.getStage(h.projectId, "RESEARCH").state).toBe("DONE");
      expect(runtime.repository.getStage(h.projectId, "SCRIPT").state).toBe("PENDING");
      expect(h.sqlite.prepare("SELECT provider FROM research_notes WHERE project_id=?").get(h.projectId)).toEqual({ provider: "mock" });
      const knowledge = await buildKnowledgeBlock(h.sqlite, { project: runtime.repository.getProject(h.projectId)!,
        stage: "SCRIPT", taskId: "script", query: "context from control" });
      expect(knowledge.block).toContain("context from control");
      expect(knowledge.uses.chunkIds).toEqual([7]);
    } finally { await runtime.worker.stop(); }
  } finally { h.close(); }
});

it("reopens a verified warm database for a later lease and takes gate state from control", async () => {
  const control = createPipelineHarness();
  const runner = createPipelineHarness();
  let opened: Awaited<ReturnType<typeof openProjectRun>> | undefined;
  let reused: Awaited<ReturnType<typeof openProjectRun>> | undefined;
  try {
    const { projectId, sqlite, config, repository, orchestrator, clock } = control;
    sqlite.prepare("UPDATE projects SET workspace_id='A' WHERE id=?").run(projectId);
    const nodes = new NodeService(sqlite, config, repository, orchestrator, clock);
    const { nodeToken } = nodes.join({ joinToken: nodes.createJoinToken({ workspaceId: "A" }).token, name: "warm",
      version: readAppVersion(), capabilities: ["project"], resources: {} });
    const node = nodes.authenticate(nodeToken)!;
    const runs = new ProjectRunService(sqlite, orchestrator, clock);
    const first = runs.grant(node, { projectId, fromStage: "RESEARCH", stopBefore: ["VISUAL_REVIEW"], budgetCapUsd: 1 });
    const noFile = async () => { throw new Error("fixture has no files"); };
    const initial = exportProjectSnapshot(sqlite, config.DATA_DIR, projectId);
    const warm = new WarmProjectRuns();
    opened = await openProjectRun({ nodeDataDir: runner.config.DATA_DIR, run: first, snapshot: initial, download: noFile, signal: new AbortController().signal });
    const databasePath = opened.databasePath;
    warm.keep(projectId, opened);
    opened.sqlite.close();
    opened = undefined;
    runs.finish(node, first.id, { leaseId: first.leaseId, lastSeq: 0, reason: "BOUNDARY" });
    repository.ensureStages(projectId);
    repository.updateStage(projectId, "VISUAL_REVIEW", { state: "DONE", progress: 100 });
    const second = runs.grant(node, { projectId, fromStage: "VOICE", stopBefore: [], budgetCapUsd: 1 });
    const snapshot = exportProjectSnapshot(sqlite, config.DATA_DIR, projectId);
    reused = warm.take(second, snapshot);
    expect(reused?.databasePath).toBe(databasePath);
    expect(reused?.sqlite.prepare("SELECT state FROM project_stages WHERE project_id=? AND stage='VISUAL_REVIEW'").get(projectId)).toEqual({ state: "DONE" });
  } finally {
    opened?.sqlite.close();
    reused?.sqlite.close();
    runner.close();
    control.close();
  }
});
