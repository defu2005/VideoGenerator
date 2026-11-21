import { createHash } from "node:crypto";
import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { readAppVersion } from "../src/render/appVersion.js";
import { ArtifactService } from "../src/node/artifactService.js";
import { LeaseService, type RenderPort } from "../src/node/leaseService.js";
import { NodeService, type NodeRow } from "../src/node/nodeService.js";
import type { ProjectRun } from "@vg/shared";
import { ProjectRunService } from "../src/node/runService.js";
import { RunTransportService } from "../src/node/runTransport.js";
import { FileGc } from "../src/storage/fileGc.js";
import { projectDir } from "../src/storage/paths.js";
import { createPipelineHarness } from "./pipelineFixtures.js";

// TASK-168 negative pin (fixture, not production). Question: can a run R's `have` link a run_uploads row to
// A's pending file for the same bytes S? Read verdict: a run lease needs no active job on the project
// (runService.ts:57-59), so R starts after A completes. Then R's run-start snapshot (projectRunner.ts:205)
// runs exportProjectRows on the server DB (runTransport.ts:77), which re-registers renders output.mp4 to
// versions (projectSnapshot.ts:118). The pin asserts that chain: have links versions, and cleanup keeps it.
//
// Fixture parts, labelled: the renders row and the versions file are written by hand, because the render
// stub's finalize writes neither. The 25 h clock advance is fabricated timing, and the run lease is renewed
// through the heartbeat while the clock moves. The control shows what happens without the snapshot call.
// The control is NOT a production order: it skips the run-start snapshot on purpose.

vi.mock("../src/node/remoteBundle.js", () => ({
  RemoteBundleError: class RemoteBundleError extends Error {},
  logicalName: (sha: string) => sha,
  buildRemoteBundle: async () => ({ bundle: { bundleVersion: 1, renderId: "render-1" }, files: [] }),
}));

const HOUR = 3_600_000;
const VIDEO = "video bytes";
const REPORT = JSON.stringify({ clipsReused: 0, clipsRendered: 1, graphicShots: [], composeWarnings: [], joinWarnings: [] });
const RESOURCES = { cpus: 2, ramMb: 4096, freeDiskMb: 50_000 };
const S = createHash("sha256").update(VIDEO).digest("hex");
const REPORT_SHA = createHash("sha256").update(REPORT).digest("hex");

