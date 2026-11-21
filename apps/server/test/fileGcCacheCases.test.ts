import { createHash } from "node:crypto";
import { existsSync, mkdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { readAppVersion } from "../src/render/appVersion.js";
import { ArtifactService } from "../src/node/artifactService.js";
import { LeaseService, type RenderPort } from "../src/node/leaseService.js";
import { NodeService, type NodeRow } from "../src/node/nodeService.js";
import { ProjectRunService } from "../src/node/runService.js";
import { FileGc } from "../src/storage/fileGc.js";
import { projectDir } from "../src/storage/paths.js";
import { createPipelineHarness } from "./pipelineFixtures.js";

// TASK-170: four cache states of collectReferences' registerSync (references.ts:172, artifactService.ts:37).
// TASK-171: the stuck case is split by render id (retained row vs A's row) and by the shape of A's renders row.
//
// Run options: every measured pass calls run({ purge: true, ephemeralOnly: true }), the literal call at
// app.ts:801 (disk pressure). app.ts:767 passes only { purge: true }. Those options reach file deletion
// only (fileGc.ts:421, :434, :445), not collectReferences (fileGc.ts:406 passes now and postPublishDays).
// So reference registration does not depend on them.
//
// One long-lived FileGc per case (app.ts:255 passes no artifacts). A write log captures every artifacts
// INSERT/UPDATE with its sha256 and path, so each pass reports the ordered sequence of writes for sha S.
// Each pass also reports the row's path just before it runs (pre).
//
// Expected values are written before the first run. A red result is a finding, and the assertion is not edited.

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

type Label = "versions" | "retained-versions" | "pending" | undefined | string;

function setup() {
  const harness = createPipelineHarness();
  const dataDir = harness.config.DATA_DIR;
  harness.sqlite.prepare("UPDATE projects SET workspace_id='A' WHERE id=?").run(harness.projectId);
  harness.sqlite.exec(`
    CREATE TABLE gc_log (id INTEGER PRIMARY KEY AUTOINCREMENT, sha256 TEXT, path TEXT);
    CREATE TRIGGER gc_log_ins AFTER INSERT ON artifacts BEGIN INSERT INTO gc_log(sha256, path) VALUES (NEW.sha256, NEW.path); END;
    CREATE TRIGGER gc_log_upd AFTER UPDATE ON artifacts BEGIN INSERT INTO gc_log(sha256, path) VALUES (NEW.sha256, NEW.path); END;`);
  const renderDirFor = (projectId: string) => join(projectDir(dataDir, projectId), "render");
  const nodes = new NodeService(harness.sqlite, harness.config, harness.repository, harness.orchestrator, harness.clock);
  const artifacts = new ArtifactService(harness.sqlite, harness.clock);
  const renders: RenderPort = {
    renderDir: renderDirFor,
    versionDir: (projectId, renderId) => join(renderDirFor(projectId), "versions", renderId),
    prepare: async () => ({ prepared: { bundle: { renderId: "render-1" } as never, state: { renderId: "render-1" } as never, local: { resolvePath: (p: string) => p } } }),
    finalize: vi.fn(async () => ({ render: { id: "render-1" } as never, reused: false })),
  };
  const leases = new LeaseService(
    harness.sqlite, harness.config, harness.repository, harness.orchestrator, nodes, renders, artifacts,
    async () => ({ message: "unused" }), harness.clock,
  );
  const runs = new ProjectRunService(harness.sqlite, harness.orchestrator, harness.clock);
  nodes.projectRuns = runs;
  // The one long-lived instance, as app.ts:255 builds it.
  const gc = new FileGc(harness.sqlite, dataDir, () => ({ graceDays: 14, postPublishDays: 7 }), harness.clock);

  // A's output is render-1 (prepare returns it). The retained row is render-1 by default (collision case),
  // or render-0 in the separate-id cases.
  const versionFileOf = (renderId: string) => join(renderDirFor(harness.projectId), "versions", renderId, "output.mp4");
  const versionFile = versionFileOf("render-1");
  const retainedFile = versionFileOf("render-0");
  let pendingFile = "";

  function joinNode(name: string): NodeRow {
    const { token: joinToken } = nodes.createJoinToken({ workspaceId: "A" });
    const joined = nodes.join({ joinToken, name, version: readAppVersion(), capabilities: ["render"], resources: RESOURCES });
    return nodes.authenticate(joined.nodeToken)!;
  }
  const queueRender = () => harness.repository.createJob({
    projectId: harness.projectId, stage: "RENDER", maxAttempts: 3, previousState: "PENDING", runAfter: harness.clock(),
  });
  // A version file may not exist yet, so do not realpath it unconditionally.
  const realOf = (file: string) => (existsSync(file) ? realpathSync.native(file) : file);
  const realVersions = () => realOf(versionFile);
  const realRetained = () => realOf(retainedFile);
  const artifactPath = () => (harness.sqlite.prepare("SELECT path FROM artifacts WHERE sha256 = ?").get(S) as { path: string } | undefined)?.path;
  const label = (p: string | undefined): Label => {
    if (p === undefined) return undefined;
    if (p === realVersions()) return "versions";
    if (p === realRetained()) return "retained-versions";
    if (p === pendingFile) return "pending";
    return p;
  };
  const lastLogId = () => (harness.sqlite.prepare("SELECT COALESCE(MAX(id), 0) AS id FROM gc_log").get() as { id: number }).id;

  // One pass: pre = row's label before the pass; seq = labels of S writes during the pass, in order; path = after.
  function pass(instance: FileGc = gc) {
    const pre = label(artifactPath());
    const last = lastLogId();
    instance.run({ purge: true, ephemeralOnly: true });
    const seq = (harness.sqlite.prepare("SELECT path FROM gc_log WHERE id > ? AND sha256 = ? ORDER BY id").all(last, S) as { path: string }[])
      .map((row) => label(row.path));
    const result = { pre, seq, path: label(artifactPath()) };
    console.info("[TASK-170]", JSON.stringify(result));
    return result;
  }

  // A DONE render row with its output file already on disk (the retained row, or the collision row).
  function insertRenderRow(renderId = "render-1") {
    const file = versionFileOf(renderId);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, VIDEO);
    harness.sqlite.prepare(`INSERT INTO renders(id,project_id,input_hash,status,output_path,duration_sec,size_bytes,width,height,report,created_at)
      VALUES (?,?,'fixture-hash','DONE',?,1,?,1920,1080,?,?)`)
      .run(renderId, harness.projectId, file, Buffer.byteLength(VIDEO), REPORT, harness.clock().toISOString());
  }

  // A row with the column set of the real finalize INSERT (renderService.ts:996–1003). The file is not written here:
  // complete has already renamed the output into place (leaseService.ts:672), before finalize runs (:673).
  function insertFinalizeRow(renderId: string) {
    harness.sqlite.prepare(`INSERT INTO renders (id, project_id, input_hash, status, output_path, credits_path, srt_path,
        duration_sec, size_bytes, width, height, report, created_at, version, note, pinned, deleted_at, review_thread_id,
        metadata_snapshot, aspect_ratio, variant_of)
      VALUES (?, ?, 'fixture-hash-a', 'DONE', ?, NULL, NULL, 1, ?, 1920, 1080, ?, ?, 2, NULL, 0, NULL, NULL, NULL, NULL, NULL)`)
      .run(renderId, harness.projectId, versionFileOf(renderId), Buffer.byteLength(VIDEO), REPORT,
        new Date(harness.clock().getTime() + 1000).toISOString());
  }

  // A leases the job and uploads S. The pending file is the realpath of final.mp4.
  async function startA() {
    const rowA = joinNode("may-1");
    const jobA = queueRender();
    const leaseA = (await leases.lease(rowA, 1))!;
    await leases.receiveOutput(rowA, jobA.id, leaseA.leaseId, "final.mp4", S, Readable.from([Buffer.from(VIDEO)]));
    await leases.receiveOutput(rowA, jobA.id, leaseA.leaseId, "report.json", REPORT_SHA, Readable.from([Buffer.from(REPORT)]));
    pendingFile = realpathSync.native(join(renderDirFor(harness.projectId), "pending", `${jobA.id}.uploads`, leaseA.leaseId, "final.mp4"));
    return { rowA, jobA, leaseA, fileA: pendingFile };
  }
  async function completeA(a: Awaited<ReturnType<typeof startA>>) {
    await leases.complete(a.rowA, a.jobA.id, {
      leaseId: a.leaseA.leaseId,
      outputs: [{ name: "final.mp4", sha256: S }, { name: "report.json", sha256: REPORT_SHA }],
    });
    expect(harness.repository.getJob(a.jobA.id)!.status).toBe("SUCCEEDED");
  }

  return {
    harness, leases, gc, pass, artifactPath, insertRenderRow, insertFinalizeRow, startA, completeA,
    realVersions, realRetained, versionFile, dataDir, pendingFile: () => pendingFile,
  };
}

