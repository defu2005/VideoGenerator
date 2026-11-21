import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { AppError } from "../src/lib/errors.js";
import { readAppVersion } from "../src/render/appVersion.js";
import { ArtifactService } from "../src/node/artifactService.js";
import { LeaseService, type RenderPort } from "../src/node/leaseService.js";
import { NodeService, type NodeRow } from "../src/node/nodeService.js";
import { FileGc } from "../src/storage/fileGc.js";
import { projectDir } from "../src/storage/paths.js";
import { createPipelineHarness } from "./pipelineFixtures.js";

// TASK-162: measures the chain in TASK-161 §5. A linked row's path sits under render/pending/
// of another job, and cleanup then removes that file while the linked row survives.
//
// Fixture, not production: the remoteBundle mock and the render stub are test doubles. The clock
// advance (25 h) and the lease kept alive by heartbeat are fabricated timing. This test shows the
// chain executes through the real methods. It does not show that the chain occurs in practice.
// Production order used here: A RUNNING -> GC run -> A complete -> B leased (RENDER_CONCURRENCY 1 is enough).

vi.mock("../src/node/remoteBundle.js", () => ({
  RemoteBundleError: class RemoteBundleError extends Error {},
  logicalName: (sha: string) => sha,
  buildRemoteBundle: async () => ({ bundle: { bundleVersion: 1, renderId: "render-1" }, files: [] }),
}));

const HOUR = 3_600_000;
const VIDEO = "video bytes";
const REPORT = JSON.stringify({ clipsReused: 0, clipsRendered: 1, graphicShots: [], composeWarnings: [], joinWarnings: [] });
const RESOURCES = { cpus: 2, ramMb: 4096, freeDiskMb: 50_000 };