function setup() {
  const harness = createPipelineHarness();
  const dataDir = harness.config.DATA_DIR;
  harness.sqlite.prepare("UPDATE projects SET workspace_id='A' WHERE id=?").run(harness.projectId);
  const renderDirFor = (projectId: string) => join(projectDir(dataDir, projectId), "render");
  const nodes = new NodeService(harness.sqlite, harness.config, harness.repository, harness.orchestrator, harness.clock);
  const artifacts = new ArtifactService(harness.sqlite, harness.clock);
  const finalize = vi.fn(async () => ({ render: { id: "render-1" } as never, reused: false }));
  const renders: RenderPort = {
    renderDir: renderDirFor,
    versionDir: (projectId, renderId) => join(renderDirFor(projectId), "versions", renderId),
    prepare: async () => ({
      prepared: {
        bundle: { renderId: "render-1" } as never,
        state: { renderId: "render-1" } as never,
        local: { resolvePath: (p: string) => p },
      },
    }),
    finalize,
  };
  const leases = new LeaseService(
    harness.sqlite, harness.config, harness.repository, harness.orchestrator, nodes, renders, artifacts,
    async () => ({ message: "unused" }), harness.clock,
  );
  const gc = new FileGc(harness.sqlite, dataDir, () => ({ graceDays: 14, postPublishDays: 7 }), harness.clock);
  const runs = new ProjectRunService(harness.sqlite, harness.orchestrator, harness.clock);
  nodes.projectRuns = runs;

  function joinNode(name: string): NodeRow {
    const { token: joinToken } = nodes.createJoinToken({ workspaceId: "A" });
    const joined = nodes.join({ joinToken, name, version: readAppVersion(), capabilities: ["render"], resources: RESOURCES });
    return nodes.authenticate(joined.nodeToken)!;
  }

  const queueRender = () => harness.repository.createJob({
    projectId: harness.projectId, stage: "RENDER", maxAttempts: 3, previousState: "PENDING", runAfter: harness.clock(),
  });

  const versionFile = join(renderDirFor(harness.projectId), "versions", "render-1", "output.mp4");
  const pendingFile = (jobId: string, leaseId: string) =>
    join(renderDirFor(harness.projectId), "pending", `${jobId}.uploads`, leaseId, "final.mp4");

  const artifactPath = (digest: string) => (harness.sqlite.prepare(
    "SELECT path FROM artifacts WHERE sha256 = ?").get(digest) as { path: string } | undefined)?.path;

  const completeBody = (leaseId: string) => ({
    leaseId,
    outputs: [{ name: "final.mp4", sha256: S }, { name: "report.json", sha256: REPORT_SHA }],
  });

  // Fixture: finalize is a stub, so write the versions file and a renders row that points at it.
  function insertRenderRow() {
    mkdirSync(dirname(versionFile), { recursive: true });
    writeFileSync(versionFile, VIDEO);
    harness.sqlite.prepare(`INSERT INTO renders(id,project_id,input_hash,status,output_path,duration_sec,size_bytes,width,height,report,created_at)
      VALUES ('render-1',?,'fixture-hash','DONE',?,1,?,1920,1080,?,?)`)
      .run(harness.projectId, versionFile, Buffer.byteLength(VIDEO), REPORT, harness.clock().toISOString());
  }

  // Run A to SUCCEEDED, with a GC pass while A is RUNNING (the TASK-162 order).
  async function completeA() {
    const rowA = joinNode("may-1");
    const jobA = queueRender();
    const leaseA = (await leases.lease(rowA, 1))!;
    await leases.receiveOutput(rowA, jobA.id, leaseA.leaseId, "final.mp4", S, Readable.from([Buffer.from(VIDEO)]));
    await leases.receiveOutput(rowA, jobA.id, leaseA.leaseId, "report.json", REPORT_SHA, Readable.from([Buffer.from(REPORT)]));
    const fileA = pendingFile(jobA.id, leaseA.leaseId);
    expect(existsSync(fileA)).toBe(true);
    expect(gc.run({ purge: true, ephemeralOnly: true })).toMatchObject({ marked: 0, purged: 0 });
    // Pre-assert: GC while A RUNNING registers A's pending file for S.
    expect(artifactPath(S)).toBe(realpathSync.native(fileA));
    await leases.complete(rowA, jobA.id, completeBody(leaseA.leaseId));
    expect(harness.repository.getJob(jobA.id)!.status).toBe("SUCCEEDED");
    // Pre-assert: completing A writes no artifacts row. Only a later server registration repoints S.
    expect(artifactPath(S)).toBe(realpathSync.native(fileA));
    return { fileA };
  }

  // Run R on a fresh node, granted after A completed (runService.ts:57-59 refuses while a job is active).
  function grantRun() {
    const rowR = joinNode("may-2");
    const run = runs.grant(rowR, { projectId: harness.projectId, fromStage: "RESEARCH", stopBefore: ["VISUAL_REVIEW"], budgetCapUsd: 1 });
    const transport = new RunTransportService(harness.sqlite, harness.config, runs, harness.orchestrator, vi.fn(), harness.clock);
    return { rowR, run, transport };
  }

  // Fabricated timing: move the clock in 60 s steps (the run TTL is 90 s, runService.ts ttlMs) and renew R's
  // lease at each step, as its heartbeat would. A one-hour step lets the lease expire before the renewal.
  function advanceKeepingRun(rowR: NodeRow, run: ProjectRun, hours: number) {
    for (let elapsed = 0; elapsed < hours * HOUR; elapsed += 60_000) {
      harness.advance(60_000);
      nodes.heartbeat(rowR, { version: readAppVersion(), capabilities: ["render"], resources: RESOURCES, running: [],
        projectRuns: [{ runId: run.id, leaseId: run.leaseId }] });
    }
  }

  const haveFile = { name: `files/${S}.mp4`, sha256: S, size: Buffer.byteLength(VIDEO) };
  const linkedRows = (runId: string) => harness.sqlite.prepare(
    "SELECT name, status, path FROM run_uploads WHERE run_id = ? ORDER BY name").all(runId) as Array<{ name: string; status: string; path: string }>;

  // SUBTITLE checkpoint naming the same file, as runTransport.test.ts does. The srt_path value is a fixture label.
  function checkpointBody(leaseId: string) {
    harness.repository.ensureStages(harness.projectId);
    harness.repository.updateStage(harness.projectId, "VOICE", { state: "DONE" });
    const now = harness.clock().toISOString();
    return { leaseId, seq: 1, stage: "SUBTITLE", inputVersion: harness.orchestrator.inputVersions.inputVersion(harness.projectId, "SUBTITLE"),
      tables: { subtitle_tracks: [{ id: "subtitles", project_id: harness.projectId, cues: "[]", srt_path: haveFile.name, ass_path: haveFile.name, input_hash: "hash", created_at: now, updated_at: now }] }, costs: [] };
  }

  return { harness, leases, versionFile, pendingFile, artifactPath, insertRenderRow, completeA, grantRun, advanceKeepingRun, haveFile, linkedRows, checkpointBody };
}

