import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { ArtifactService } from "../src/node/artifactService.js";
import { LeaseService, type RenderPort } from "../src/node/leaseService.js";
import { NodeService } from "../src/node/nodeService.js";
import { FileGc } from "../src/storage/fileGc.js";
import { projectDir } from "../src/storage/paths.js";
import { createPipelineHarness } from "./pipelineFixtures.js";

// TASK-160: hand-off from cleanupFinishedUploads() (leaseService.ts:424-437) to the file GC.
// Cleanup deletes a row and its file only on the strict path; every other branch either keeps both
// or drops the row and leaves the file on disk. The GC then decides what happens to the leftover file.
// Everything lives under the pipeline harness DATA_DIR, which is removed on close.

const day = 86_400_000;
const HOUR = 3_600_000;
const JOB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const LEASE = "11111111-2222-4333-8444-555555555555";
const NAME = "final.mp4";

function setup() {
  const harness = createPipelineHarness();
  harness.sqlite.pragma("foreign_keys = OFF");
  const root = harness.config.DATA_DIR;
  // Same layout as renderService.ts:289-290, so the GC walks the directory cleanup writes to.
  const renderDirFor = (projectId: string) => join(projectDir(root, projectId), "render");
  const nodes = new NodeService(harness.sqlite, harness.config, harness.repository, harness.orchestrator, harness.clock);
  const artifacts = new ArtifactService(harness.sqlite, harness.clock);
  const renders: RenderPort = {
    renderDir: renderDirFor,
    versionDir: (projectId, renderId) => join(renderDirFor(projectId), "versions", renderId),
    prepare: async () => { throw new Error("no render in this test"); },
    finalize: async () => ({ render: { id: "r" } as never, reused: false }),
  };
  const leases = new LeaseService(
    harness.sqlite, harness.config, harness.repository, harness.orchestrator, nodes, renders, artifacts,
    async () => ({ message: "unused" }), harness.clock,
  );
  const gc = new FileGc(harness.sqlite, root, () => ({ graceDays: 14, postPublishDays: 7 }), harness.clock);
  const pendingDir = join(renderDirFor(harness.projectId), "pending", `${JOB}.uploads`);

  const ago = (hours: number) => new Date(harness.clock().getTime() - hours * HOUR).toISOString();

  function insertJob(status: string, finishedAt: string) {
    const now = harness.clock().toISOString();
    harness.sqlite.prepare(
      "INSERT INTO jobs (id, project_id, stage, status, progress, attempt, max_attempts, created_at, run_after, previous_state, finished_at, finalizing_at) VALUES (?, ?, ?, ?, 0, 1, 3, ?, ?, ?, ?, NULL)")
      .run(JOB, harness.projectId, "SCRIPT", status, now, now, "PENDING", finishedAt);
  }

  function insertUpload(lease: string, path: string) {
    const now = harness.clock().toISOString();
    harness.sqlite.prepare(
      "INSERT INTO node_uploads (job_id, lease_id, name, sha256, size, path, received_bytes, status, created_at) VALUES (?, ?, ?, ?, 4, ?, 4, 'ready', ?)")
      .run(JOB, lease, NAME, "a".repeat(64), path, now);
  }

  function writeFile(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "upload bytes");
  }

  const rowCount = () => (harness.sqlite.prepare("SELECT COUNT(*) AS n FROM node_uploads").get() as { n: number }).n;

  return { harness, leases, gc, pendingDir, ago, insertJob, insertUpload, writeFile, rowCount };
}

describe("TASK-160: cleanup to GC hand-off for render/pending uploads", () => {
  it("H1: a UUID-lease upload at the computed path is removed with its row, and GC has nothing left to mark", () => {
    const s = setup();
    try {
      expect(s.gc.run()).toMatchObject({ marked: 0 });
      const file = join(s.pendingDir, LEASE, NAME);
      s.insertJob("SUCCEEDED", s.ago(25));
      s.writeFile(file);
      s.insertUpload(LEASE, file);

      s.leases.cleanupFinishedUploads();
      expect(existsSync(file)).toBe(false);
      expect(s.rowCount()).toBe(0);

      expect(s.gc.run()).toMatchObject({ marked: 0 });
      s.harness.advance(2 * day);
      expect(s.gc.run({ purge: true })).toMatchObject({ purged: 0 });
      s.leases.cleanupFinishedUploads();
      expect(s.rowCount()).toBe(0);
    } finally { s.harness.close(); }
  });

  it("H2 (synthetic): a row dropped by the non-UUID branch leaves its file, which GC marks and purges once the one-day ephemeral grace passes", () => {
    // Server-minted leases are randomUUID() (leaseService.ts:245, :367), so this lease id never reaches production.
    // This test exercises the UUID clause only. A linked row also keeps its file, through the status clause (not this test).
    // A linked row's path is the artifact's, and that path can sit under pending/ (TASK-161).
    const s = setup();
    try {
      expect(s.gc.run()).toMatchObject({ marked: 0 });
      const lease = "not-a-uuid";
      const file = join(s.pendingDir, lease, NAME);
      s.insertJob("SUCCEEDED", s.ago(25));
      s.writeFile(file);
      s.insertUpload(lease, file);

      s.leases.cleanupFinishedUploads();
      expect(s.rowCount()).toBe(0);
      expect(existsSync(file)).toBe(true);

      expect(s.gc.run()).toMatchObject({ marked: 1 });
      s.harness.advance(day / 2);
      expect(s.gc.run({ purge: true })).toMatchObject({ purged: 0 });
      expect(existsSync(file)).toBe(true);
      s.harness.advance(2 * day);
      expect(s.gc.run({ purge: true })).toMatchObject({ purged: 1 });
      expect(existsSync(file)).toBe(false);
    } finally { s.harness.close(); }
  });

  it("H3: a row whose path differs from the computed one keeps row and file in cleanup; GC purges the file and the row survives", () => {
    // Pinned as current behaviour. A row that survives its file is TASK-157 finding 1 extended; it is not a fix.
    // Synthetic: no write site in apps/server/src produces a non-linked row whose path differs from outputPath() (TASK-161 §1).
    const s = setup();
    try {
      expect(s.gc.run()).toMatchObject({ marked: 0 });
      const rowPath = join(s.pendingDir, "other-lease", NAME);
      s.insertJob("SUCCEEDED", s.ago(25));
      s.writeFile(rowPath);
      s.insertUpload(LEASE, rowPath);

      s.leases.cleanupFinishedUploads();
      expect(existsSync(rowPath)).toBe(true);
      expect(s.rowCount()).toBe(1);

      s.leases.cleanupFinishedUploads();
      expect(existsSync(rowPath)).toBe(true);
      expect(s.rowCount()).toBe(1);

      expect(s.gc.run()).toMatchObject({ marked: 1 });
      s.harness.advance(2 * day);
      expect(s.gc.run({ purge: true })).toMatchObject({ purged: 1 });
      expect(existsSync(rowPath)).toBe(false);
      expect(s.rowCount()).toBe(1);
    } finally { s.harness.close(); }
  });
});
