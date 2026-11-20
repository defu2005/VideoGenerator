import { createHash } from "node:crypto";
import { mkdtemp, realpath, rm, rmdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import type Database from "better-sqlite3";
import { sha256File } from "../node/artifactService.js";
import { PROTECTED_PROJECT_ID } from "@vg/shared";
import { AppError } from "../lib/errors.js";
import { blobKey, StorageObjectTooLarge, type S3StorageProvider } from "./provider.js";

export interface BlobLocation {
  provider: S3StorageProvider;
  /** The destination identity excludes credentials, which can be rotated. */
  id: string;
}

export function blobLocationId(endpoint: string, bucket: string): string {
  const base = new URL(endpoint);
  base.pathname = base.pathname.replace(/\/$/, "");
  return createHash("sha256").update(JSON.stringify([base.href, bucket])).digest("hex");
}

interface BlobInput {
  sha256: string;
  size: number;
  path: string;
}

interface LeaseOutput {
  jobId: string;
  leaseId: string;
  name: string;
  sha256: string;
  size: number;
}

function stagingKey(location: BlobLocation, output: LeaseOutput): string {
  const identity = createHash("sha256").update(JSON.stringify([
    location.id, output.jobId, output.leaseId, output.name, output.sha256, output.size,
  ])).digest("hex");
  return `incoming/${identity.slice(0, 2)}/${identity}`;
}

export class BlobStore {
  private readonly pending = new Map<string, Promise<void>>();
  private mirrorTail: Promise<void> = Promise.resolve();

  /** Serialize object mutations so an orphan DELETE cannot race a mirror PUT. */
  mutate<T>(work: () => Promise<T>): Promise<T> {
    const result = this.mirrorTail.then(work);
    this.mirrorTail = result.then(() => undefined, () => undefined);
    return result;
  }

  async drain(): Promise<void> {
    await this.mirrorTail;
    await Promise.all([...this.pending.values()]);
  }

  constructor(
    private readonly db: Database.Database,
    private readonly location: () => BlobLocation | null,
    private readonly onFailure: () => void,
    private readonly now: () => Date = () => new Date(),
    private readonly allowDirect: () => boolean = () => true,
  ) {}

  supportsDirect(projectId: string): boolean {
    return projectId !== PROTECTED_PROJECT_ID && !!this.location();
  }

  async outputTarget(projectId: string, output: LeaseOutput, ttlSec: number) {
    if (projectId === PROTECTED_PROJECT_ID || !this.allowDirect()) return null;
    const location = this.location();
    if (!location) return null;
    return location.provider.getUploadTarget(stagingKey(location, output), output.sha256, output.size, ttlSec);
  }

  async pullOutput(projectId: string, output: LeaseOutput, temporaryPath: string): Promise<void> {
    const location = projectId !== PROTECTED_PROJECT_ID ? this.location() : null;
    if (!location) throw new AppError(503, "STORAGE_UNAVAILABLE", "Kho S3 không sẵn sàng để nhận tệp kết quả.");
    const { provider } = location;
    const key = stagingKey(location, output);
    const mismatch = () => new AppError(422, "STORAGE_HASH_MISMATCH", "Kích thước hoặc SHA-256 của tệp trên S3 không khớp.");
    const remote = await provider.head(key);
    if (!remote || remote.size !== output.size || (remote.sha256 && remote.sha256 !== output.sha256)) throw mismatch();
    try {
      await provider.downloadTo(key, temporaryPath, output.size);
    } catch (error) {
      if (error instanceof StorageObjectTooLarge) throw mismatch();
      throw error;
    }
    if ((await stat(temporaryPath)).size !== output.size || await sha256File(temporaryPath) !== output.sha256) throw mismatch();
  }

  private has(location: BlobLocation, sha256: string, size: number): boolean {
    return !!this.db.prepare("SELECT 1 FROM blobs WHERE sha256=? AND size=? AND provider='s3' AND location_id=? AND verified_at<>''")
      .get(sha256, size, location.id);
  }

  async preferredUrl(projectId: string, sha256: string, size: number, ttlSec: number): Promise<string | null> {
    if (projectId === PROTECTED_PROJECT_ID || !this.allowDirect()) return null;
    const location = this.location();
    if (!location || !this.has(location, sha256, size)) return null;
    return location.provider.getDownloadUrl(blobKey(sha256), ttlSec);
  }

  /** Bundle preparation can submit a mirror without waiting for the object store. */
  mirror(projectId: string, blob: BlobInput): Promise<void> {
    if (projectId === PROTECTED_PROJECT_ID || !this.allowDirect()) return Promise.resolve();
    const location = this.location();
    if (!location || this.has(location, blob.sha256, blob.size)) return Promise.resolve();
    const key = `${location.id}:${blob.sha256}`;
    const pending = this.pending.get(key);
    if (pending) return pending;
    const upload = this.mutate(async () => {
      if (!this.allowDirect() || this.location()?.id !== location.id || this.has(location, blob.sha256, blob.size)) return;
      await this.mirrorVerified(location, blob);
    })
      .catch(() => this.onFailure())
      .finally(() => { this.pending.delete(key); });
    this.pending.set(key, upload);
    return upload;
  }

  private async mirrorVerified(location: BlobLocation, blob: BlobInput): Promise<void> {
    const path = await realpath(blob.path).catch(() => null);
    if (!path) return;
    if (path.toLowerCase().split(sep).includes(PROTECTED_PROJECT_ID)) return;
    const file = await stat(path).catch(() => null);
    if (!file?.isFile() || file.size !== blob.size) return;
    const { provider } = location;
    const key = blobKey(blob.sha256);
    await provider.put(key, path, blob.sha256);
    const remote = await provider.head(key);
    if (!remote || remote.size !== blob.size || (remote.sha256 && remote.sha256 !== blob.sha256)) {
      throw new Error("Mirrored object metadata does not match");
    }
    if (!remote.sha256) {
      const dir = await mkdtemp(join(tmpdir(), "vg-blob-verify-"));
      try {
        const file = join(dir, "blob");
        await provider.downloadTo(key, file, blob.size);
        if (await sha256File(file) !== blob.sha256) throw new Error("Mirrored object SHA-256 does not match");
      } finally {
        await rm(join(dir, "blob"), { force: true });
        await rmdir(dir);
      }
    }
    // An old mirror can finish after the administrator switches buckets.
    if (this.location()?.id !== location.id) return;
    const now = this.now().toISOString();
    this.db.prepare(`INSERT INTO blobs(sha256,size,provider,key,location_id,stored_at,verified_at) VALUES (?,?,'s3',?,?,?,?)
      ON CONFLICT(sha256) DO UPDATE SET size=excluded.size,provider=excluded.provider,key=excluded.key,
      location_id=excluded.location_id,stored_at=excluded.stored_at,verified_at=excluded.verified_at`)
      .run(blob.sha256, blob.size, key, location.id, now, now);
  }
}
