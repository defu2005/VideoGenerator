import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileGc } from "../src/storage/fileGc.js";
import { projectDir } from "../src/storage/paths.js";
import { createPipelineHarness } from "./pipelineFixtures.js";

const day = 86_400_000;

// Production layout (leaseService.ts:140): projects/<id>/render/pending/<jobId>.uploads/<file>.
// The GC walks render/pending and treats it as ephemeral: the mark lasts one day, not graceDays.
// A node_uploads row protects its file only while its job is RUNNING or QUEUED (references.ts:125 and :508).
function setup() {
  const harness = createPipelineHarness();
  harness.sqlite.pragma("foreign_keys = OFF");
  const root = harness.config.DATA_DIR;
  const gc = new FileGc(harness.sqlite, root, () => ({ graceDays: 14, postPublishDays: 7 }), harness.clock);
  const renderDir = join(projectDir(root, harness.projectId), "render");
  const create = (jobId: string, name: string) => {
    const dir = join(renderDir, "pending", `${jobId}.uploads`);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, name);
    writeFileSync(path, "pending upload");
    return path;
  };
  const insertJob = (jobId: string, status: string) => {
    const now = harness.clock().toISOString();
    harness.sqlite.prepare(
      "INSERT INTO jobs (id, project_id, stage, status, progress, attempt, max_attempts, created_at, run_after, previous_state) VALUES (?, ?, ?, ?, 0, 1, 3, ?, ?, ?)")
      .run(jobId, harness.projectId, "SCRIPT", status, now, now, "PENDING");
  };
  const insertUpload = (jobId: string, path: string) => {
    const now = harness.clock().toISOString();
    harness.sqlite.prepare(
      "INSERT INTO node_uploads (job_id, lease_id, name, sha256, size, path, received_bytes, status, created_at) VALUES (?, ?, ?, ?, 4, ?, 4, ?, ?)")
      .run(jobId, "lease", "upload.bin", "a".repeat(64), path, "ready", now);
  };
  return { harness, gc, create, insertJob, insertUpload };
}

describe("file GC: render/pending uploads", () => {
  it("A: collects an unreferenced pending upload after the one-day ephemeral grace, not graceDays", () => {
    const { harness, gc, create } = setup();
    try {
      const orphan = create("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", "orphan.bin");
      expect(gc.run()).toMatchObject({ marked: 1 });
      harness.advance(day / 2);
      expect(gc.run({ purge: true })).toMatchObject({ purged: 0 });
      expect(existsSync(orphan)).toBe(true);
      harness.advance(2 * day);
      expect(gc.run({ purge: true })).toMatchObject({ purged: 1 });
      expect(existsSync(orphan)).toBe(false);
    } finally { harness.close(); }
  });

  it("B (control): keeps a pending upload that a RUNNING job still references", () => {
    // The project is busy here, so references.ts:96 protects the whole project directory. This case
    // does not isolate the :125 rule; case C does.
    const { harness, gc, create, insertJob, insertUpload } = setup();
    try {
      const jobId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
      const held = create(jobId, "held.bin");
      insertJob(jobId, "RUNNING");
      insertUpload(jobId, held);
      expect(gc.run()).toMatchObject({ marked: 0 });
      harness.advance(2 * day);
      expect(gc.run({ purge: true })).toMatchObject({ purged: 0 });
      expect(existsSync(held)).toBe(true);
    } finally { harness.close(); }
  });

  it("C: a DONE job's node_uploads row does not keep a pending upload alive", () => {
    const { harness, gc, create, insertJob, insertUpload } = setup();
    try {
      const jobId = "cccccccc-cccc-4ccc-8ccc-cccccccccc02";
      const stale = create(jobId, "stale.bin");
      insertJob(jobId, "DONE");
      insertUpload(jobId, stale);
      expect(gc.run()).toMatchObject({ marked: 1 });
      harness.advance(2 * day);
      expect(gc.run({ purge: true })).toMatchObject({ purged: 1 });
      expect(existsSync(stale)).toBe(false);
    } finally { harness.close(); }
  });

  it("D: a DONE job's node_uploads row added after the mark does not block the purge", () => {
    // The row arrives after the mark. The purge-time index (DbReferenceIndex.build, references.ts:508) must still allow the purge.
    const { harness, gc, create, insertJob, insertUpload } = setup();
    try {
      const jobId = "dddddddd-dddd-4ddd-8ddd-dddddddddd03";
      const late = create(jobId, "late.bin");
      expect(gc.run()).toMatchObject({ marked: 1 });
      insertJob(jobId, "DONE");
      insertUpload(jobId, late);
      harness.advance(2 * day);
      expect(gc.run({ purge: true })).toMatchObject({ purged: 1 });
      expect(existsSync(late)).toBe(false);
    } finally { harness.close(); }
  });
});
