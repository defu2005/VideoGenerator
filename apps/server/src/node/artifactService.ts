import { createHash } from "node:crypto";
import { closeSync, createReadStream, existsSync, fstatSync, openSync, readSync, statSync, type BigIntStats } from "node:fs";
import type Database from "better-sqlite3";

export function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(path).on("data", (chunk) => hash.update(chunk)).on("error", reject).on("end", () => resolve(hash.digest("hex")));
  });
}

/** Content-addressed files on the main machine. A file is found by its sha256, never by a path from a request. */
export class ArtifactService {
  private readonly registeredVersions = new Map<string, { stamp: string; sha256: string; size: number }>();

  constructor(private readonly sqlite: Database.Database, private readonly now: () => Date = () => new Date()) {}

  /** Hash a file once; the hash is reused while its size and mtime stay the same. */
  async register(path: string): Promise<{ sha256: string; size: number }> {
    const stat = statSync(path);
    const known = this.sqlite.prepare("SELECT sha256, size FROM artifacts WHERE path = ? AND size = ? AND mtime_ms = ?")
      .get(path, stat.size, Math.trunc(stat.mtimeMs)) as { sha256: string; size: number } | undefined;
    if (known) return known;
    const sha256 = await sha256File(path);
    this.remember(path, sha256, stat.size, stat.mtimeMs);
    return { sha256, size: stat.size };
  }

  /** Pipeline transitions run inside synchronous SQLite transactions. Reuse a hash only
   * if the same file and change stamp are still present. Read in bounded chunks. */
  registerSync(path: string): { sha256: string; size: number } {
    const stamp = (stat: BigIntStats) => `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
    const stat = statSync(path, { bigint: true });
    if (!stat.isFile()) throw new Error("Artifact is not a file");
    const before = stamp(stat);
    const known = this.registeredVersions.get(path);
    if (known?.stamp === before) return { sha256: known.sha256, size: known.size };
    const fd = openSync(path, "r");
    try {
      const hash = createHash("sha256");
      const buffer = Buffer.allocUnsafe(1024 * 1024);
      let read: number;
      while ((read = readSync(fd, buffer)) > 0) hash.update(buffer.subarray(0, read));
      if (stamp(fstatSync(fd, { bigint: true })) !== before || stamp(statSync(path, { bigint: true })) !== before) {
        throw new Error("Artifact changed while hashing");
      }
      const sha256 = hash.digest("hex"), size = Number(stat.size);
      this.remember(path, sha256, size, Number(stat.mtimeNs / 1_000_000n));
      if (this.registeredVersions.size >= 4096) this.registeredVersions.clear();
      this.registeredVersions.set(path, { stamp: before, sha256, size });
      return { sha256, size };
    } finally { closeSync(fd); }
  }

  private remember(path: string, sha256: string, size: number, mtimeMs: number) {
    this.sqlite.prepare(
      `INSERT INTO artifacts (sha256, size, path, mtime_ms, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(sha256) DO UPDATE SET size = excluded.size, path = excluded.path, mtime_ms = excluded.mtime_ms`,
    ).run(sha256, size, path, Math.trunc(mtimeMs), this.now().toISOString());
  }

  /** The file for a hash, or undefined when it is unknown, gone or changed since it was hashed. */
  locate(sha256: string): { path: string; size: number } | undefined {
    const row = this.sqlite.prepare("SELECT path, size, mtime_ms FROM artifacts WHERE sha256 = ?").get(sha256) as
      { path: string; size: number; mtime_ms: number } | undefined;
    if (!row || !existsSync(row.path)) return undefined;
    const stat = statSync(row.path);
    if (stat.size !== row.size || Math.trunc(stat.mtimeMs) !== row.mtime_ms) return undefined;
    return { path: row.path, size: row.size };
  }
}