describe("TASK-168 negative pin: run-start snapshot repoints S to versions before R's have", () => {
  it("pin: R granted after A completes; its snapshot repoints S to versions; have links versions; cleanup keeps it; the checkpoint applies", async () => {
    const s = setup();
    try {
      const { fileA } = await s.completeA();
      s.insertRenderRow();
      const { rowR, run, transport } = s.grantRun();

      // The run-start snapshot (runTransport.snapshot, server DB) registers the renders output.
      const snapshot = transport.snapshot(rowR, run.id, run.leaseId);
      expect(snapshot.files.map((file) => [file.name, file.sha256])).toContainEqual([s.haveFile.name, S]);
      expect(s.artifactPath(S)).toBe(realpathSync.native(s.versionFile));

      expect(transport.have(rowR, run.id, run.leaseId, [s.haveFile])).toEqual([s.haveFile.name]);
      expect(s.linkedRows(run.id)).toEqual([{ name: s.haveFile.name, status: "linked", path: realpathSync.native(s.versionFile) }]);

      // 25 h later: cleanup removes A's pending file. The versions file stays.
      s.advanceKeepingRun(rowR, run, 25);
      s.leases.cleanupFinishedUploads();
      expect(existsSync(fileA)).toBe(false);
      expect(existsSync(s.versionFile)).toBe(true);

      // The later have returns the same name from the existing row. The checkpoint applies with the versions file.
      expect(transport.have(rowR, run.id, run.leaseId, [s.haveFile])).toEqual([s.haveFile.name]);
      expect(transport.checkpoints.apply(rowR, run.id, s.checkpointBody(run.leaseId))).toMatchObject({ ok: true });
    } finally { s.harness.close(); }
  });

  it("control (NOT a production order): the same flow without the run-start snapshot; have links pending, cleanup removes it, the checkpoint throws raw ENOENT", async () => {
    const s = setup();
    try {
      const { fileA } = await s.completeA();
      s.insertRenderRow();
      const { rowR, run, transport } = s.grantRun();

      // Skipped on purpose: transport.snapshot. S is still pending here.
      expect(s.artifactPath(S)).toBe(realpathSync.native(fileA));
      expect(transport.have(rowR, run.id, run.leaseId, [s.haveFile])).toEqual([s.haveFile.name]);
      expect(s.linkedRows(run.id)).toEqual([{ name: s.haveFile.name, status: "linked", path: realpathSync.native(fileA) }]);

      s.advanceKeepingRun(rowR, run, 25);
      s.leases.cleanupFinishedUploads();
      expect(existsSync(fileA)).toBe(false);

      let caught: unknown;
      try { transport.checkpoints.apply(rowR, run.id, s.checkpointBody(run.leaseId)); } catch (error) { caught = error; }
      expect((caught as NodeJS.ErrnoException | undefined)?.code).toBe("ENOENT");
    } finally { s.harness.close(); }
  });
});
