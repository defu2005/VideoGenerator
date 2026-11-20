import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileGc } from "../src/storage/fileGc.js";
import { projectDir } from "../src/storage/paths.js";
import { DbReferenceIndex, isTargetReferencedInDb } from "../src/storage/references.js";
import { ArtifactService } from "../src/node/artifactService.js";
import { blobKey, S3StorageProvider } from "../src/storage/provider.js";
import { BlobStore } from "../src/storage/blobStore.js";
import { createPipelineHarness } from "./pipelineFixtures.js";
import { PROTECTED_PROJECT_ID } from "../src/supervision/escalations.js";

const day = 86_400_000;

function setup() {
  const harness = createPipelineHarness();
  const root = harness.config.DATA_DIR;
  const project = projectDir(root, harness.projectId);
  const gc = new FileGc(harness.sqlite, root, () => ({ graceDays: 14, postPublishDays: 7 }), harness.clock);
  const create = (path: string, body = "fixture file") => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body);
    return path;
  };
  const referenceFile = (db: Database.Database, path: string) => {
    const now = harness.clock().toISOString();
    db.prepare(`INSERT INTO timelines(project_id,data,input_hash,total_duration_sec,created_at,updated_at)
      VALUES (?,?,?,1,?,?) ON CONFLICT(project_id) DO UPDATE SET data=excluded.data`)
      .run(harness.projectId, JSON.stringify({ scenes: [{ visuals: [{ path }] }] }), "fixture", now, now);
  };
  return { harness, root, project, gc, create, referenceFile };
}

afterEach(() => { vi.restoreAllMocks(); });

