import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { PROTECTED_PROJECT_ID } from "@vg/shared";
import { FileGc } from "../src/storage/fileGc.js";
import { projectDir } from "../src/storage/paths.js";
import { collectReferences, referencesForPath } from "../src/storage/references.js";
import { createPipelineHarness } from "./pipelineFixtures.js";
import { ArtifactService } from "../src/node/artifactService.js";
import { blobKey, S3StorageProvider } from "../src/storage/provider.js";
import { BlobStore } from "../src/storage/blobStore.js";
import { runAsActor } from "../src/auth/requestContext.js";
import { testActor, TEST_OTHER_WORKSPACE_ID } from "./testActor.js";
import { storageToolDefs } from "../src/storage/toolDefs.js";
import type { AssistantToolContext } from "../src/assistant/tools.js";

const day = 86_400_000;

function setup() {
  const harness = createPipelineHarness();
  const root = harness.config.DATA_DIR;
  const project = projectDir(root, harness.projectId);
  const gc = new FileGc(harness.sqlite, root, () => ({ graceDays: 14, postPublishDays: 7 }), harness.clock);
  const create = (path: string) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "fixture file");
    return path;
  };
  const timeline = (name: string) => {
    const data = JSON.stringify({ scenes: [{ visuals: [{ path: name }] }] });
    const now = harness.clock().toISOString();
    harness.sqlite.prepare(`INSERT INTO timelines(project_id,data,input_hash,total_duration_sec,created_at,updated_at)
      VALUES (?,?,?,1,?,?) ON CONFLICT(project_id) DO UPDATE SET data=excluded.data`).run(harness.projectId, data, "fixture", now, now);
  };
  return { harness, project, root, gc, create, timeline };
}

