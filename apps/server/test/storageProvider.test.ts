import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { BlobStore, blobLocationId } from "../src/storage/blobStore.js";
import { presignS3 } from "../src/storage/sigv4.js";
import { blobKey, LocalStorageProvider, S3StorageProvider } from "../src/storage/provider.js";
import { PROTECTED_PROJECT_ID } from "@vg/shared";
import { recordStorageHealth, storageHealth } from "../src/storage/health.js";

const credentials = {
  region: "us-east-1",
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
};
const now = new Date("2013-05-24T00:00:00Z");
const hash = "ab".repeat(32);

describe("storage providers", () => {
  it("backs off for ten minutes after four fallbacks and keeps the failure window separate", () => {
    const db = new Database(":memory:");
    try {
      db.exec("CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)");
      const fallback = { route: "control", count: 3, bytes: 1024, ms: 1000, error: "DIRECT_TRANSFER_FAILED" } as const;
      recordStorageHealth(db, [fallback], now);
      expect(storageHealth(db, now)).toMatchObject({ fallback: 3, suspendedUntil: null });
      recordStorageHealth(db, [{ ...fallback, count: 1 }], now);
      expect(storageHealth(db, now)).toMatchObject({ fallback: 4, suspendedUntil: "2013-05-24T00:10:00.000Z", failureRate: 1 });
      expect(storageHealth(db, new Date(now.getTime() + 10 * 60_000))).toMatchObject({ fallback: 4, suspendedUntil: null });
      expect(storageHealth(db, new Date(now.getTime() + 30 * 60_000))).toMatchObject({ fallback: 0 });
    } finally { db.close(); }
  });
  it("matches the published AWS S3 query-auth example", () => {
    const url = new URL(presignS3("GET", new URL("https://examplebucket.s3.amazonaws.com/test.txt"), credentials, 86400, now));
    expect(url.searchParams.get("X-Amz-Signature")).toBe("aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404");
  });

  it("binds the PUT size and SHA-256, with no control request to obtain a URL", async () => {
    const request = vi.fn<typeof fetch>();
    const s3 = new S3StorageProvider({ ...credentials, endpoint: "https://s3.example.test:9000/gateway", bucket: "media-test", checksumSha256: true }, request, () => now);
    const first = (await s3.getUploadTarget(blobKey(hash), hash, 123, 60))!;
    const altered = (await s3.getUploadTarget(blobKey(hash), hash, 124, 60))!;
    const url = new URL(first.url);
    expect(url.pathname).toBe(`/gateway/media-test/${blobKey(hash)}`);
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("content-length;host;x-amz-checksum-sha256");
    expect(first.headers["x-amz-checksum-sha256"]).toBe(Buffer.from(hash, "hex").toString("base64"));
    expect(new URL(altered.url).searchParams.get("X-Amz-Signature")).not.toBe(url.searchParams.get("X-Amz-Signature"));
    expect(first.url).not.toContain(credentials.secretAccessKey);
    expect(await s3.getUploadTarget(blobKey(hash), hash, 5_000_000_001, 60)).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });

  it("uses no direct URLs for local storage and keeps remote fetch errors safe to log", async () => {
    const local = new LocalStorageProvider();
    expect(await local.getDownloadUrl()).toBeNull();
    expect(await local.getUploadTarget()).toBeNull();
    const request = vi.fn<typeof fetch>().mockImplementation(async (url) => { throw new Error(String(url)); });
    const s3 = new S3StorageProvider({ ...credentials, endpoint: "https://s3.example.test", bucket: "media-test", checksumSha256: false }, request);
    await expect(s3.head(blobKey(hash))).rejects.toThrow(/^S3 request failed$/);
    expect(request.mock.calls[0]?.[1]?.redirect).toBe("error");
  });

  it("mirrors a hash once, verifies its contents and offers it only from its recorded bucket", async () => {
    const root = await mkdtemp(join(tmpdir(), "vg-storage-fixture-"));
    const db = new Database(":memory:");
    try {
      db.exec("CREATE TABLE blobs (sha256 TEXT PRIMARY KEY, size INTEGER, provider TEXT, key TEXT, location_id TEXT, stored_at TEXT, verified_at TEXT)");
      const file = join(root, "input.bin");
      const data = Buffer.from("fixture asset");
      const sha256 = createHash("sha256").update(data).digest("hex");
      await writeFile(file, data);
      const request = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
        if (init?.method === "PUT") {
          expect(Buffer.from(await new Response(init.body).arrayBuffer())).toEqual(data);
          return new Response(null, { status: 200 });
        }
        if (init?.method === "HEAD") return new Response(null, { headers: { "content-length": String(data.length) } });
        expect(init?.method).toBe("GET");
        expect(new URL(String(url)).pathname).toContain(blobKey(sha256));
        return new Response(new Uint8Array(data));
      });
      const options = { ...credentials, endpoint: "https://s3.example.test", bucket: "media-test", checksumSha256: false };
      const provider = new S3StorageProvider(options, request);
      let id = blobLocationId(options.endpoint, options.bucket);
      const failure = vi.fn();
      const store = new BlobStore(db, () => ({ id, provider }), failure);
      const input = { path: file, size: data.length, sha256 };
      await store.mirror(PROTECTED_PROJECT_ID, input);
      expect(request).not.toHaveBeenCalled();
      await Promise.all([store.mirror("fixture", input), store.mirror("fixture", input)]);
      await store.mirror("fixture", input);
      expect(request.mock.calls.map(([, init]) => init?.method)).toEqual(["PUT", "HEAD", "GET"]);
      expect(failure).not.toHaveBeenCalled();
      expect(await store.preferredUrl("fixture", sha256, data.length, 300)).toContain(blobKey(sha256));
      expect(await store.preferredUrl(PROTECTED_PROJECT_ID, sha256, data.length, 300)).toBeNull();
      id = blobLocationId(options.endpoint, "other-bucket");
      expect(await store.preferredUrl("fixture", sha256, data.length, 300)).toBeNull();
    } finally {
      db.close();
      await rm(join(root, "input.bin"), { force: true });
      await rmdir(root);
    }
  });
});
