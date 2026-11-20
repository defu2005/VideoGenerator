import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ArtifactService } from "../src/node/artifactService.js";
import { LeaseService, type RenderPort } from "../src/node/leaseService.js";
import { NodeService } from "../src/node/nodeService.js";
import { createPipelineHarness } from "./pipelineFixtures.js";

// TASK-157: cleanupFinishedUploads() removes the file and the row of a finished job's upload,
// but only when the job is terminal, not finalizing, older than 24 h, not linked, and the row's path is the computed one.
// Every path lives under a fresh mkdtemp root inside the OS temp dir; nothing touches data/ or data-dev/.

const HOUR = 3_600_000;
const JOB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const LEASE = "11111111-2222-4333-8444-555555555555";
const NAME = "final.mp4";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
});

function setup() {
  const harness = createPipelineHarness();
  const root = mkdtempSync(join(tmpdir(), "vg-lease-cleanup-"));
  cleanups.push(() => { harness.close(); rmSync(root, { recursive: true, force: true }); });
  const nodes = new NodeService(harness.sqlite, harness.config, harness.repository, harness.orchestrator, harness.clock);
  const artifacts = new ArtifactService(harness.sqlite, harness.clock);
  const renders: RenderPort = {
    renderDir: (projectId) => join(root, "render", projectId),
    versionDir: (projectId, renderId) => join(root, "render", projectId, "versions", renderId),
    prepare: async () => { throw new Error("no render in this test"); },
    finalize: async () => ({ render: { id: "r" } as never, reused: false }),
  };
  const leases = new LeaseService(
    harness.sqlite, harness.config, harness.repository, harness.orchestrator, nodes, renders, artifacts,
    async () => ({ message: "unused" }), harness.clock,
  );
  // The path cleanup computes for this job's upload, the same join the upload store uses.
  const computed = join(root, "render", harness.projectId, "pending", `${JOB}.uploads`, LEASE, NAME);

  function insertJob(status: string, finishedAt: string | null, finalizingAt: string | null) {
    const now = harness.clock().toISOString();
    harness.sqlite.pragma("foreign_keys = OFF");
    harness.sqlite.prepare(
      "INSERT INTO jobs (id, project_id, stage, status, progress, attempt, max_attempts, created_at, run_after, previous_state, finished_at, finalizing_at) VALUES (?, ?, ?, ?, 0, 1, 3, ?, ?, ?, ?, ?)")
      .run(JOB, harness.projectId, "SCRIPT", status, now, now, "PENDING", finishedAt, finalizingAt);
  }

  function insertUpload(path: string, status: string) {
    const now = harness.clock().toISOString();
    harness.sqlite.prepare(
      "INSERT INTO node_uploads (job_id, lease_id, name, sha256, size, path, received_bytes, status, created_at) VALUES (?, ?, ?, ?, 4, ?, 4, ?, ?)")
      .run(JOB, LEASE, NAME, "a".repeat(64), path, status, now);
  }

  function writeFile(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "upload bytes");
  }

  const ago = (hours: number) => new Date(harness.clock().getTime() - hours * HOUR).toISOString();
  const rowCount = () => (harness.sqlite.prepare("SELECT COUNT(*) AS n FROM node_uploads").get() as { n: number }).n;

  return { harness, root, leases, computed, insertJob, insertUpload, writeFile, ago, rowCount };
}

describe("TASK-157: cleanupFinishedUploads removes only what the rules allow", () => {
  it("removes the file and the row of an unlinked upload whose job finished more than 24 h ago", () => {
    const s = setup();
    s.insertJob("SUCCEEDED", s.ago(25), null);
    s.writeFile(s.computed);
    s.insertUpload(s.computed, "ready");

    s.leases.cleanupFinishedUploads();

    expect(existsSync(s.computed)).toBe(false);
    expect(s.rowCount()).toBe(0);
  });

  it("keeps the file and the row when the job finished 23 h ago", () => {
    const s = setup();
    s.insertJob("SUCCEEDED", s.ago(23), null);
    s.writeFile(s.computed);
    s.insertUpload(s.computed, "ready");

    s.leases.cleanupFinishedUploads();

    expect(existsSync(s.computed)).toBe(true);
    expect(s.rowCount()).toBe(1);
  });

  it("keeps the file and the row when the job is not terminal, even if finished_at is old", () => {
    const s = setup();
    s.insertJob("RUNNING", s.ago(25), null);
    s.writeFile(s.computed);
    s.insertUpload(s.computed, "ready");

    s.leases.cleanupFinishedUploads();

    expect(existsSync(s.computed)).toBe(true);
    expect(s.rowCount()).toBe(1);
  });

  it("keeps the file and the row when the job is still finalizing", () => {
    const s = setup();
    s.insertJob("SUCCEEDED", s.ago(25), s.ago(0));
    s.writeFile(s.computed);
    s.insertUpload(s.computed, "ready");

    s.leases.cleanupFinishedUploads();

    expect(existsSync(s.computed)).toBe(true);
    expect(s.rowCount()).toBe(1);
  });

  it("drops the row of a linked upload but leaves its file on disk", () => {
    const s = setup();
    s.insertJob("SUCCEEDED", s.ago(25), null);
    s.writeFile(s.computed);
    s.insertUpload(s.computed, "linked");

    s.leases.cleanupFinishedUploads();

    expect(existsSync(s.computed)).toBe(true);
    expect(s.rowCount()).toBe(0);
  });

  it("does not delete a file at the computed path when the row points somewhere else", () => {
    const s = setup();
    s.insertJob("SUCCEEDED", s.ago(25), null);
    s.writeFile(s.computed);
    s.insertUpload(join(s.root, "elsewhere", NAME), "ready");

    s.leases.cleanupFinishedUploads();

    expect(existsSync(s.computed)).toBe(true);
  });
});
