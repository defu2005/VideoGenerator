import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileGc } from "../src/storage/fileGc.js";
import { ArtifactService } from "../src/node/artifactService.js";
import { S3StorageProvider, blobKey } from "../src/storage/provider.js";
import { createPipelineHarness } from "./pipelineFixtures.js";

const day = 86_400_000;

async function fixture(failRestore: boolean, corruptDownload = false) {
  const h = createPipelineHarness();
  const path = join(h.config.DATA_DIR, "projects", h.projectId, "visuals", "orphan.jpg");
  const bytes = Buffer.from("offline recovery fixture");
  mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes);
  const artifact = await new ArtifactService(h.sqlite).register(path);
  let remote: Buffer | null = bytes;
  let deletes = 0, puts = 0;
  let onDelete = () => {};
  const provider = new S3StorageProvider({ endpoint: "https://s3.example.test", bucket: "fixture-bucket", region: "auto",
    accessKeyId: "fixture", secretAccessKey: "fixture", checksumSha256: true }, async (_url, init) => {
    if (init?.method === "DELETE") { deletes++; remote = null; onDelete(); return new Response(null, { status: 204 }); }
    if (init?.method === "PUT") {
      puts++;
      if (failRestore) { failRestore = false; return new Response(null, { status: 503 }); }
      remote = Buffer.from(await new Response(init.body).arrayBuffer());
      return new Response(null, { status: 200 });
    }
    if (init?.method === "HEAD") return new Response(null, { status: remote ? 200 : 404, headers: remote ? {
      "content-length": String(remote.length), "x-amz-checksum-sha256": Buffer.from(artifact.sha256, "hex").toString("base64"),
    } : {} });
    if (init?.method === "GET") return new Response(corruptDownload ? Buffer.alloc(bytes.length) : remote, { status: remote ? 200 : 404 });
    throw new Error("Unexpected request");
  });
  const location = () => ({ provider, id: "fixture" });
  const createGc = () => new FileGc(h.sqlite, h.config.DATA_DIR, undefined, h.clock, location);
  const gc = createGc();
  const now = h.clock().toISOString();
  h.sqlite.prepare("INSERT INTO blobs(sha256,size,provider,key,location_id,stored_at,verified_at) VALUES (?,?,'s3',?,'fixture',?,?)")
    .run(artifact.sha256, artifact.size, blobKey(artifact.sha256), now, now);
  gc.run(); await gc.runBlobs(); h.advance(15 * day);
  expect(gc.run({ purge: true }).purged).toBe(1);
  onDelete = () => {
    const at = h.clock().toISOString();
    h.sqlite.prepare("INSERT INTO timelines(project_id,data,input_hash,total_duration_sec,created_at,updated_at) VALUES (?,?,?,1,?,?)")
      .run(h.projectId, JSON.stringify({ scenes: [{ visuals: [{ path: "visuals/orphan.jpg", sha256: artifact.sha256 }] }] }), "fixture", at, at);
  };
  return { h, path, bytes, gc, createGc, remote: () => remote, counts: () => ({ deletes, puts }),
    backupFiles: () => readdirSync(join(h.config.DATA_DIR, "gc-recovery"), { recursive: true }).filter((name) => String(name).endsWith(artifact.sha256)) };
}

describe("durable remote GC recovery", () => {
  it("does not DELETE when a remote-only backup fails the SHA check", async () => {
    const f = await fixture(false, true);
    try {
      expect(await f.gc.runBlobs({ purge: true })).toMatchObject({ purged: 0, errors: 1 });
      expect(f.counts()).toEqual({ deletes: 0, puts: 0 });
      expect(f.remote()).toEqual(f.bytes);
      expect(f.backupFiles()).toHaveLength(0);
    } finally { f.h.close(); }
  });
  it("restores remote and local bytes when a reference appears during DELETE", async () => {
    const f = await fixture(false);
    try {
      expect(existsSync(f.path)).toBe(false);
      expect(await f.gc.runBlobs({ purge: true })).toMatchObject({ cleared: 1, purged: 0, errors: 0 });
      expect(readFileSync(f.path)).toEqual(f.bytes);
      expect(f.remote()).toEqual(f.bytes);
      expect(f.counts()).toEqual({ deletes: 1, puts: 1 });
      expect(f.h.sqlite.prepare("SELECT verified_at,orphaned_at FROM blobs").get()).toMatchObject({ verified_at: f.h.clock().toISOString(), orphaned_at: null });
      expect(f.backupFiles()).toHaveLength(0);
    } finally { f.h.close(); }
  });

  it("keeps the durable copy on failed restore and recovers in a later mark-only sweep", async () => {
    const f = await fixture(true);
    try {
      expect(await f.gc.runBlobs({ purge: true })).toMatchObject({ cleared: 0, purged: 0, errors: 1 });
      expect(f.backupFiles()).toHaveLength(1);
      expect(f.remote()).toBeNull();
      expect(f.h.sqlite.prepare("SELECT verified_at FROM blobs").get()).toEqual({ verified_at: "" });
      expect(await f.createGc().runBlobs()).toMatchObject({ cleared: 1, purged: 0, errors: 0 });
      expect(readFileSync(f.path)).toEqual(f.bytes);
      expect(f.remote()).toEqual(f.bytes);
      expect(f.counts()).toEqual({ deletes: 1, puts: 2 });
      expect(f.backupFiles()).toHaveLength(0);
    } finally { f.h.close(); }
  });
});
