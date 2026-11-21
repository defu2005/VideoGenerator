import { afterEach, expect, it } from "vitest";
import Fastify from "fastify";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { NodeService } from "../src/node/nodeService.js";
import { ProjectPlacement } from "../src/node/projectPlacement.js";
import { ProjectRunService } from "../src/node/runService.js";
import { RunCommands } from "../src/node/runCommands.js";
import { RunCheckpointService } from "../src/node/runCheckpoint.js";
import { RunTransportService } from "../src/node/runTransport.js";
import { runProjectLease, WarmProjectRuns } from "../src/node/projectRunner.js";
import { createRunnerRuntime } from "../src/node/runnerRuntime.js";
import { createProjectDir } from "../src/storage/paths.js";
import { readAppVersion } from "../src/render/appVersion.js";
import { createPipelineHarness } from "./pipelineFixtures.js";

const fixtures: Array<ReturnType<typeof createPipelineHarness>> = [];
afterEach(() => { for (const fixture of fixtures.splice(0)) fixture.close(); });

function setup(options: Parameters<typeof createPipelineHarness>[0] = {}) {
  const h = createPipelineHarness(options);
  fixtures.push(h);
  const { sqlite: db, orchestrator, repository, config, clock, projectId } = h;
  db.prepare("UPDATE projects SET execution_mode='node',workspace_id='W',settings=json_set(settings,'$.stageExecution.VISUAL_SEARCH','app') WHERE id=?").run(projectId);
  const nodes = new NodeService(db, config, repository, orchestrator, clock);
  const runs = new ProjectRunService(db, orchestrator, clock);
  const commands = new RunCommands(db, runs, clock);
  const placement = new ProjectPlacement({
    db, orchestrator, runs, nodes, commands, now: clock, budget: () => 1,
    needs: () => ({ RESEARCH: ["llm:mock"], VOICE: ["tts:mock"] }),
  });
  orchestrator.setProjectPlacement(placement);
  function join(workspaceId = "W", cpus = 4) {
    const { nodeToken } = nodes.join({ joinToken: nodes.createJoinToken({ workspaceId }).token, name: `node-${cpus}`,
      version: readAppVersion(), capabilities: ["project", "llm:mock", "tts:mock"], resources: { cpus, ramMb: 1024, freeDiskMb: 4096 } });
    return nodes.authenticate(nodeToken)!;
  }
  const sweep = () => placement.sweep((error) => { throw error; });
  return { ...h, nodes, runs, commands, join, sweep };
}

it("signals the active runner once when control edits the project input", async () => {
  const h = setup();
  const node = h.join();
  h.orchestrator.runAll(h.projectId);
  const run = h.runs.pendingFor(node)!;
  h.sqlite.prepare("UPDATE projects SET topic='Revised on control' WHERE id=?").run(h.projectId);
  h.sweep();
  h.sweep();
  const commands = await h.commands.poll(node, run.id, run.leaseId, 0, new AbortController().signal, 0);
  expect(commands.filter(({ kind }) => kind === "rebase")).toEqual([{ sequence: 1, kind: "rebase" }]);
  expect(h.repository.getActiveJobs(h.projectId)).toEqual([]);
});

it("assigns a node segment before local enqueue and honors both the pin and workspace", () => {
  const h = setup();
  const pinned = h.join();
  h.join("W", 64);
  h.join("Other", 128);
  h.sqlite.prepare("UPDATE projects SET execution_node=? WHERE id=?").run(pinned.id, h.projectId);
  h.orchestrator.runAll(h.projectId);
  const run = h.runs.pendingFor(pinned)!;
  expect(run).toMatchObject({ nodeId: pinned.id, fromStage: "RESEARCH", budgetCapUsd: 1 });
  expect(run.stopBefore).toContain("VISUAL_REVIEW");
  expect(h.repository.getActiveJobs(h.projectId)).toEqual([]);
  expect(() => h.orchestrator.runStage(h.projectId, "RESEARCH")).toThrow(/node/);
  h.orchestrator.cancel(h.projectId);
  expect(h.runs.get(run.id)?.status).toBe("CANCELLED");
  expect(h.repository.getRunMode(h.projectId)).toBeNull();
});

it("resumes on control from the last accepted checkpoint if the only runner expires", async () => {
  const h = setup();
  const node = h.join();
  h.orchestrator.runAll(h.projectId);
  const run = h.runs.pendingFor(node)!;
  const cp = new RunCheckpointService(h.sqlite, h.runs, h.orchestrator, h.config.DATA_DIR,
    () => { throw new Error("No fixture files"); }, () => undefined, h.clock);
  const checkpoint = { leaseId: run.leaseId, seq: 1, stage: "RESEARCH",
    inputVersion: h.orchestrator.inputVersions.inputVersion(h.projectId, "RESEARCH"),
    tables: { research_notes: [] }, costs: [] };
  cp.apply(node, run.id, checkpoint);
  h.advance(91_000);
  h.sweep();
  expect(h.runs.get(run.id)).toMatchObject({ status: "LOST", lastSeq: 1 });
  expect(h.repository.getStage(h.projectId, "RESEARCH").state).toBe("DONE");
  expect(h.repository.getActiveJobs(h.projectId).map(({ stage }) => stage)).toEqual(["SCRIPT"]);
  expect(() => cp.apply(node, run.id, checkpoint)).toThrow(/hết hạn/);
});