describe("TASK-138 fix3: purge uses one DB reference index per run", () => {
  it.each([3, 30])("builds the DB index once for %i candidates", (count) => {
    const { harness, project, gc, create } = setup();
    try {
      for (let i = 0; i < count; i++) create(join(project, "preview", `old-${i}.jpg`), `content ${i}`);
      expect(gc.run()).toMatchObject({ marked: count });
      harness.advance(15 * day);
      const build = vi.spyOn(DbReferenceIndex.prototype as unknown as { build: () => void }, "build");
      const res = gc.run({ purge: true });
      expect(res.purged).toBe(count);
      expect(build).toHaveBeenCalledTimes(1);
    } finally { harness.close(); }
  });

  it("hashes a local purge candidate before the write transaction opens", () => {
    const { harness, project, gc, create } = setup();
    try {
      const file = create(join(project, "preview", "hash-outside.jpg"), "hash me");
      expect(gc.run()).toMatchObject({ marked: 1 });
      harness.advance(15 * day);
      const seen: boolean[] = [];
      const real = ArtifactService.prototype.registerSync;
      vi.spyOn(ArtifactService.prototype, "registerSync").mockImplementation(function (this: ArtifactService, path: string) {
        if (path.endsWith("hash-outside.jpg")) seen.push(harness.sqlite.inTransaction);
        return real.call(this, path);
      });
      expect(gc.run({ purge: true })).toMatchObject({ purged: 1 });
      // The first registerSync for this file runs outside the lock; the in-lock call is a cache hit.
      expect(seen.length).toBeGreaterThan(0);
      expect(seen[0]).toBe(false);
    } finally { harness.close(); }
  });

  it("keeps a file whose reference was committed by a second connection after the graph was built", () => {
    const { harness, project, root, gc, create, referenceFile } = setup();
    const second = new Database(harness.config.DATABASE_PATH);
    try {
      const file = create(join(project, "visuals", "late.jpg"));
      expect(gc.run()).toMatchObject({ marked: 1 });
      harness.advance(15 * day);
      // Commit the reference after the graph is built and before the purge transaction takes the lock.
      const realTransaction = harness.sqlite.transaction;
      let injected = false;
      harness.sqlite.transaction = function (fn: (...args: unknown[]) => unknown) {
        const wrapped = realTransaction.call(harness.sqlite, fn);
        return Object.assign((...args: unknown[]) => wrapped(...args), {
          immediate: (...args: unknown[]) => {
            if (!injected) { injected = true; referenceFile(second, file); }
            return wrapped.immediate(...args);
          },
        });
      } as typeof harness.sqlite.transaction;
      const res = gc.run({ purge: true });
      harness.sqlite.transaction = realTransaction;
      expect(injected).toBe(true);
      expect(res.purged).toBe(0);
      expect(existsSync(file)).toBe(true);
    } finally { second.close(); harness.close(); }
  });

  it("rebuilds a warm index when another connection commits between two purges", () => {
    const { harness, project, gc, create, referenceFile } = setup();
    const second = new Database(harness.config.DATABASE_PATH);
    const realTransaction = harness.sqlite.transaction;
    try {
      const first = create(join(project, "preview", "a.jpg"));
      const kept = create(join(project, "preview", "b.jpg"));
      expect(gc.run()).toMatchObject({ marked: 2 });
      harness.advance(15 * day);
      let immediates = 0;
      harness.sqlite.transaction = function (fn: (...args: unknown[]) => unknown) {
        const wrapped = realTransaction.call(harness.sqlite, fn);
        return Object.assign((...args: unknown[]) => wrapped(...args), {
          immediate: (...args: unknown[]) => {
            immediates++;
            // Second purge transaction: a reference to the second file lands from another connection.
            if (immediates === 2) referenceFile(second, kept);
            return wrapped.immediate(...args);
          },
        });
      } as typeof harness.sqlite.transaction;
      const build = vi.spyOn(DbReferenceIndex.prototype as unknown as { build: () => void }, "build");
      const res = gc.run({ purge: true });
      harness.sqlite.transaction = realTransaction;
      expect(existsSync(first)).toBe(false);
      expect(existsSync(kept)).toBe(true);
      expect(res.purged).toBe(1);
      expect(build).toHaveBeenCalledTimes(2);
    } finally {
      harness.sqlite.transaction = realTransaction;
      second.close();
      harness.close();
    }
  });

  it("answers the same as isTargetReferencedInDb for path and SHA targets", async () => {
    const { harness, project, root, create, referenceFile } = setup();
    try {
      const referenced = create(join(project, "visuals", "parity-ref.jpg"), "ref");
      const unreferenced = create(join(project, "visuals", "parity-free.jpg"), "free");
      const protectedFile = create(join(root, "projects", harness.projectId, "render", "versions", "x", "out.mp4"), "v");
      const refArtifact = await new ArtifactService(harness.sqlite).register(referenced);
      const freeArtifact = await new ArtifactService(harness.sqlite).register(unreferenced);
      referenceFile(harness.sqlite, referenced);
      const index = new DbReferenceIndex(harness.sqlite, root, { now: harness.clock() });
      index.refresh();
      const cases: Array<{ path?: string; sha256?: string }> = [
        { path: referenced }, { path: unreferenced }, { path: protectedFile },
        { sha256: refArtifact.sha256 }, { sha256: freeArtifact.sha256 }, {},
        // Oracle branches not covered above (from isTargetReferencedInDb):
        { sha256: "0".repeat(64) },                                  // unknown SHA: no artifact path, no match
        { path: join(root, "projects", "missing-file.jpg") },        // missing file, not in artifacts table
        { path: join(root, "..", "outside-the-data-dir.jpg") },      // outside the data directory
        { path: join(root, "projects", PROTECTED_PROJECT_ID, "x.jpg") }, // protected project tree: oracle returns true
      ];
      // Protection branches must say true on the oracle side too, not merely agree with the index.
      for (const target of [{}, { path: join(root, "projects", PROTECTED_PROJECT_ID, "x.jpg") }]) {
        expect(isTargetReferencedInDb(harness.sqlite, root, target, { now: harness.clock() }), JSON.stringify(target)).toBe(true);
      }
      for (const target of cases) {
        const expected = isTargetReferencedInDb(harness.sqlite, root, target, { now: harness.clock() });
        const got = index.isReferenced(target.path ?? null, target.sha256 ?? null);
        expect(got, JSON.stringify(target)).toBe(expected);
      }
    } finally { harness.close(); }
  });

  it("answers the same as isTargetReferencedInDb for busy-project targets", () => {
    const { harness, project, root, create } = setup();
    try {
      // Busy project: an active project run makes the cache tree and the project tree protected.
      harness.sqlite.prepare("UPDATE projects SET status='RENDERING' WHERE id=?").run(harness.projectId);
      const cacheFile = create(join(root, "cache", "busy-cache.jpg"), "cache");
      const busyProjectFile = create(join(project, "visuals", "busy-visual.jpg"), "busy");
      const index = new DbReferenceIndex(harness.sqlite, root, { now: harness.clock() });
      index.refresh();
      for (const target of [{ path: cacheFile }, { path: busyProjectFile }]) {
        const expected = isTargetReferencedInDb(harness.sqlite, root, target, { now: harness.clock() });
        expect(expected, JSON.stringify(target)).toBe(true);
        expect(index.isReferenced(target.path, null), JSON.stringify(target)).toBe(expected);
      }
    } finally { harness.close(); }
  });

  // Files live under the project directory so they are classed "project", not "global".
  // One busy row per project: busyProjects() protects the whole project directory, which would hide the upload filter.
  // Each case: oracle and index agree while the owner is active, then agree again after the owner finishes.
  const checkParity = (harness: ReturnType<typeof setup>["harness"], root: string, targets: string[]) => {
    const oracle = targets.map((path) => isTargetReferencedInDb(harness.sqlite, root, { path }, { now: harness.clock() }));
    const index = new DbReferenceIndex(harness.sqlite, root, { now: harness.clock() });
    index.refresh();
    return { oracle, index: targets.map((path) => index.isReferenced(path, null)) };
  };

  it("answers the same as isTargetReferencedInDb for node_uploads while the job runs and after it finishes", () => {
    const { harness, project, create } = setup();
    try {
      harness.sqlite.pragma("foreign_keys = OFF");
      const root = harness.config.DATA_DIR;
      const now = harness.clock().toISOString();
      const file = create(join(project, "uploads", "node-upload.bin"), "node");
      const jobId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
      harness.sqlite.prepare(
        "INSERT INTO jobs (id, project_id, stage, status, progress, attempt, max_attempts, created_at, run_after, previous_state) VALUES (?, ?, ?, ?, 0, 1, 3, ?, ?, ?)")
        .run(jobId, harness.projectId, "SCRIPT", "RUNNING", now, now, "PENDING");
      harness.sqlite.prepare(
        "INSERT INTO node_uploads (job_id, lease_id, name, sha256, size, path, received_bytes, status, created_at) VALUES (?, ?, ?, ?, 4, ?, 4, ?, ?)")
        .run(jobId, "lease", "upload.bin", "a".repeat(64), file, "ready", now);

      const running = checkParity(harness, root, [file]);
      expect(running.index).toEqual(running.oracle);
      expect(running.oracle).toEqual([true]);

      harness.sqlite.prepare("UPDATE jobs SET status = ? WHERE id = ?").run("DONE", jobId);
      const done = checkParity(harness, root, [file]);
      expect(done.index).toEqual(done.oracle);
      expect(done.oracle).toEqual([false]);
    } finally { harness.close(); }
  });

  it("answers the same as isTargetReferencedInDb for run_uploads while the run is granted and after it is done", () => {
    const { harness, project, create } = setup();
    try {
      harness.sqlite.pragma("foreign_keys = OFF");
      const root = harness.config.DATA_DIR;
      const now = harness.clock().toISOString();
      const file = create(join(project, "uploads", "run-upload.bin"), "run");
      const runId = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
      harness.sqlite.prepare(
        "INSERT INTO project_runs (id, project_id, workspace_id, node_id, lease_id, lease_until, heartbeat_at, status, from_stage, stop_before, base_version, last_seq, budget_cap_usd, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?)")
        .run(runId, harness.projectId, "ws", "node", "lease", now, now, "GRANTED", "SCRIPT", "DONE", "v1", now);
      harness.sqlite.prepare(
        "INSERT INTO run_uploads (run_id, lease_id, name, sha256, size, path, received_bytes, status, created_at) VALUES (?, ?, ?, ?, 3, ?, 3, ?, ?)")
        .run(runId, "lease", "upload.bin", "d".repeat(64), file, "ready", now);

      const granted = checkParity(harness, root, [file]);
      expect(granted.index).toEqual(granted.oracle);
      expect(granted.oracle).toEqual([true]);

      harness.sqlite.prepare("UPDATE project_runs SET status = ? WHERE id = ?").run("DONE", runId);
      const done = checkParity(harness, root, [file]);
      expect(done.index).toEqual(done.oracle);
      expect(done.oracle).toEqual([false]);
    } finally { harness.close(); }
  });

  it("answers the same as isTargetReferencedInDb for a retained render version on an idle project", () => {
    const { harness, project, root, create } = setup();
    try {
      // Idle project (status stays READY): only the renders row protects the version directory.
      const versionDir = join(project, "render", "versions", "77777777-7777-4777-8777-777777777777");
      const output = create(join(versionDir, "out.mp4"), "video");
      harness.sqlite.prepare(`INSERT INTO renders (id, project_id, input_hash, status, output_path, duration_sec, size_bytes, width, height, report, created_at)
        VALUES ('77777777-7777-4777-8777-777777777777', ?, 'h', 'DONE', ?, 1, 1, 160, 90, '{}', ?)`)
        .run(harness.projectId, output, harness.clock().toISOString());
      const index = new DbReferenceIndex(harness.sqlite, root, { now: harness.clock() });
      index.refresh();
      for (const target of [{ path: output }, { path: join(versionDir, "other.mp4") }]) {
        const expected = isTargetReferencedInDb(harness.sqlite, root, target, { now: harness.clock() });
        expect(expected, JSON.stringify(target)).toBe(true);
        expect(index.isReferenced(target.path, null), JSON.stringify(target)).toBe(expected);
      }
    } finally { harness.close(); }
  });

  it("answers the same as isTargetReferencedInDb for the remaining keep branches", async () => {
    const { harness, project, root, create } = setup();
    try {
      // Unprojected clip set that points at an external file: step 4 of the oracle.
      const external = create(join(root, "external", "clip-source.mp4"), "external");
      harness.sqlite.prepare(`INSERT INTO clip_sets (id, project_id, source, external_path, title, ownership_confirmed, options, proposals, status, created_at, updated_at)
        VALUES ('88888888-8888-4888-8888-888888888888', NULL, 'external', ?, '', 1, '{"count":1,"minSec":1,"maxSec":2,"reframe":"crop"}', '[]', 'proposed', ?, ?)`)
        .run(external, harness.clock().toISOString(), harness.clock().toISOString());
      // Global library artifact: step 6 (artifact SHA whose path is global).
      const shared = create(join(root, "library", "shared-logo.png"), "shared logo");
      const sharedArtifact = await new ArtifactService(harness.sqlite).register(shared);
      const index = new DbReferenceIndex(harness.sqlite, root, { now: harness.clock() });
      index.refresh();
      const cases: Array<{ target: { path?: string; sha256?: string }; expected: boolean }> = [
        { target: { path: external }, expected: true },
        // Library file by path: the oracle resolves its SHA and hits step 6 (global artifact): true.
        { target: { path: shared }, expected: true },
        { target: { sha256: sharedArtifact.sha256 }, expected: true },
      ];
      for (const { target, expected } of cases) {
        const oracle = isTargetReferencedInDb(harness.sqlite, root, target, { now: harness.clock() });
        expect(oracle, JSON.stringify(target)).toBe(expected);
        expect(index.isReferenced(target.path ?? null, target.sha256 ?? null), JSON.stringify(target)).toBe(expected);
      }
    } finally { harness.close(); }
  });

  it("matches the oracle on the documented S3 same-content gap (identical bytes, reference on a different path)", () => {
    const { harness, project, root, create, referenceFile } = setup();
    try {
      // A is referenced by the timeline; B has identical bytes and no reference. Both sides must say false:
      // a path reference protects only its own path (see addRef in DbReferenceIndex.build).
      const referenced = create(join(project, "visuals", "gap-ref.png"), "same bytes");
      const twin = create(join(project, "visuals", "gap-twin.png"), "same bytes");
      referenceFile(harness.sqlite, referenced);
      const index = new DbReferenceIndex(harness.sqlite, root, { now: harness.clock() });
      index.refresh();
      const oracle = isTargetReferencedInDb(harness.sqlite, root, { path: twin }, { now: harness.clock() });
      expect(oracle).toBe(false);
      expect(index.isReferenced(twin, null)).toBe(false);
      expect(isTargetReferencedInDb(harness.sqlite, root, { path: referenced }, { now: harness.clock() })).toBe(true);
      expect(index.isReferenced(referenced, null)).toBe(true);
    } finally { harness.close(); }
  });

  it.each([3, 30])("S3 purge builds the index once for %i blobs", async (count) => {
    const { harness, project, root, create } = setup();
    try {
      const at = harness.clock().toISOString();
      for (let i = 0; i < count; i++) {
        const file = create(join(project, "visuals", `s3-${i}.jpg`), `remote ${i}`);
        const artifact = await new ArtifactService(harness.sqlite).register(file);
        harness.sqlite.prepare("INSERT INTO blobs(sha256,size,provider,key,location_id,stored_at,verified_at) VALUES (?,?,'s3',?,'fixture',?,?)")
          .run(artifact.sha256, artifact.size, blobKey(artifact.sha256), at, at);
      }
      const provider = new S3StorageProvider({
        endpoint: "https://s3.example.test", bucket: "fixture", region: "auto",
        accessKeyId: "fixture", secretAccessKey: "fixture", checksumSha256: false,
      }, async () => new Response(null, { status: 204 }));
      const location = () => ({ provider, id: "fixture" });
      const store = new BlobStore(harness.sqlite, location, () => undefined, harness.clock);
      const gc = new FileGc(harness.sqlite, root, () => ({ graceDays: 14, postPublishDays: 7 }), harness.clock, location, (work) => store.mutate(work));
      await gc.runBlobs();
      harness.advance(15 * day);
      const build = vi.spyOn(DbReferenceIndex.prototype as unknown as { build: () => void }, "build");
      const res = await gc.runBlobs({ purge: true });
      expect(res.purged).toBe(count);
      expect(build).toHaveBeenCalledTimes(1);
    } finally { harness.close(); }
  });

  it("keeps a remote blob whose reference is committed by a second connection during DELETE", async () => {
    const { harness, project, root, create, referenceFile } = setup();
    const second = new Database(harness.config.DATABASE_PATH);
    try {
      const file = create(join(project, "visuals", "delete-late.jpg"), "late delete");
      const artifact = await new ArtifactService(harness.sqlite).register(file);
      let injected = false;
      const provider = new S3StorageProvider({
        endpoint: "https://s3.example.test", bucket: "fixture", region: "auto",
        accessKeyId: "fixture", secretAccessKey: "fixture", checksumSha256: false,
      }, async (_url, init) => {
        if (init?.method === "DELETE" && !injected) {
          injected = true;
          referenceFile(second, file);
        }
        return new Response(null, { status: 204 });
      });
      const location = () => ({ provider, id: "fixture" });
      const store = new BlobStore(harness.sqlite, location, () => undefined, harness.clock);
      const gc = new FileGc(harness.sqlite, root, () => ({ graceDays: 14, postPublishDays: 7 }), harness.clock, location, (work) => store.mutate(work));
      const at = harness.clock().toISOString();
      harness.sqlite.prepare("INSERT INTO blobs(sha256,size,provider,key,location_id,stored_at,verified_at) VALUES (?,?,'s3',?,'fixture',?,?)")
        .run(artifact.sha256, artifact.size, blobKey(artifact.sha256), at, at);
      await gc.runBlobs();
      harness.advance(15 * day);
      const res = await gc.runBlobs({ purge: true });
      expect(injected).toBe(true);
      expect(res.purged).toBe(0);
      expect(existsSync(file)).toBe(true);
    } finally { second.close(); harness.close(); }
  });
});