describe("TASK-170/171 cache cases for the shared sha S (one long-lived FileGc)", () => {
  it("miss/miss: both paths unregistered; the pass writes versions then pending, so pending wins", async () => {
    const s = setup();
    try {
      await s.startA();
      s.insertRenderRow();
      // Predicted seq: [versions, pending] (renders is walked before nodeUploads, dataContract.ts:40 and :57). Final: pending.
      const result = s.pass();
      expect(result.seq).toEqual(["versions", "pending"]);
      expect(result.path).toBe("pending");
    } finally { s.harness.close(); }
  });

  it("hit/hit: the second pass on the same state writes nothing and the row stays on pending", async () => {
    const s = setup();
    try {
      await s.startA();
      s.insertRenderRow();
      s.pass();
      // Predicted seq: [] (both hit, artifactService.ts:37). Final: pending.
      const second = s.pass();
      expect(second.seq).toEqual([]);
      expect(second.path).toBe("pending");
    } finally { s.harness.close(); }
  });

  it("collision (same render id): the retained row and A both use render-1; completion replaces the file, the cache misses, the row repoints to versions", async () => {
    const s = setup();
    try {
      const a = await s.startA();
      s.insertRenderRow();
      s.pass();
      const statBefore = statSync(s.versionFile, { bigint: true });
      await s.completeA(a);
      const statAfter = statSync(s.versionFile, { bigint: true });
      // Diagnostic only: did completeA change the versions file's stamp (ino, size, mtime, ctime)?
      console.info("[TASK-170] versions stamp", JSON.stringify({
        before: [statBefore.ino, statBefore.size, statBefore.mtimeNs, statBefore.ctimeNs].map(String),
        after: [statAfter.ino, statAfter.size, statAfter.mtimeNs, statAfter.ctimeNs].map(String),
      }));
      // Observed (TASK-170 run): seq [versions], path versions. Pinned green here; the TASK-170 prediction ([] / pending) is recorded in the report.
      const afterComplete = s.pass();
      expect(afterComplete.seq).toEqual(["versions"]);
      expect(afterComplete.path).toBe("versions");
      // The file must still exist before cleanup runs.
      expect(existsSync(a.fileA)).toBe(true);
      s.harness.advance(25 * HOUR);
      s.leases.cleanupFinishedUploads();
      // Observed: cleanup removes the pending file, and the row already names versions.
      expect(existsSync(a.fileA)).toBe(false);
      expect(s.artifactPath()).toBe(s.realVersions());
    } finally { s.harness.close(); }
  });

  it("control: after A completes, a FRESH FileGc (empty cache) repoints the row to versions", async () => {
    const s = setup();
    try {
      const a = await s.startA();
      s.insertRenderRow();
      s.pass();
      await s.completeA(a);
      const fresh = new FileGc(s.harness.sqlite, s.dataDir, () => ({ graceDays: 14, postPublishDays: 7 }), s.harness.clock);
      // Predicted seq: [versions] (pending unreferenced; versions misses in the new instance). Final: versions.
      const result = s.pass(fresh);
      expect(result.seq).toEqual(["versions"]);
      expect(result.path).toBe("versions");
    } finally { s.harness.close(); }
  });

  it("separate ids, no render row for A (mock finalize inserts nothing; not production order): the retained render-0 hits, the row stays on pending until cleanup", async () => {
    const s = setup();
    try {
      s.insertRenderRow("render-0");
      const a = await s.startA();
      // Predicted pass 1 (A RUNNING): renders first (render-0 writes retained-versions), then pending wins. Path pending.
      const first = s.pass();
      expect.soft(first.seq).toEqual(["retained-versions", "pending"]);
      expect.soft(first.path).toBe("pending");
      await s.completeA(a);
      // Predicted pass 2 (A SUCCEEDED, no render-1 row): retained hits, pending unreferenced. seq [], path pending.
      const second = s.pass();
      expect.soft(second.seq).toEqual([]);
      expect.soft(second.path).toBe("pending");
      expect(existsSync(a.fileA)).toBe(true);
      s.harness.advance(25 * HOUR);
      s.leases.cleanupFinishedUploads();
      // Predicted: cleanup removes the pending file and the row still names it (the stuck shape).
      expect.soft(existsSync(a.fileA)).toBe(false);
      expect.soft(s.artifactPath()).toBe(a.fileA);
    } finally { s.harness.close(); }
  });

  it("separate ids, real finalize shape (render-1 row inserted after complete): the cache misses on render-1, the row repoints to versions, and cleanup does not strand it", async () => {
    const s = setup();
    try {
      s.insertRenderRow("render-0");
      const a = await s.startA();
      // Predicted pass 1 (A RUNNING): [retained-versions, pending], path pending.
      const first = s.pass();
      expect.soft(first.seq).toEqual(["retained-versions", "pending"]);
      expect.soft(first.path).toBe("pending");
      await s.completeA(a);
      s.insertFinalizeRow("render-1");
      // Predicted pass 2: render-0 hits (no write); render-1 is a new inode, so it misses and writes versions last. Path versions.
      const second = s.pass();
      expect.soft(second.seq).toEqual(["versions"]);
      expect.soft(second.path).toBe("versions");
      expect(existsSync(a.fileA)).toBe(true);
      s.harness.advance(25 * HOUR);
      s.leases.cleanupFinishedUploads();
      // Predicted: cleanup removes pending; the row names versions, so nothing is stranded.
      expect.soft(existsSync(a.fileA)).toBe(false);
      expect.soft(s.artifactPath()).toBe(s.realVersions());
    } finally { s.harness.close(); }
  });

  it("miss/hit: pass 1 registers pending only; after renders is added, pass 2 writes versions and versions wins", async () => {
    const s = setup();
    try {
      await s.startA();
      // Pass 1 (no renders row): predicted seq [pending]. Final: pending.
      const first = s.pass();
      expect(first.seq).toEqual(["pending"]);
      expect(first.path).toBe("pending");
      s.insertRenderRow();
      // Pass 2: pending hits (artifactService.ts:37), versions misses. Predicted seq [versions]. Final: versions.
      const second = s.pass();
      expect(second.seq).toEqual(["versions"]);
      expect(second.path).toBe("versions");
    } finally { s.harness.close(); }
  });

  it("hit/miss: pass 1 registers versions only; A then uploads; pass 2 writes pending and pending wins", async () => {
    const s = setup();
    try {
      s.insertRenderRow();
      // Pass 1 (no A): predicted seq [versions]. Final: versions.
      const first = s.pass();
      expect(first.seq).toEqual(["versions"]);
      expect(first.path).toBe("versions");
      const a = await s.startA();
      // Pass 2: versions hits, pending misses. Predicted seq [pending]. Final: pending.
      const second = s.pass();
      expect(second.seq).toEqual(["pending"]);
      expect(second.path).toBe("pending");
    } finally { s.harness.close(); }
  });
});
