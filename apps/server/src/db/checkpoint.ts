import type Database from "better-sqlite3";
import { existsSync, statSync } from "node:fs";
import type { DbCheckpointInfo, WrappedDatabase } from "./stats.js";

export const DEFAULT_WAL_THRESHOLD_BYTES = 16 * 1024 * 1024; // 16 MB

export class WalCheckpointManager {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly sqlite: Database.Database,
    private readonly dbPath: string,
    private readonly thresholdBytes: number = DEFAULT_WAL_THRESHOLD_BYTES,
  ) {}

  getWalPath(): string {
    return `${this.dbPath}-wal`;
  }

  getWalSize(): number {
    const walPath = this.getWalPath();
    if (this.dbPath === ":memory:" || !existsSync(walPath)) return 0;
    try {
      return statSync(walPath).size;
    } catch {
      return 0;
    }
  }

  private lastCheckpoint: DbCheckpointInfo | null = null;

  getLastCheckpoint(): DbCheckpointInfo | null {
    const wrapped = this.sqlite as Partial<WrappedDatabase>;
    return wrapped.lastCheckpoint ?? this.lastCheckpoint;
  }

  checkpoint(mode: "PASSIVE" | "FULL" | "RESTART" | "TRUNCATE" = "TRUNCATE"): DbCheckpointInfo {
    const wrapped = this.sqlite as Partial<WrappedDatabase>;
    if (typeof wrapped.checkpoint === "function") {
      const res = wrapped.checkpoint(mode);
      this.lastCheckpoint = res;
      return res;
    }

    try {
      const rows = this.sqlite.pragma(`wal_checkpoint(${mode})`) as Array<{ busy: number; log: number; checkpointed: number }>;
      const row = rows[0] ?? { busy: 0, log: 0, checkpointed: 0 };
      this.lastCheckpoint = {
        timestamp: new Date().toISOString(),
        mode,
        busy: row.busy,
        log: row.log,
        checkpointed: row.checkpointed,
      };
      return this.lastCheckpoint;
    } catch {
      this.lastCheckpoint = {
        timestamp: new Date().toISOString(),
        mode,
        busy: 1,
        log: -1,
        checkpointed: -1,
      };
      return this.lastCheckpoint;
    }
  }

  checkAndCheckpoint(force = false): DbCheckpointInfo | null {
    if (this.running) return null;
    const currentWalSize = this.getWalSize();
    if (force || currentWalSize >= this.thresholdBytes) {
      this.running = true;
      try {
        return this.checkpoint("TRUNCATE");
      } finally {
        this.running = false;
      }
    }
    return null;
  }

  start(intervalMs = 30_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      try {
        this.checkAndCheckpoint();
      } catch {
        // checkpoint errors caught and ignored in background tick
      }
    }, intervalMs);
    // Unref so timer doesn't prevent Node process exit in scripts/tests
    if (this.timer && typeof this.timer.unref === "function") {
      this.timer.unref();
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  onShutdown(): DbCheckpointInfo | null {
    this.stop();
    try {
      return this.checkpoint("TRUNCATE");
    } catch {
      return null;
    }
  }
}