describe("file GC project references", () => {
  it("counts retained and protected project files in the report while excluding them from GC", () => {
    const { harness, project, root, gc, create } = setup();
    try {
      create(join(project, "notes.txt"));
      create(join(project, "visuals", "unused.jpg"));
      create(join(projectDir(root, PROTECTED_PROJECT_ID), "visuals", "protected.jpg"));
      expect(gc.report().projects).toEqual([
        { projectId: harness.projectId, bytes: 24, orphanedBytes: 0, dueBytes: 0 },
        { projectId: PROTECTED_PROJECT_ID, bytes: 12, orphanedBytes: 0, dueBytes: 0 },
      ]);
      expect(gc.largestProjects()).toEqual([
        { projectId: harness.projectId, bytes: 24 },
        { projectId: PROTECTED_PROJECT_ID, bytes: 12 },
      ]);
      expect(gc.run()).toMatchObject({ marked: 1 });
      harness.advance(15 * day);
      expect(gc.run({ purge: true })).toMatchObject({ purged: 1 });
      expect(existsSync(join(project, "notes.txt"))).toBe(true);
      expect(existsSync(join(projectDir(root, PROTECTED_PROJECT_ID), "visuals", "protected.jpg"))).toBe(true);
    } finally { harness.close(); }
  });

  it("keeps the chosen candidate and collects the unselected one after archive", () => {
    const { harness, project, gc, create } = setup();
    try {
      const selected = create(join(project, "visuals", "selected.jpg"));
      const orphan = create(join(project, "visuals", "unselected.jpg"));
      writeFileSync(selected, "selected photo");
      const now = harness.clock().toISOString();
      harness.sqlite.prepare(`INSERT INTO scenes(id,project_id,"order",kind,label,narration,visual_notes,visual_queries,
        music_mood,energy,est_duration_sec,start_sec,transition_note,origin,input_hash,created_at,updated_at)
        VALUES ('gc-scene',?,0,'hook','GC','fixture','','{"primary":"fixture","alternatives":[]}','calm','low',1,0,'','AGENT','fixture',?,?)`)
        .run(harness.projectId, now, now);
      const insert = harness.sqlite.prepare(`INSERT INTO visual_candidates(id,project_id,scene_id,origin,provider,provider_item_id,
        query,title,description,tags,preview_url,image_url,source_url,source_site,width,height,aspect_ratio,file_type,watermark,
        relevance_score,score_breakdown,license,rank,local_path,created_at,search_hash)
        VALUES (?,?,'gc-scene','SEARCH','mock',?,'fixture','Fixture','','[]','https://image.example.test/p.jpg',
        'https://image.example.test/p.jpg','https://source.example.test','fixture',480,270,1.777,'jpg','NONE',1,'{}','{}',0,?,?,'fixture')`);
      insert.run("chosen", harness.projectId, "chosen", "visuals/selected.jpg", now);
      insert.run("unused", harness.projectId, "unused", "visuals/unselected.jpg", now);
      harness.sqlite.prepare(`INSERT INTO visual_selections(id,project_id,scene_id,candidate_id,status,selected_by,created_at,updated_at)
        VALUES ('selection',?,'gc-scene','chosen','APPROVED','USER',?,?)`).run(harness.projectId, now, now);
      harness.sqlite.prepare("UPDATE projects SET archived_at=? WHERE id=?").run(now, harness.projectId);
      expect(gc.run()).toMatchObject({ marked: 1 });
      harness.advance(15 * day);
      expect(gc.run({ purge: true })).toMatchObject({ purged: 1 });
      expect(existsSync(selected)).toBe(true);
      expect(existsSync(orphan)).toBe(false);
    } finally { harness.close(); }
  });

  it("limits the agent storage report to the current workspace", async () => {
    const { harness, project, root, create } = setup();
    try {
      const ownFile = create(join(project, "visuals", "a.jpg"));
      writeFileSync(ownFile, "owner-a");
      const other = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
      harness.sqlite.prepare("UPDATE projects SET workspace_id=? WHERE id=?").run(testActor.workspaceId, harness.projectId);
      harness.sqlite.prepare(`INSERT INTO projects(id,workspace_id,title,topic,mode,settings,status,stage,created_at,updated_at)
        SELECT ?,?,'Other','fixture',mode,settings,status,stage,created_at,updated_at FROM projects WHERE id=?`)
        .run(other, TEST_OTHER_WORKSPACE_ID, harness.projectId);
      const otherFile = create(join(projectDir(root, other), "visuals", "b.jpg"));
      writeFileSync(otherFile, "owner-b");
      const registry = new ArtifactService(harness.sqlite);
      for (const path of [ownFile, otherFile]) {
        const artifact = await registry.register(path);
        harness.sqlite.prepare(`INSERT INTO blobs(sha256,size,provider,key,location_id,stored_at,verified_at,orphaned_at,purge_after)
          VALUES (?,?,'s3',?,'fixture',?,?,?,?)`).run(artifact.sha256, artifact.size, blobKey(artifact.sha256),
            harness.clock().toISOString(), harness.clock().toISOString(), harness.clock().toISOString(), harness.clock().toISOString());
      }
      const context = { sqlite: harness.sqlite, config: harness.config } as AssistantToolContext;
      const result = await runAsActor(testActor, () => storageToolDefs[0]!.execute({}, context)) as {
        projects: Array<{ projectId: string }>; remote: { bytes: number; orphanedCount: number };
      };
      expect(result.projects.map((row) => row.projectId)).toEqual([harness.projectId]);
      expect(result.remote).toMatchObject({ bytes: 7, orphanedCount: 1 });
    } finally { harness.close(); }
  });

  it("marks and purges the remote copy with dry-run and a reference recheck after waiting for a PUT", async () => {
    const { harness, project, root, create, timeline } = setup();
    try {
      const file = create(join(project, "visuals", "orphan.jpg"));
      const artifact = await new ArtifactService(harness.sqlite).register(file);
      const deleted: string[] = [];
      const provider = new S3StorageProvider({
        endpoint: "https://s3.example.test", bucket: "fixture-bucket", region: "auto",
        accessKeyId: "fixture", secretAccessKey: "fixture-secret", checksumSha256: false,
      }, async (url, init) => {
        expect(init?.method).toBe("DELETE");
        deleted.push(new URL(String(url)).pathname);
        return new Response(null, { status: 204 });
      });
      const location = () => ({ provider, id: "fixture" });
      const store = new BlobStore(harness.sqlite, location, () => undefined, harness.clock);
      const gc = new FileGc(harness.sqlite, root, undefined, harness.clock, location, (work) => store.mutate(work));
      harness.sqlite.prepare(`INSERT INTO blobs(sha256,size,provider,key,location_id,stored_at,verified_at)
        VALUES (?,?,'s3',?,'fixture',?,?)`).run(artifact.sha256, artifact.size, blobKey(artifact.sha256), harness.clock().toISOString(), harness.clock().toISOString());
      expect(await gc.runBlobs()).toMatchObject({ marked: 1, purged: 0 });
      harness.advance(15 * day);
      expect(await gc.runBlobs({ dryRun: true, purge: true })).toMatchObject({ eligible: 1, purged: 0 });
      expect(deleted).toHaveLength(0);
      let release!: () => void;
      const hold = store.mutate(() => new Promise<void>((resolve) => { release = resolve; }));
      await Promise.resolve();
      const waiting = gc.runBlobs({ purge: true });
      timeline("visuals/orphan.jpg");
      release();
      await hold;
      expect(await waiting).toMatchObject({ purged: 0 });
      expect(deleted).toHaveLength(0);
      await gc.runBlobs();
      expect(harness.sqlite.prepare("SELECT orphaned_at FROM blobs").get()).toMatchObject({ orphaned_at: null });
      harness.sqlite.prepare("DELETE FROM timelines WHERE project_id=?").run(harness.projectId);
      await gc.runBlobs();
      harness.advance(15 * day);
      expect(await gc.runBlobs({ purge: true })).toMatchObject({ purged: 1, bytes: artifact.size });
      expect(deleted).toHaveLength(1);
      expect(harness.sqlite.prepare("SELECT 1 FROM blobs").get()).toBeUndefined();
    } finally { harness.close(); }
  });

  it("keeps timeline and undo assets, shared libraries and the protected project", () => {
    const { harness, project, root, gc, create, timeline } = setup();
    try {
      const current = create(join(project, "visuals", "current.jpg"));
      const undo = create(join(project, "visuals", "undo.jpg"));
      const other = create(join(project, "visuals", "unreferenced.jpg"));
      const library = create(join(root, "footage", "library.mp4"));
      const protectedFile = create(join(projectDir(root, PROTECTED_PROJECT_ID), "visuals", "protected.jpg"));
      timeline("visuals/current.jpg");
      harness.sqlite.prepare(`INSERT INTO timeline_snapshots(id,project_id,revision,snapshot,source,summary,created_at)
        VALUES ('undo',?,1,?,'manual','fixture',?)`).run(harness.projectId,
        JSON.stringify({ timeline: { scenes: [{ visuals: [{ path: "visuals/undo.jpg" }] }] } }), harness.clock().toISOString());
      const graph = collectReferences(harness.sqlite, root, { now: harness.clock() });
      expect(referencesForPath(graph, current, root)[0]?.table).toBe("timelines");
      expect(referencesForPath(graph, undo, root)[0]?.table).toBe("timeline_snapshots");
      expect(gc.run()).toMatchObject({ marked: 1, purged: 0 });
      harness.advance(15 * day);
      expect(gc.run({ purge: true, dryRun: true })).toMatchObject({ eligible: 1, eligibleBytes: 12, purged: 0 });
      expect(existsSync(other)).toBe(true);
      expect(gc.run({ purge: true })).toMatchObject({ eligible: 1, purged: 1, bytes: 12 });
      expect(existsSync(other)).toBe(false);
      expect([current, undo, library, protectedFile].every(existsSync)).toBe(true);
    } finally { harness.close(); }
  });

  it("clears a mark when a reference appears after grace and fences a running job", () => {
    const { harness, project, gc, create, timeline } = setup();
    try {
      const selected = create(join(project, "visuals", "selected.jpg"));
      const preview = create(join(project, "preview", "cache.jpg"));
      expect(gc.run()).toMatchObject({ marked: 2 });
      harness.advance(15 * day);
      timeline("visuals/selected.jpg");
      const job = harness.repository.createJob({
        projectId: harness.projectId, stage: "RENDER", maxAttempts: 1, previousState: "PENDING", runAfter: harness.clock(),
      });
      harness.orchestrator.startJob(job.id);
      expect(gc.run({ purge: true })).toMatchObject({ cleared: 2, purged: 0 });
      expect(existsSync(selected)).toBe(true);
      expect(existsSync(preview)).toBe(true);
    } finally { harness.close(); }
  });

  it("restarts grace if an unreferenced file was replaced", () => {
    const { harness, project, gc, create } = setup();
    try {
      const file = create(join(project, "preview", "cache.jpg"));
      expect(gc.run()).toMatchObject({ marked: 1 });
      harness.advance(2 * day);
      writeFileSync(file, "new preview");
      expect(gc.run({ purge: true })).toMatchObject({ marked: 1, eligible: 0, purged: 0 });
      expect(existsSync(file)).toBe(true);
    } finally { harness.close(); }
  });

  it("collects an expired derived cache without touching the shared footage library", () => {
    const { harness, root, gc, create } = setup();
    try {
      const cache = create(join(root, "cache", "motion", "derived.mp4"));
      const footage = create(join(root, "footage", "library.mp4"));
      expect(gc.run({ ephemeralOnly: true })).toMatchObject({ marked: 1 });
      harness.advance(2 * day);
      expect(gc.run({ ephemeralOnly: true, purge: true })).toMatchObject({ purged: 1 });
      expect(existsSync(cache)).toBe(false);
      expect(existsSync(footage)).toBe(true);
    } finally { harness.close(); }
  });

  it("builds the reference graph once per sweep and reuses the warm stamp cache", async () => {
    const { harness, project, root, create, timeline } = setup();
    const originalRegister = ArtifactService.prototype.registerSync;
    try {
      const selected = create(join(project, "visuals", "selected.jpg"));
      writeFileSync(selected, Buffer.alloc(1024 * 1024, 7));
      timeline("visuals/selected.jpg");

      const at = harness.clock().toISOString();
      for (let i = 0; i < 8; i++) {
        const orphan = create(join(project, "visuals", `orphan-${i}.jpg`));
        writeFileSync(orphan, `orphan content ${i}`);
        const artifact = await new ArtifactService(harness.sqlite).register(orphan);
        harness.sqlite.prepare("INSERT INTO blobs(sha256,size,provider,key,location_id,stored_at,verified_at) VALUES (?,?,'s3',?,'fixture',?,?)")
          .run(artifact.sha256, artifact.size, blobKey(artifact.sha256), at, at);
      }

      let calls = 0;
      let hashedBytes = 0;
      let inTx = 0;
      ArtifactService.prototype.registerSync = function(path) {
        const res = originalRegister.call(this, path);
        calls++;
        hashedBytes += res.size;
        if (harness.sqlite.inTransaction) inTx++;
        return res;
      };

      const provider = new S3StorageProvider({
        endpoint: "https://s3.example.test", bucket: "fixture", region: "auto",
        accessKeyId: "fixture", secretAccessKey: "fixture", checksumSha256: true,
      }, async () => { throw new Error("Network must not be used"); });
      const gc = new FileGc(harness.sqlite, root, undefined, harness.clock, () => ({ id: "fixture", provider }));

      const result = await gc.runBlobs();
      expect(result.marked).toBe(8);
      expect(calls).toBe(1);
      expect(hashedBytes).toBe(1024 * 1024);
      expect(inTx).toBe(0);

      // Local dry-run
      calls = 0; hashedBytes = 0; inTx = 0;
      gc.run({ dryRun: true });
      expect(calls).toBe(1);
      expect(inTx).toBe(0);

      // Change file -> invalidation
      writeFileSync(selected, Buffer.alloc(2 * 1024 * 1024, 9));
      calls = 0; hashedBytes = 0;
      gc.run({ dryRun: true });
      expect(calls).toBe(1);
      expect(hashedBytes).toBe(2 * 1024 * 1024);
    } finally {
      ArtifactService.prototype.registerSync = originalRegister;
      harness.close();
    }
  });

  it("keeps graph construction outside write transaction and uses short transactions for purge", () => {
    const { harness, project, root, gc, create } = setup();
    try {
      const file = create(join(project, "preview", "old.jpg"));
      expect(gc.run()).toMatchObject({ marked: 1 });
      harness.advance(15 * day);

      const graph = collectReferences(harness.sqlite, root, { now: harness.clock() });
      expect(harness.sqlite.inTransaction).toBe(false);

      const res = gc.run({ purge: true });
      expect(res.purged).toBe(1);
      expect(existsSync(file)).toBe(false);
    } finally { harness.close(); }
  });

  it("preserves path-only reference to a second local copy with the same SHA", async () => {
    const { harness, project, root, create, timeline } = setup();
    try {
      const orig = create(join(project, "visuals", "original.jpg"));
      writeFileSync(orig, "same-content-data");
      const artifact = await new ArtifactService(harness.sqlite).register(orig);

      const at = harness.clock().toISOString();
      harness.sqlite.prepare("INSERT INTO blobs(sha256,size,provider,key,location_id,stored_at,verified_at) VALUES (?,?,'s3',?,'fixture',?,?)")
        .run(artifact.sha256, artifact.size, blobKey(artifact.sha256), at, at);

      const copy = create(join(project, "visuals", "copy.jpg"));
      writeFileSync(copy, "same-content-data");

      timeline("visuals/copy.jpg");

      const provider = new S3StorageProvider({
        endpoint: "https://s3.example.test", bucket: "fixture", region: "auto",
        accessKeyId: "fixture", secretAccessKey: "fixture", checksumSha256: true,
      }, async () => { throw new Error("No network"); });
      const gc = new FileGc(harness.sqlite, root, undefined, harness.clock, () => ({ id: "fixture", provider }));

      const result = await gc.runBlobs();
      expect(result.marked).toBe(0);
      expect(harness.sqlite.prepare("SELECT orphaned_at FROM blobs WHERE sha256=?").get(artifact.sha256))
        .toMatchObject({ orphaned_at: null });
    } finally { harness.close(); }
  });

  it("does not purge a file if a concurrent connection references it right before the write lock", () => {
    const { harness, project, root, gc, create, timeline } = setup();
    const second = new Database(harness.config.DATABASE_PATH);
    const originalTransaction = harness.sqlite.transaction;
    try {
      const file = create(join(project, "visuals", "concurrent-late.jpg"));
      expect(gc.run()).toMatchObject({ marked: 1 });
      harness.advance(15 * day);

      let injected = false;
      harness.sqlite.transaction = function(fn: (...args: unknown[]) => unknown) {
        const wrapped = originalTransaction.call(harness.sqlite, fn);
        const immediate = function(...args: unknown[]) {
          if (!injected) {
            injected = true;
            const at = harness.clock().toISOString();
            second.prepare("INSERT INTO timelines(project_id,data,input_hash,total_duration_sec,created_at,updated_at) VALUES (?,?,?,1,?,?)")
              .run(harness.projectId, JSON.stringify({ scenes: [{ visuals: [{ path: file }] }] }), "fixture", at, at);
          }
          return wrapped.immediate(...args);
        };
        return Object.assign((...args: unknown[]) => wrapped(...args), { immediate });
      } as typeof harness.sqlite.transaction;

      const result = gc.run({ purge: true });
      expect(injected).toBe(true);
      expect(result.purged).toBe(0);
      expect(existsSync(file)).toBe(true);
    } finally {
      harness.sqlite.transaction = originalTransaction;
      second.close();
      harness.close();
    }
  });

  it("re-checks targeted DB reference in S3 purge without rebuilding the entire graph", async () => {
    const { harness, project, root, create, timeline } = setup();
    try {
      const file = create(join(project, "visuals", "s3-late.jpg"));
      const artifact = await new ArtifactService(harness.sqlite).register(file);
      const deleted: string[] = [];
      const provider = new S3StorageProvider({
        endpoint: "https://s3.example.test", bucket: "fixture", region: "auto",
        accessKeyId: "fixture", secretAccessKey: "fixture", checksumSha256: false,
      }, async (url, init) => {
        deleted.push(new URL(String(url)).pathname);
        return new Response(null, { status: 204 });
      });
      const location = () => ({ provider, id: "fixture" });
      const store = new BlobStore(harness.sqlite, location, () => undefined, harness.clock);
      const gc = new FileGc(harness.sqlite, root, undefined, harness.clock, location, (work) => store.mutate(work));

      const at = harness.clock().toISOString();
      harness.sqlite.prepare("INSERT INTO blobs(sha256,size,provider,key,location_id,stored_at,verified_at) VALUES (?,?,'s3',?,'fixture',?,?)")
        .run(artifact.sha256, artifact.size, blobKey(artifact.sha256), at, at);

      await gc.runBlobs();
      harness.advance(15 * day);

      // Mutate queue hold
      let release!: () => void;
      const hold = store.mutate(() => new Promise<void>((resolve) => { release = resolve; }));
      await Promise.resolve();
      const waiting = gc.runBlobs({ purge: true });
      // Add reference while in queue
      timeline("visuals/s3-late.jpg");
      release();
      await hold;

      const res = await waiting;
      expect(res.purged).toBe(0);
      expect(deleted).toHaveLength(0);
      expect(harness.sqlite.prepare("SELECT orphaned_at FROM blobs WHERE sha256=?").get(artifact.sha256)).toBeDefined();
    } finally { harness.close(); }
  });
});
