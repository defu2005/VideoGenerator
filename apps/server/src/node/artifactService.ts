import { createHash } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import type Database from "better-sqlite3";

export function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(path).on("data", (chunk) => hash.update(chunk)).on("error", reject).on("end", () => resolve(hash.digest("hex")));
  });
}

/** Content-addressed files on the main machine. A file is found by its sha256, never by a path from a request. */
export class ArtifactService {
  constructor(private readonly sqlite: Database.Database, private readonly now: () => Date = () => new Date()) {}

  /** Hash a file once; the hash is reused while its size and mtime stay the same. */
  async register(path: string): Promise<{ sha256: string; size: number }> {
    const stat = statSync(path);
    const known = this.sqlite.prepare("SELECT sha256, size FROM artifacts WHERE path = ? AND size = ? AND mtime_ms = ?")
      .get(path, stat.size, Math.trunc(stat.mtimeMs)) as { sha256: string; size: number } | undefined;
    if (known) return known;
    const sha256 = await sha256File(path);
    this.sqlite.prepare(
      `INSERT INTO artifacts (sha256, size, path, mtime_ms, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(sha256) DO UPDATE SET size = excluded.size, path = excluded.path, mtime_ms = excluded.mtime_ms`,
    ).run(sha256, stat.size, path, Math.trunc(stat.mtimeMs), this.now().toISOString());
    return { sha256, size: stat.size };
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
