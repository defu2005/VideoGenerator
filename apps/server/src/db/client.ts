import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";
import { wrapDatabase, type WrappedDatabase } from "./stats.js";
import { WalCheckpointManager } from "./checkpoint.js";

export type AppDatabase = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

export interface OpenDatabaseOptions {
  logger?: {
    warn: (obj: unknown, msg?: string) => void;
    info: (obj: unknown, msg?: string) => void;
  };
}

export function openDatabase(
  path: string,
  options?: OpenDatabaseOptions,
): { sqlite: WrappedDatabase; db: AppDatabase; checkpointManager: WalCheckpointManager } {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const sqlite = new Database(path);

  // Pragmas per TASK-143: WAL, busy_timeout >= 5000, synchronous = NORMAL, foreign_keys = ON
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = ON");

  // Startup check: PRAGMA quick_check (warning on failure, do not crash)
  try {
    const checkResult = sqlite.pragma("quick_check") as Array<{ quick_check: string }>;
    const status = checkResult[0]?.quick_check;
    if (status !== "ok") {
      const msg = `SQLite quick_check reported non-ok status: ${status ?? "unknown"}`;
      if (options?.logger) options.logger.warn({ quickCheck: checkResult }, msg);
      else console.warn(`[WARN] ${msg}`);
    }
  } catch (error) {
    const msg = `SQLite quick_check execution failed: ${error instanceof Error ? error.message : String(error)}`;
    if (options?.logger) options.logger.warn({ err: error }, msg);
    else console.warn(`[WARN] ${msg}`);
  }

  // Litestream status check
  if (process.env.LITESTREAM_REPLICA_URL) {
    const replicaMsg = `Litestream replica URL detected: ${process.env.LITESTREAM_REPLICA_URL}`;
    if (options?.logger) options.logger.info({ replicaUrl: process.env.LITESTREAM_REPLICA_URL }, replicaMsg);
    else console.info(`[INFO] ${replicaMsg}`);
  }

  const wrapped = wrapDatabase(sqlite, { dbPath: path });
  const checkpointManager = new WalCheckpointManager(wrapped, path);

  return {
    sqlite: wrapped,
    db: drizzle(wrapped, { schema }),
    checkpointManager,
  };
}