function sha(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function setup() {
  const harness = createPipelineHarness();
  const dataDir = harness.config.DATA_DIR;
  // Same layout as renderService.ts:289-290, with the harness DATA_DIR as the GC root (as in TASK-160).
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

  function joinNode(name: string): NodeRow {
    const { token: joinToken } = nodes.createJoinToken(undefined);
    const joined = nodes.join({ joinToken, name, version: readAppVersion(), capabilities: ["render"], resources: RESOURCES });
    return nodes.authenticate(joined.nodeToken)!;
  }

  function queueRender() {
    return harness.repository.createJob({
      projectId: harness.projectId, stage: "RENDER", maxAttempts: 3, previousState: "PENDING", runAfter: harness.clock(),
    });
  }

  // Same shape as the file cleanup and finalize read: <pending>/<job>.uploads/<lease>/<name>.
  const pendingFile = (jobId: string, leaseId: string) =>
    join(renderDirFor(harness.projectId), "pending", `${jobId}.uploads`, leaseId, "final.mp4");

  const uploadRows = (jobId: string) => harness.sqlite.prepare(
    "SELECT name, status, path FROM node_uploads WHERE job_id = ? ORDER BY name").all(jobId) as Array<{ name: string; status: string; path: string }>;

  const artifactPath = (digest: string) => (harness.sqlite.prepare(
    "SELECT path FROM artifacts WHERE sha256 = ?").get(digest) as { path: string } | undefined)?.path;

  const renew = (row: NodeRow, jobId: string, leaseId: string) => nodes.heartbeat(row, {
    version: readAppVersion(), capabilities: ["render"], resources: RESOURCES,
    running: [{ jobId, leaseId, progress: 10 }],
  });

  const completeBody = (leaseId: string) => ({
    leaseId,
    outputs: [{ name: "final.mp4", sha256: sha(VIDEO) }, { name: "report.json", sha256: sha(REPORT) }],
  });

  async function uploadBoth(row: NodeRow, jobId: string, leaseId: string) {
    await leases.receiveOutput(row, jobId, leaseId, "final.mp4", sha(VIDEO), Readable.from([Buffer.from(VIDEO)]));
    await leases.receiveOutput(row, jobId, leaseId, "report.json", sha(REPORT), Readable.from([Buffer.from(REPORT)]));
  }

  return {
    harness, leases, gc, finalize, joinNode, queueRender, pendingFile, uploadRows, artifactPath, renew, completeBody, uploadBoth,
  };
}

// Runs job A to SUCCEEDED. With gcWhileRunning, a GC run happens while A is RUNNING, after its uploads.
async function completeA(s: ReturnType<typeof setup>, gcWhileRunning: boolean) {
  const rowA = s.joinNode("may-1");
  const jobA = s.queueRender();
  const leaseA = (await s.leases.lease(rowA, 1))!;
  await s.uploadBoth(rowA, jobA.id, leaseA.leaseId);
  const fileA = s.pendingFile(jobA.id, leaseA.leaseId);
  expect(existsSync(fileA)).toBe(true);
  if (gcWhileRunning) {
    // Scheduled shape from app.ts:801. Expected: nothing marked or purged, because A's pending file is referenced by an active row.
    expect(s.gc.run({ purge: true, ephemeralOnly: true })).toMatchObject({ marked: 0, purged: 0 });
  }
  await s.leases.complete(rowA, jobA.id, s.completeBody(leaseA.leaseId));
  expect(s.finalize).toHaveBeenCalledOnce();
  expect(s.harness.repository.getJob(jobA.id)!.status).toBe("SUCCEEDED");
  return { fileA, jobAId: jobA.id };
}

describe("TASK-162: linked row under render/pending (TASK-161 §5), measured through the real methods", () => {
  it("chain: GC while A RUNNING registers A's pending file; B links to it; cleanup removes it; B's complete fails with raw ENOENT", async () => {
    const s = setup();
    try {
      const { fileA, jobAId } = await completeA(s, true);

      // The artifacts row for the video sha points at A's pending file (real path, as references.ts:172 stores it).
      expect(s.artifactPath(sha(VIDEO))).toBe(realpathSync.native(fileA));

      // B is queued after A completes, leased on a second node, and reuses A's file through haveOutputs.
      const rowB = s.joinNode("may-2");
      const jobB = s.queueRender();
      const leaseB = (await s.leases.lease(rowB, 1))!;
      expect(s.harness.repository.getJobLease(jobB.id)!.leaseId).toBe(leaseB.leaseId);
      expect(s.leases.haveOutputs(rowB, jobB.id, leaseB.leaseId, [{ name: "final.mp4", sha256: sha(VIDEO), size: Buffer.byteLength(VIDEO) }]))
        .toEqual(["final.mp4"]);
      expect(s.uploadRows(jobB.id)).toEqual([{ name: "final.mp4", status: "linked", path: realpathSync.native(fileA) }]);

      // Upload B's report.json for real, so only final.mp4 is linked.
      await s.leases.receiveOutput(rowB, jobB.id, leaseB.leaseId, "report.json", sha(REPORT), Readable.from([Buffer.from(REPORT)]));

      // B's linked path, captured before cleanup, to compare with the error path later.
      const linkedPathB = s.uploadRows(jobB.id)[0]!.path;
      expect(linkedPathB).toBe(realpathSync.native(fileA));

      // Fabricated timing: 25 h passes. Cleanup should delete A's row and file (strict branch), and leave B's linked row.
      s.harness.advance(25 * HOUR);
      expect(existsSync(fileA)).toBe(true);
      s.leases.cleanupFinishedUploads();
      expect(existsSync(fileA)).toBe(false);
      expect(s.uploadRows(jobAId)).toEqual([]);
      expect(s.uploadRows(jobB.id).map((row) => [row.name, row.status])).toEqual([["final.mp4", "linked"], ["report.json", "ready"]]);

      // Fabricated: B's lease kept alive by the real heartbeat path, so the 'live' holding check passes.
      s.renew(rowB, jobB.id, leaseB.leaseId);
      expect(new Date(s.harness.repository.getJobLease(jobB.id)!.leaseUntil).getTime()).toBeGreaterThan(s.harness.clock().getTime());

      // Expected: B's complete reads the linked record at leaseService.ts:620 and throws the raw ENOENT.
      const error = await s.leases.complete(rowB, jobB.id, s.completeBody(leaseB.leaseId)).then(() => undefined, (e: unknown) => e);
      expect(error).toMatchObject({ code: "ENOENT", path: linkedPathB });
      expect(error).not.toBeInstanceOf(AppError);
      // finalizing_at NULL: the throw came before claimFinalization, i.e. from the linked-record loop, not after a claim.
      expect(s.harness.sqlite.prepare("SELECT finalizing_at FROM jobs WHERE id = ?").get(jobB.id)).toEqual({ finalizing_at: null });
      expect(s.finalize).toHaveBeenCalledOnce();
      expect(s.harness.repository.getJob(jobB.id)!.status).toBe("RUNNING");
      expect(s.uploadRows(jobB.id).map((row) => [row.name, row.status])).toEqual([["final.mp4", "linked"], ["report.json", "ready"]]);
    } finally { s.harness.close(); }
  });

  it("control: the same flow without a GC run links nothing, so B must upload the bytes", async () => {
    const s = setup();
    try {
      await completeA(s, false);
      expect(s.artifactPath(sha(VIDEO))).toBeUndefined();

      const rowB = s.joinNode("may-2");
      const jobB = s.queueRender();
      const leaseB = (await s.leases.lease(rowB, 1))!;
      expect(s.leases.haveOutputs(rowB, jobB.id, leaseB.leaseId, [{ name: "final.mp4", sha256: sha(VIDEO), size: Buffer.byteLength(VIDEO) }]))
        .toEqual([]);
      expect(s.uploadRows(jobB.id).filter((row) => row.status === "linked")).toEqual([]);
    } finally { s.harness.close(); }
  });
});
