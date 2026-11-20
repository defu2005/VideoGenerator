import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import type { WrappedDatabase } from "../db/stats.js";
import type { WalCheckpointManager } from "../db/checkpoint.js";

export function registerAdminDbStatsRoutes(
  server: FastifyInstance,
  sqlite: Database.Database,
  checkpointManager?: WalCheckpointManager,
): void {
  server.get("/api/admin/db-stats", async () => {
    const wrapped = sqlite as Partial<WrappedDatabase>;
    if (typeof wrapped.getDbStats === "function") {
      return wrapped.getDbStats();
    }
    return {
      dbSize: 0,
      walSize: 0,
      busyCount: 0,
      busyRetrySuccessCount: 0,
      busyRetryFailureCount: 0,
      lastCheckpoint: null,
      pragmas: {
        journalMode: "unknown",
        busyTimeout: 0,
        synchronous: "unknown",
      },
      topSlowStatements: [],
    };
  });

  server.post("/api/admin/db-stats/checkpoint", async () => {
    const checkpointInfo = checkpointManager?.checkpoint("TRUNCATE") ?? null;
    const wrapped = sqlite as Partial<WrappedDatabase>;
    const stats = typeof wrapped.getDbStats === "function" ? wrapped.getDbStats() : null;
    return {
      checkpoint: checkpointInfo,
      stats,
    };
  });
}
