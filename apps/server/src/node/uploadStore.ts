import type Database from "better-sqlite3";
import { mkdir, open, stat, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import type { Readable } from "node:stream";
import { AppError } from "../lib/errors.js";
import { sha256File, type ArtifactService } from "./artifactService.js";

export type OutputUpload = { jobId: string; leaseId: string; name: string; sha256: string; size: number };
export type StoredUpload = OutputUpload & { path: string; receivedBytes: number; status: "partial" | "ready" | "linked" };

export class NodeUploadStore {
  private readonly writers = new Set<string>();
  private readonly table: "node_uploads" | "run_uploads";
  private readonly ownerColumn: "job_id" | "run_id";
  private get columns() { return `${this.ownerColumn} AS jobId,lease_id AS leaseId,name,sha256,size,path,received_bytes AS receivedBytes,status`; }

  constructor(private readonly db: Database.Database, private readonly artifacts: ArtifactService,
    private readonly maxBytes: number, private readonly now: () => Date = () => new Date(), scope: "job" | "run" = "job") {
    this.table = scope === "job" ? "node_uploads" : "run_uploads";
    this.ownerColumn = scope === "job" ? "job_id" : "run_id";
  }

  get(jobId: string, leaseId: string, name: string): StoredUpload | undefined {
    return this.db.prepare(`SELECT ${this.columns} FROM ${this.table} WHERE ${this.ownerColumn}=? AND lease_id=? AND name=?`).get(jobId, leaseId, name) as StoredUpload | undefined;
  }

  ready(jobId: string, leaseId: string): Map<string, StoredUpload> {
    const rows = this.db.prepare(`SELECT ${this.columns} FROM ${this.table} WHERE ${this.ownerColumn}=? AND lease_id=? AND status IN ('ready','linked')`).all(jobId, leaseId) as StoredUpload[];
    return new Map(rows.map((row) => [row.name, row]));
  }

  private validate(output: OutputUpload) {
    if (!/^[a-f0-9]{64}$/.test(output.sha256)) throw new AppError(400, "SHA256_REQUIRED", "Thiếu mã SHA-256 hợp lệ.");
    if (!Number.isSafeInteger(output.size) || output.size < 0 || output.size > this.maxBytes) {
      throw new AppError(422, "UPLOAD_TOO_LARGE", "Kích thước tệp tải lên vượt giới hạn hoặc không hợp lệ.");
    }
    const existing = this.get(output.jobId, output.leaseId, output.name);
    if (existing && (existing.sha256 !== output.sha256 || existing.size !== output.size)) {
      throw new AppError(409, "UPLOAD_CHANGED", "Tệp tải lên không khớp mã SHA-256 hoặc kích thước đã khai báo.");
    }
    return existing;
  }

  private insert(output: OutputUpload, path: string, received: number, status: StoredUpload["status"]) {
    this.db.prepare(`INSERT INTO ${this.table}(${this.ownerColumn},lease_id,name,sha256,size,path,received_bytes,status,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(output.jobId, output.leaseId, output.name, output.sha256, output.size, path, received, status, this.now().toISOString());
  }

  linkKnown(output: OutputUpload, allowed: (path: string) => boolean = () => true): boolean {
    const existing = this.validate(output);
    if (existing) return existing.status !== "partial";
    const known = this.artifacts.locate(output.sha256);
    if (!known || known.size !== output.size || !allowed(known.path)) return false;
    this.insert(output, known.path, output.size, "linked");
    return true;
  }

  saveVerified(output: OutputUpload, path: string, install: () => void): StoredUpload {
    return this.db.transaction((): StoredUpload => {
      const existing = this.validate(output);
      if (existing && existing.status !== "partial") return existing;
      if (existing) throw new AppError(409, "UPLOAD_BUSY", "Tệp này đã bắt đầu tải theo phiên có thể tiếp tục.");
      install();
      this.insert(output, path, output.size, "ready");
      return { ...output, path, status: "ready", receivedBytes: output.size };
    }).immediate();
  }

  /** A killed process can leave the file ahead of the DB. Only fully verified rows are usable for finalize. */
  private async fileOffset(row: StoredUpload): Promise<number> {
    if (row.status === "linked") return row.size;
    const info = await stat(row.path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    const size = info?.size ?? 0;
    if (size > row.size || (row.status === "ready" && size !== row.size)) throw new AppError(409, "UPLOAD_CHANGED", "Tệp tải lên đã thay đổi trên ổ đĩa.");
    return size;
  }

  async offset(jobId: string, leaseId: string, name: string): Promise<{ receivedBytes: number; size?: number }> {
    const row = this.get(jobId, leaseId, name);
    return row ? { receivedBytes: await this.fileOffset(row), size: row.size } : { receivedBytes: 0 };
  }

  async append(output: OutputUpload, path: string, offset: number, body: Readable, guard: () => void): Promise<StoredUpload> {
    const key = JSON.stringify([output.jobId, output.leaseId, output.name]);
    if (!Number.isSafeInteger(offset) || offset < 0) throw new AppError(400, "UPLOAD_OFFSET_INVALID", "Upload-Offset phải là số nguyên không âm.");
    if (this.writers.has(key)) throw new AppError(409, "UPLOAD_BUSY", "Tệp này đang được tải lên.");
    this.writers.add(key);
    try {
      guard();
      let row = this.validate(output);
      if (!row) {
        if (offset !== 0) throw new AppError(409, "UPLOAD_OFFSET_MISMATCH", "Vị trí bắt đầu tải lên không khớp.");
        this.insert(output, path, 0, "partial");
        row = { ...output, path, receivedBytes: 0, status: "partial" };
      }
      let received = await this.fileOffset(row);
      if (offset !== received) throw new AppError(409, "UPLOAD_OFFSET_MISMATCH", "Vị trí tiếp tục tải lên không khớp.", { offset: received });
      if (row.status !== "partial") {
        body.resume();
        return row;
      }
      await mkdir(dirname(row.path), { recursive: true });
      const handle = await open(row.path, "a");
      try {
        for await (const input of body) {
          const chunk = Buffer.isBuffer(input) ? input : Buffer.from(input);
          if (received + chunk.length > output.size) throw new AppError(422, "UPLOAD_TOO_LARGE", "Tệp vượt kích thước đã khai báo.");
          guard();
          await handle.writeFile(chunk);
          received += chunk.length;
        }
      } finally {
        try { await handle.sync(); } finally { await handle.close(); }
        this.db.prepare(`UPDATE ${this.table} SET received_bytes=? WHERE ${this.ownerColumn}=? AND lease_id=? AND name=?`)
          .run(received, output.jobId, output.leaseId, output.name);
      }
      guard();
      if (received < output.size) return { ...row, receivedBytes: received };
      const sha256 = await sha256File(row.path);
      guard();
      if (sha256 !== output.sha256) {
        await unlink(row.path);
        this.db.prepare(`UPDATE ${this.table} SET received_bytes=0 WHERE ${this.ownerColumn}=? AND lease_id=? AND name=?`)
          .run(output.jobId, output.leaseId, output.name);
        throw new AppError(422, "SHA256_MISMATCH", "Mã SHA-256 của tệp không khớp.");
      }
      this.db.prepare(`UPDATE ${this.table} SET status='ready' WHERE ${this.ownerColumn}=? AND lease_id=? AND name=?`)
        .run(output.jobId, output.leaseId, output.name);
      return { ...row, receivedBytes: received, status: "ready" };
    } finally { this.writers.delete(key); }
  }
}
