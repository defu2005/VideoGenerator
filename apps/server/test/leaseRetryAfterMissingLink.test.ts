import { createHash } from "node:crypto";
import { existsSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { readAppVersion } from "../src/render/appVersion.js";
import { ArtifactService } from "../src/node/artifactService.js";
import { LeaseService, type RenderPort } from "../src/node/leaseService.js";
import { NodeService, type NodeRow } from "../src/node/nodeService.js";
import { FileGc } from "../src/storage/fileGc.js";
import { projectDir } from "../src/storage/paths.js";
import { createPipelineHarness } from "./pipelineFixtures.js";

// TASK-163: what job B does after its complete fails with the raw ENOENT measured in TASK-162.
// Two ways B leaves the failed lease: (1) the node posts a retryable /fail (agent.ts:807-811), or
// (2) no /fail arrives and the lease lapses, so the real node sweep runs (nodeService.ts:340-372).
// Both go through the real methods. No UPDATE on jobs and no hand-inserted rows.
//
// Fixture, not production: remoteBundle is mocked, the render port is a stub, and the file removal
// that reaches B's ENOENT is a fabricated direct unlink (rmSync), since TASK-166 cleanup keeps a file
// an unfinished job links. Heartbeats are fabricated timing. Production uses the real agent and real timing.

vi.mock("../src/node/remoteBundle.js", () => ({
  RemoteBundleError: class RemoteBundleError extends Error {},
  logicalName: (sha: string) => sha,
  buildRemoteBundle: async () => ({ bundle: { bundleVersion: 1, renderId: "render-1" }, files: [] }),
}));

const VIDEO = "video bytes";
const REPORT = JSON.stringify({ clipsReused: 0, clipsRendered: 1, graphicShots: [], composeWarnings: [], joinWarnings: [] });
const RESOURCES = { cpus: 2, ramMb: 4096, freeDiskMb: 50_000 };

function sha(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function setup() {
  const harness = createPipelineHarness();
  const dataDir = harness.config.DATA_DIR;
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

  const pendingFile = (jobId: string, leaseId: string) =>
    join(renderDirFor(harness.projectId), "pending", `${jobId}.uploads`, leaseId, "final.mp4");
  const pendingJson = (jobId: string) => join(renderDirFor(harness.projectId), "pending", `${jobId}.json`);

  const rowsFor = (jobId: string, leaseId: string) => harness.sqlite.prepare(
    "SELECT name, status, path FROM node_uploads WHERE job_id = ? AND lease_id = ? ORDER BY name").all(jobId, leaseId) as Array<{ name: string; status: string; path: string }>;
  const statusesFor = (jobId: string, leaseId: string) => rowsFor(jobId, leaseId).map((row) => [row.name, row.status]);

  const artifactPath = (digest: string) => (harness.sqlite.prepare(
    "SELECT path FROM artifacts WHERE sha256 = ?").get(digest) as { path: string } | undefined)?.path;

  const leaseOf = (jobId: string) => (harness.sqlite.prepare(
    "SELECT lease_id AS l, finalizing_at AS f FROM jobs WHERE id = ?").get(jobId) as { l: string | null; f: string | null });

  const renew = (row: NodeRow, jobId: string, leaseId: string) => nodes.heartbeat(row, {
    version: readAppVersion(), capabilities: ["render"], resources: RESOURCES,
    running: [{ jobId, leaseId, progress: 10 }],
  });
  // Keeps the node online without holding a job (used before a re-lease).
  const beat = (row: NodeRow) => nodes.heartbeat(row, {
    version: readAppVersion(), capabilities: ["render"], resources: RESOURCES, running: [],
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
    harness, nodes, leases, gc, finalize, joinNode, queueRender, pendingFile, pendingJson, rowsFor, statusesFor,
    artifactPath, leaseOf, renew, beat, completeBody, uploadBoth,
  };
}

async function completeA(s: ReturnType<typeof setup>) {
  const rowA = s.joinNode("may-1");
  const jobA = s.queueRender();
  const leaseA = (await s.leases.lease(rowA, 1))!;
  await s.uploadBoth(rowA, jobA.id, leaseA.leaseId);
  const fileA = s.pendingFile(jobA.id, leaseA.leaseId);
  expect(s.gc.run({ purge: true, ephemeralOnly: true })).toMatchObject({ marked: 0, purged: 0 });
  await s.leases.complete(rowA, jobA.id, s.completeBody(leaseA.leaseId));
  expect(s.harness.repository.getJob(jobA.id)!.status).toBe("SUCCEEDED");
  return { fileA };
}

/** The TASK-162 chain up to B's complete failure (LINKED_FILE_MISSING, TASK-167). B keeps its lease (renewed) and the linked row. */
async function reachEnoent(s: ReturnType<typeof setup>) {
  const { fileA } = await completeA(s);
  const realA = realpathSync.native(fileA);
  const rowB = s.joinNode("may-2");
  const jobB = s.queueRender();
  const leaseB = (await s.leases.lease(rowB, 1))!;
  expect(s.leases.haveOutputs(rowB, jobB.id, leaseB.leaseId, [{ name: "final.mp4", sha256: sha(VIDEO), size: Buffer.byteLength(VIDEO) }]))
    .toEqual(["final.mp4"]);
  await s.leases.receiveOutput(rowB, jobB.id, leaseB.leaseId, "report.json", sha(REPORT), Readable.from([Buffer.from(REPORT)]));
  // Fabricated: the file is unlinked directly to reach B's ENOENT. Since TASK-166 cleanup keeps a file that
  // an unfinished job links, so the removal the chain needs no longer happens on its own.
  rmSync(fileA, { force: true });
  expect(existsSync(fileA)).toBe(false);
  s.renew(rowB, jobB.id, leaseB.leaseId);
  const error = await s.leases.complete(rowB, jobB.id, s.completeBody(leaseB.leaseId)).then(() => undefined, (e: unknown) => e);
  expect(error).toMatchObject({ statusCode: 422, code: "LINKED_FILE_MISSING" });
  expect(s.harness.repository.getJob(jobB.id)!.status).toBe("RUNNING");
  expect(existsSync(s.pendingJson(jobB.id))).toBe(true);
  return { realA, rowB, jobB, leaseB };
}

describe("TASK-163: job B after its complete fails with LINKED_FILE_MISSING, 422 (TASK-167; TASK-162 chain); fail and sweep go through real methods, file removal is a direct unlink", () => {
  it("fail path: a retryable /fail re-queues B with the base backoff; a re-lease uploads fresh bytes and completes", async () => {
    const s = setup();
    try {
      const { realA, rowB, jobB, leaseB } = await reachEnoent(s);
      const pendingBefore = s.harness.config.JOB_RETRY_BASE_MS;

      // agent.ts:807-811: a failed complete becomes a retryable /fail carrying the lease.
      s.leases.fail(rowB, jobB.id, { leaseId: leaseB.leaseId, code: "NODE_RENDER_FAILED", message: "complete 500", retryable: true });
      const queued = s.harness.repository.getJob(jobB.id)!;
      expect(queued.status).toBe("QUEUED");
      expect(queued.attempt).toBe(2);
      expect(queued.runAfter).toBe(new Date(s.harness.clock().getTime() + pendingBefore).toISOString());
      expect(s.leaseOf(jobB.id)).toEqual({ l: null, f: null });
      expect(existsSync(s.pendingJson(jobB.id))).toBe(false);
      // The old lease's rows are not deleted by the fail path.
      expect(s.statusesFor(jobB.id, leaseB.leaseId)).toEqual([["final.mp4", "linked"], ["report.json", "ready"]]);

      // Re-lease after the backoff, on a fresh UUID.
      s.harness.advance(pendingBefore + 1);
      s.beat(rowB);
      const leaseB2 = (await s.leases.lease(rowB, 1))!;
      expect(leaseB2.leaseId).not.toBe(leaseB.leaseId);
      expect(s.leaseOf(jobB.id).l).toBe(leaseB2.leaseId);

      // The stale artifacts row points at the deleted file, so the new lease cannot link it.
      expect(s.artifactPath(sha(VIDEO))).toBe(realA);
      expect(existsSync(realA)).toBe(false);
      expect(s.leases.haveOutputs(rowB, jobB.id, leaseB2.leaseId, [{ name: "final.mp4", sha256: sha(VIDEO), size: Buffer.byteLength(VIDEO) }]))
        .toEqual([]);

      // Fresh bytes under the new lease, then complete.
      await s.uploadBoth(rowB, jobB.id, leaseB2.leaseId);
      expect(s.statusesFor(jobB.id, leaseB2.leaseId)).toEqual([["final.mp4", "ready"], ["report.json", "ready"]]);
      await s.leases.complete(rowB, jobB.id, s.completeBody(leaseB2.leaseId));
      expect(s.finalize).toHaveBeenCalledTimes(2);
      expect(s.harness.repository.getJob(jobB.id)!.status).toBe("SUCCEEDED");
      // The old lease's rows survive; the stale artifacts row is not refreshed by the fresh upload.
      expect(s.statusesFor(jobB.id, leaseB.leaseId)).toEqual([["final.mp4", "linked"], ["report.json", "ready"]]);
      expect(s.artifactPath(sha(VIDEO))).toBe(realA);
    } finally { s.harness.close(); }
  });

  it("expiry path: with no /fail, the real node sweep lapses B's lease as NODE_LOST (retryable) and re-queues it", async () => {
    const s = setup();
    try {
      const { rowB, jobB, leaseB } = await reachEnoent(s);
      // No /fail and no heartbeat: advance past the lease, then run the real sweep.
      s.harness.advance(s.harness.config.NODE_LEASE_SEC * 1000 + 1000);
      s.nodes.sweep();
      const lost = s.harness.repository.getJob(jobB.id)!;
      expect(lost.status).toBe("QUEUED");
      expect(lost.attempt).toBe(2);
      expect(lost.error?.code).toBe("NODE_LOST");
      expect(lost.error?.retryable).toBe(true);
      expect(s.leaseOf(jobB.id)).toEqual({ l: null, f: null });
      expect(existsSync(s.pendingJson(jobB.id))).toBe(false);
      expect(s.statusesFor(jobB.id, leaseB.leaseId)).toEqual([["final.mp4", "linked"], ["report.json", "ready"]]);
      void rowB;
    } finally { s.harness.close(); }
  });

  // TASK-164: the last attempt. Expectations written before the first run.
  it("last attempt: a retryable /fail on attempt 3 of 3 makes B FAILED, not re-queued", async () => {
    const s = setup();
    try {
      const { fileA } = await completeA(s);
      const rowB = s.joinNode("may-2");
      const jobB = s.queueRender();
      const backoff = (attempt: number) => s.harness.config.JOB_RETRY_BASE_MS * 2 ** (attempt - 1);
      const failRetryable = (leaseId: string) => s.leases.fail(rowB, jobB.id, {
        leaseId, code: "NODE_RENDER_FAILED", message: "complete 500", retryable: true,
      });

      // Attempt 1 and attempt 2: lease, then a retryable /fail. No haveOutputs, so no link is made.
      const lease1 = (await s.leases.lease(rowB, 1))!;
      failRetryable(lease1.leaseId);
      expect(s.harness.repository.getJob(jobB.id)!.attempt).toBe(2);
      s.harness.advance(backoff(1) + 1);
      s.beat(rowB);
      const lease2 = (await s.leases.lease(rowB, 1))!;
      failRetryable(lease2.leaseId);
      expect(s.harness.repository.getJob(jobB.id)!.status).toBe("QUEUED");
      expect(s.harness.repository.getJob(jobB.id)!.attempt).toBe(3);

      // Attempt 3 of 3: the chain from TASK-162/163 runs on the last lease.
      s.harness.advance(backoff(2) + 1);
      s.beat(rowB);
      const lease3 = (await s.leases.lease(rowB, 1))!;
      expect(s.harness.repository.getJob(jobB.id)!.attempt).toBe(3);
      expect(s.leases.haveOutputs(rowB, jobB.id, lease3.leaseId, [{ name: "final.mp4", sha256: sha(VIDEO), size: Buffer.byteLength(VIDEO) }]))
        .toEqual(["final.mp4"]);
      await s.leases.receiveOutput(rowB, jobB.id, lease3.leaseId, "report.json", sha(REPORT), Readable.from([Buffer.from(REPORT)]));
      // Fabricated: direct unlink, as in reachEnoent (TASK-166 cleanup keeps a file an unfinished job links).
      rmSync(fileA, { force: true });
      expect(existsSync(fileA)).toBe(false);
      s.renew(rowB, jobB.id, lease3.leaseId);
      const error = await s.leases.complete(rowB, jobB.id, s.completeBody(lease3.leaseId)).then(() => undefined, (e: unknown) => e);
      expect(error).toMatchObject({ statusCode: 422, code: "LINKED_FILE_MISSING" });
      expect(existsSync(s.pendingJson(jobB.id))).toBe(true);

      // agent.ts:807-811 posts the retryable /fail on the last attempt: it must be terminal.
      failRetryable(lease3.leaseId);
      const failed = s.harness.repository.getJob(jobB.id)!;
      expect(failed.status).toBe("FAILED");
      expect(failed.attempt).toBe(3);
      expect(failed.error?.code).toBe("NODE_RENDER_FAILED");
      expect(failed.finishedAt).toBeTruthy();
      expect(s.leaseOf(jobB.id)).toEqual({ l: null, f: null });
      expect(existsSync(s.pendingJson(jobB.id))).toBe(false);
      expect(s.finalize).toHaveBeenCalledTimes(1);
    } finally { s.harness.close(); }
  });
});