it.each(["control", "wait"])("uses the configured %s fallback after waiting for a matching node", (fallback) => {
  const h = setup();
  h.join("Other");
  h.sqlite.prepare("INSERT INTO app_settings(key,value,updated_at) VALUES ('execution.fallback',?,?)").run(JSON.stringify(fallback), h.clock().toISOString());
  h.orchestrator.runAll(h.projectId);
  expect(h.repository.getActiveJobs(h.projectId)).toEqual([]);
  h.advance(31_000);
  h.sweep();
  expect(h.repository.getActiveJobs(h.projectId).map(({ stage }) => stage)).toEqual(fallback === "wait" ? [] : ["RESEARCH"]);
});

it("a running AUTO segment holds SCRIPT_REVIEW when the setting flips to script", async () => {
  const h = setup({ mode: "AUTO" });
  const node = h.join();
  h.orchestrator.runAll(h.projectId);
  const run = h.runs.pendingFor(node)!;
  h.sqlite.prepare("UPDATE projects SET settings = json_set(settings, '$.scriptOutlineApproval', 'script') WHERE id = ?").run(h.projectId);
  h.sweep();
  const commands = await h.commands.poll(node, run.id, run.leaseId, 0, new AbortController().signal, 0);
  const stop = commands.find((command) => command.kind === "stopBefore") as { stages?: string[] } | undefined;
  expect(stop?.stages).toContain("SCRIPT_REVIEW");
});

it("runs placed segments across human gates on the same warm database and registers the final artifact", async () => {
  const h = setup();
  const worker = createPipelineHarness({ config: { FAKE_STAGE_DELAY_MS: 0 } });
  fixtures.push(worker);
  const node = h.join();
  const warm = new WarmProjectRuns();
  const databasePaths: string[] = [];
  const control = new RunTransportService(h.sqlite, h.config, h.runs, h.orchestrator, () => undefined, h.clock);
  control.onBoundary = (projectId) => h.orchestrator.resumePlacedProject(projectId);
  h.orchestrator.runAll(h.projectId);
  let segments = 0;
  for (; segments < 6; segments++) {
    const run = h.runs.pendingFor(node)!;
    expect(run, "control granted the next segment").toBeTruthy();
    await runProjectLease({
      nodeDataDir: worker.config.DATA_DIR, run, warm, signal: new AbortController().signal,
      buildRuntime(opened, stopBefore) {
        databasePaths.push(opened.databasePath);
        const executors = new Map(worker.executors);
        executors.set("RENDER", {
          stage: "RENDER",
          async run() {
            const output = join(createProjectDir(opened.dataDir, h.projectId), "final.mp4");
            writeFileSync(output, "fixture-video-output");
            opened.sqlite.prepare(`INSERT INTO renders(id,project_id,input_hash,status,output_path,duration_sec,size_bytes,width,height,report,created_at)
              VALUES ('fixture-render',?,'fixture','DONE',?,1,20,16,9,'{}',?)`).run(h.projectId, output, h.clock().toISOString());
            return { renderId: "fixture-render", message: "Rendered fixture" };
          },
        });
        return createRunnerRuntime({
          sqlite: opened.sqlite, config: { ...worker.config, DATA_DIR: opened.dataDir }, logger: Fastify().log,
          executors, projectId: h.projectId, stopBefore, canApprove: () => ({ allowed: true }), now: h.clock,
        });
      },
      transport: {
        snapshot: async () => control.snapshot(node, run.id, run.leaseId),
        download: async (file) => control.artifact(node, run.id, run.leaseId, file.sha256).path,
        commands: async (_after, signal) => {
          if (!signal.aborted) await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
          return [];
        },
        async checkpoint(checkpoint, files) {
          for (const file of files) await control.append(node, {
            jobId: run.id, leaseId: run.leaseId, name: file.name, sha256: file.sha256, size: file.size,
          }, 0, Readable.from([readFileSync(file.path)]));
          control.checkpoints.apply(node, run.id, checkpoint);
        },
        finish: async (reason, lastSeq, _signal, blockedGate) => {
          control.finish(node, run.id, { leaseId: run.leaseId, lastSeq, reason, blockedGate });
        },
      },
    });
    if (h.runs.get(run.id)?.status === "DONE") break;
    const waiting = h.repository.getStages(h.projectId).filter(({ state }) => state === "WAITING_USER");
    expect(waiting.length).toBeGreaterThan(0);
    for (const { stage } of waiting) h.orchestrator.approveGate(h.projectId, stage);
  }
  expect(segments).toBeLessThan(6);
  expect(databasePaths.length).toBeGreaterThan(1);
  expect(new Set(databasePaths).size).toBe(1);
  expect(h.repository.getProject(h.projectId)).toMatchObject({ status: "COMPLETED", stage: "DONE" });
  const row = h.sqlite.prepare("SELECT output_path AS path FROM renders WHERE id='fixture-render'").get() as { path: string };
  expect(readFileSync(row.path, "utf8")).toBe("fixture-video-output");
});
