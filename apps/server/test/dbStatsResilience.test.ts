import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "../src/db/client.js";
import { migrateDatabase } from "../src/db/migrate.js";
import {
  DbProfiler,
  registerTableFlusher,
  wrapDatabase,
} from "../src/db/stats.js";
import { WalCheckpointManager } from "../src/db/checkpoint.js";
import { writeAudit, flushAuditQueue, getPendingAuditCount, clearAuditQueue } from "../src/auth/auditLog.js";
import { NodeService } from "../src/node/nodeService.js";
import { createPipelineHarness } from "./pipelineFixtures.js";

describe("TASK-143 Database Resilience & Profiling", () => {
  let root: string;
  let dbPath: string;
  const cleanups: Array<() => void> = [];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "vg-db-resilience-"));
    dbPath = join(root, "test.db");
  });

  afterEach(() => {
    for (const fn of cleanups.splice(0)) {
      try {
        fn();
      } catch {
        // ignore cleanup errors
      }
    }
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // on Windows file lock, ignore
    }
  });

  it("applies WAL, busy_timeout >= 5000, and synchronous NORMAL pragmas on open", () => {
    const dbHandle = openDatabase(dbPath);
    cleanups.push(() => dbHandle.sqlite.close());

    const journalMode = dbHandle.sqlite.pragma("journal_mode", { simple: true });
    expect(journalMode).toBe("wal");

    const busyTimeout = dbHandle.sqlite.pragma("busy_timeout", { simple: true });
    expect(Number(busyTimeout)).toBeGreaterThanOrEqual(5000);

    const synchronous = dbHandle.sqlite.pragma("synchronous", { simple: true });
    // 1 is NORMAL in SQLite
    expect(Number(synchronous)).toBe(1);
  });

  it("profiles statement executions and calculates p50/p95/max percentiles and slow queries", () => {
    const rawDb = new Database(dbPath);
    cleanups.push(() => rawDb.close());
    const profiler = new DbProfiler(500);
    const wrapped = wrapDatabase(rawDb, { profiler });

    wrapped.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, val TEXT);");
    const insert = wrapped.prepare("INSERT INTO items (val) VALUES (?)");
    for (let i = 0; i < 20; i++) {
      insert.run(`val-${i}`);
    }

    const select = wrapped.prepare("SELECT * FROM items WHERE id = ?");
    for (let i = 1; i <= 20; i++) {
      select.get(i);
    }

    const summary = profiler.getMetricsSummary();
    expect(summary.totalStatements).toBeGreaterThanOrEqual(41);
    expect(summary.p50Ms).toBeGreaterThanOrEqual(0);
    expect(summary.p95Ms).toBeGreaterThanOrEqual(summary.p50Ms);
    expect(summary.maxMs).toBeGreaterThanOrEqual(summary.p95Ms);

    const topSlow = profiler.getTopSlowStatements(10);
    expect(topSlow.length).toBeGreaterThan(0);
    expect(topSlow[0].sql).toBeDefined();
    expect(topSlow[0].count).toBeGreaterThan(0);
  });

  it("handles SQLITE_BUSY with retries and tracks success / failure counts", () => {
    let attempts = 0;
    const mockDb = {
      prepare: (sql: string) => ({
        run: () => {
          attempts++;
          if (attempts <= 2) {
            const busyErr = new Error("database is locked") as Error & { code?: string };
            busyErr.code = "SQLITE_BUSY";
            throw busyErr;
          }
          return { changes: 1 };
        },
        get: () => ({ ok: 1 }),
        all: () => [],
      }),
      exec: () => {},
      pragma: () => [],
    } as unknown as Database.Database;

    const profiler = new DbProfiler();
    const wrapped = wrapDatabase(mockDb, { profiler });

    const stmt = wrapped.prepare("INSERT INTO mock_table VALUES (1)");
    const result = stmt.run();
    expect(result.changes).toBe(1);
    expect(profiler.getBusyRetries()).toBe(2);
    expect(profiler.getBusyRetrySuccessCount()).toBe(1);
    expect(profiler.getBusyRetryFailureCount()).toBe(0);

    // Test retry failure when permanently locked
    const failingMockDb = {
      prepare: () => ({
        run: () => {
          const busyErr = new Error("database is locked") as Error & { code?: string };
          busyErr.code = "SQLITE_BUSY";
          throw busyErr;
        },
      }),
      exec: () => {},
      pragma: () => [],
    } as unknown as Database.Database;

    const failWrapped = wrapDatabase(failingMockDb, { profiler });
    const failStmt = failWrapped.prepare("INSERT INTO locked VALUES (1)");
    expect(() => failStmt.run()).toThrow(/database is locked/);
    expect(profiler.getBusyRetryFailureCount()).toBe(1);
  });

  it("triggers registered table flushers before SELECT queries", () => {
    const rawDb = new Database(dbPath);
    cleanups.push(() => rawDb.close());
    const profiler = new DbProfiler();
    let flushed = false;
    registerTableFlusher("test_buffered_table", () => {
      flushed = true;
    });

    const wrapped = wrapDatabase(rawDb, { profiler });

    wrapped.exec("CREATE TABLE test_buffered_table (id INT);");
    const query = wrapped.prepare("SELECT * FROM test_buffered_table");
    query.all();

    expect(flushed).toBe(true);
  });

  it("batches audit log writes and flushes cleanly on flushAuditQueue", () => {
    const dbHandle = openDatabase(dbPath);
    migrateDatabase(dbHandle.db);
    cleanups.push(() => dbHandle.sqlite.close());

    clearAuditQueue(dbHandle.sqlite);

    writeAudit(dbHandle.sqlite, {
      action: "project.create",
      source: "api",
      outcome: "ok",
      targetType: "project",
      targetId: "p1",
      summary: "test project",
    }, { batch: true });

    writeAudit(dbHandle.sqlite, {
      action: "project.delete",
      source: "api",
      outcome: "ok",
      targetType: "project",
      targetId: "p2",
      summary: "delete project",
    }, { batch: true });

    // In-memory queue holds entries
    expect(getPendingAuditCount(dbHandle.sqlite)).toBeGreaterThanOrEqual(2);

    // Flush to SQLite
    const flushedCount = flushAuditQueue(dbHandle.sqlite);
    expect(flushedCount).toBeGreaterThanOrEqual(2);
    expect(getPendingAuditCount(dbHandle.sqlite)).toBe(0);

    const rows = dbHandle.sqlite.prepare("SELECT * FROM audit_log WHERE target_id IN ('p1', 'p2')").all();
    expect(rows.length).toBe(2);
  });

  it("a failed audit flush puts the queued rows back, writes none, and a retry writes each row once", () => {
    const dbHandle = openDatabase(dbPath);
    migrateDatabase(dbHandle.db);
    cleanups.push(() => dbHandle.sqlite.close());
    // A raw connection: the wrapped handle runs table flushers before SELECT/exec, which would flush the queue early.
    const raw = new Database(dbPath);
    cleanups.push(() => raw.close());
    clearAuditQueue(dbHandle.sqlite);
    // A real database failure on the second row: the trigger aborts that insert, so the whole transaction rolls back.
    raw.exec("CREATE TRIGGER fail_q2 BEFORE INSERT ON audit_log WHEN NEW.target_id = 'q2' BEGIN SELECT RAISE(ABORT, 'audit insert failed'); END;");
    for (const id of ["q1", "q2"]) {
      writeAudit(dbHandle.sqlite, {
        action: "project.create", source: "api", outcome: "ok", targetType: "project", targetId: id, summary: id,
      }, { batch: true });
    }
    expect(getPendingAuditCount(dbHandle.sqlite)).toBe(2);

    expect(() => flushAuditQueue(dbHandle.sqlite)).toThrow(/audit insert failed/);
    expect(getPendingAuditCount(dbHandle.sqlite)).toBe(2);
    const written = (): number => (raw.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE target_id IN ('q1', 'q2')").get() as { n: number }).n;
    expect(written()).toBe(0);

    raw.exec("DROP TRIGGER fail_q2");
    expect(flushAuditQueue(dbHandle.sqlite)).toBe(2);
    expect(getPendingAuditCount(dbHandle.sqlite)).toBe(0);
    expect(written()).toBe(2);
  });

  it("simulates crash loss window: in-memory buffered records before flush are lost on crash", () => {
    const dbHandle = openDatabase(dbPath);
    migrateDatabase(dbHandle.db);
    cleanups.push(() => dbHandle.sqlite.close());

    // Step 1: Flushed items remain safe
    writeAudit(dbHandle.sqlite, {
      action: "item.save",
      source: "api",
      outcome: "ok",
      targetType: "item",
      targetId: "safe-1",
    });
    flushAuditQueue(dbHandle.sqlite);

    // Step 2: Unflushed item within 1-2s window
    writeAudit(dbHandle.sqlite, {
      action: "item.save",
      source: "api",
      outcome: "ok",
      targetType: "item",
      targetId: "loss-window-1",
    }, { batch: true });

    // Clear queue to simulate crash wiping in-memory state before flush
    clearAuditQueue(dbHandle.sqlite);
    dbHandle.sqlite.close();

    // Reopen from disk as if restarted after crash
    const reopened = new Database(dbPath);
    cleanups.push(() => reopened.close());

    const safeRow = reopened.prepare("SELECT * FROM audit_log WHERE target_id = 'safe-1'").get();
    expect(safeRow).toBeDefined();

    const lostRow = reopened.prepare("SELECT * FROM audit_log WHERE target_id = 'loss-window-1'").get();
    expect(lostRow).toBeUndefined(); // correctly lost in crash window
  });

  it("coalesces node heartbeats within 15 seconds when payload is unchanged", () => {
    let nowTime = new Date("2026-11-17T12:00:00.000Z");
    const harness = createPipelineHarness();
    cleanups.push(() => harness.close());

    const service = new NodeService(
      harness.sqlite,
      harness.config,
      harness.repository,
      harness.orchestrator,
      () => nowTime,
    );
    service.clearHeartbeatCache();

    const { token } = service.createJoinToken(undefined);
    const { nodeId } = service.join({
      joinToken: token,
      name: "worker-node-1",
      version: "0.1.0",
      capabilities: ["render"],
      resources: { cpuCores: 8 },
    });
    const node = service.get(nodeId);
    const initialSeen = node.last_seen_at;

    // First heartbeat writes to DB and records baseline state
    nowTime = new Date("2026-11-17T12:00:00.000Z");
    service.heartbeat(node, {
      status: "online",
      version: "0.1.0",
      capabilities: ["render"],
      resources: { cpuCores: 8 },
      running: [],
    });
    const firstSeen = service.get(node.id).last_seen_at;
    expect(firstSeen).toBe("2026-11-17T12:00:00.000Z");

    // Second heartbeat 5s later with identical payload is coalesced (skipped from DB write)
    nowTime = new Date("2026-11-17T12:00:05.000Z");
    service.heartbeat(node, {
      status: "online",
      version: "0.1.0",
      capabilities: ["render"],
      resources: { cpuCores: 8 },
      running: [],
    });
    const coalescedSeen = service.get(node.id).last_seen_at;
    expect(coalescedSeen).toBe(firstSeen); // unchanged!

    // Third heartbeat 20s later (> 15s coalesce interval) writes to DB
    nowTime = new Date("2026-11-17T12:00:25.000Z");
    service.heartbeat(node, {
      status: "online",
      version: "0.1.0",
      capabilities: ["render"],
      resources: { cpuCores: 8 },
      running: [],
    });
    const updatedSeen = service.get(node.id).last_seen_at;
    expect(updatedSeen).toBe("2026-11-17T12:00:25.000Z");

    // Fourth heartbeat with state change (e.g. upgraded node version) immediately updates DB without waiting
    nowTime = new Date("2026-11-17T12:00:26.000Z");
    service.heartbeat(node, {
      status: "online",
      version: "0.2.0",
      capabilities: ["render"],
      resources: { cpuCores: 8 },
      running: [],
    });
    const upgradedRow = service.get(node.id);
    expect(upgradedRow.version).toBe("0.2.0");
    expect(upgradedRow.last_seen_at).toBe("2026-11-17T12:00:26.000Z");
  });

  it("WalCheckpointManager executes wal_checkpoint TRUNCATE when threshold exceeded and on shutdown", () => {
    const rawDb = new Database(dbPath);
    cleanups.push(() => rawDb.close());
    rawDb.pragma("journal_mode = WAL");
    rawDb.exec("CREATE TABLE junk (data BLOB);");

    const manager = new WalCheckpointManager(rawDb, dbPath, {
      thresholdBytes: 100, // Very low threshold so any WAL triggers it
      checkIntervalMs: 60_000,
      logger: {
        info: () => {},
        warn: () => {},
        debug: () => {},
        error: () => {},
      },
    });

    // Fill WAL with some data
    const insert = rawDb.prepare("INSERT INTO junk VALUES (?)");
    for (let i = 0; i < 50; i++) {
      insert.run(Buffer.alloc(1024, "x"));
    }

    const result = manager.checkpoint("TRUNCATE");
    expect(result.mode).toBe("TRUNCATE");
    expect(result.checkpointed).toBeGreaterThanOrEqual(0);
    expect(manager.getLastCheckpoint()).toBeDefined();

    manager.onShutdown();
  });

  it("checks database integrity on startup and handles warning without crashing", () => {
    const logMessages: string[] = [];
    const logger = {
      debug: (msg: string) => logMessages.push(`debug: ${msg}`),
      info: (msg: string) => logMessages.push(`info: ${msg}`),
      warn: (arg: unknown, msg?: string) => logMessages.push(`warn: ${msg ?? JSON.stringify(arg)}`),
      error: (msg: string) => logMessages.push(`error: ${msg}`),
    };

    const dbHandle = openDatabase(dbPath, { logger });
    cleanups.push(() => dbHandle.sqlite.close());

    // When DB is healthy, no warnings are logged
    expect(logMessages.filter((m) => m.startsWith("warn:")).length).toBe(0);
  });

  describe("TASK-143 P1 usage flush", () => {
    function runningJob() {
      const harness = createPipelineHarness();
      cleanups.push(() => harness.close());
      const job = harness.repository.createJob({
        projectId: harness.projectId,
        stage: "VISUAL_SEARCH",
        maxAttempts: 3,
        previousState: "PENDING",
      });
      harness.repository.updateJob(job.id, { status: "RUNNING" });
      return { harness, jobId: job.id };
    }

    it("keeps queued usage when the commit fails and counts it exactly once on retry", () => {
      const { harness, jobId } = runningJob();
      harness.orchestrator.recordUsage(jobId, { llmCalls: 1, costUsd: 0.01 }, { batch: true });
      expect(harness.orchestrator.getPendingUsageCount()).toBe(1);

      const spy = vi.spyOn(harness.repository, "atomic").mockImplementationOnce(() => {
        throw new Error("commit failed");
      });
      expect(() => harness.orchestrator.flushUsage(jobId)).toThrow("commit failed");
      spy.mockRestore();

      // Failed commit: queue retained, job usage untouched.
      expect(harness.orchestrator.getPendingUsageCount()).toBe(1);
      expect(harness.repository.getJob(jobId)?.usage?.llmCalls ?? 0).toBe(0);

      harness.orchestrator.flushUsage(jobId);
      expect(harness.orchestrator.getPendingUsageCount()).toBe(0);
      expect(harness.repository.getJob(jobId)?.usage?.llmCalls).toBe(1);

      // A second flush must not re-add the already committed usage.
      harness.orchestrator.flushUsage(jobId);
      expect(harness.repository.getJob(jobId)?.usage?.llmCalls).toBe(1);
    });

    it("shutdown flush that fails keeps the queue for a later retry", () => {
      const { harness, jobId } = runningJob();
      harness.orchestrator.recordUsage(jobId, { llmCalls: 2, costUsd: 0.02 }, { batch: true });

      const spy = vi.spyOn(harness.repository, "atomic").mockImplementationOnce(() => {
        throw new Error("disk busy");
      });
      expect(() => harness.orchestrator.stop()).toThrow("disk busy");
      spy.mockRestore();

      expect(harness.orchestrator.getPendingUsageCount()).toBe(1);
      harness.orchestrator.flushUsage();
      expect(harness.orchestrator.getPendingUsageCount()).toBe(0);
      expect(harness.repository.getJob(jobId)?.usage?.llmCalls).toBe(2);
    });

    it("cancelling a running job commits its batched usage before it ends as CANCELLED", () => {
      const { harness, jobId } = runningJob();
      harness.orchestrator.recordUsage(jobId, { llmCalls: 3, costUsd: 0.03 }, { batch: true });
      expect(harness.orchestrator.getPendingUsageCount()).toBe(1);
      harness.orchestrator.cancel(harness.projectId);
      expect(harness.repository.getJob(jobId)?.status).toBe("CANCELLED");
      expect(harness.repository.getJob(jobId)?.usage?.llmCalls).toBe(3);
      expect(harness.orchestrator.getPendingUsageCount()).toBe(0);
    });

    it("rolls back the first job's write when the second update fails inside the real atomic, then counts each once", () => {
      const harness = createPipelineHarness();
      cleanups.push(() => harness.close());
      const ids = [1, 2].map(() => {
        const job = harness.repository.createJob({ projectId: harness.projectId, stage: "VISUAL_SEARCH", maxAttempts: 3, previousState: "PENDING" });
        harness.repository.updateJob(job.id, { status: "RUNNING" });
        return job.id;
      });
      for (const id of ids) harness.orchestrator.recordUsage(id, { llmCalls: 1, costUsd: 0.01 }, { batch: true });

      const realUpdate = harness.repository.updateJob.bind(harness.repository);
      let calls = 0;
      const spy = vi.spyOn(harness.repository, "updateJob").mockImplementation((id, patch) => {
        calls += 1;
        if (calls === 2) throw new Error("second update failed");
        return realUpdate(id, patch);
      });
      expect(() => harness.orchestrator.flushUsage()).toThrow("second update failed");
      spy.mockRestore();

      // Real transaction: the first job's committed-in-transaction write must be rolled back.
      for (const id of ids) expect(harness.repository.getJob(id)?.usage?.llmCalls ?? 0).toBe(0);
      expect(harness.orchestrator.getPendingUsageCount()).toBe(2);

      harness.orchestrator.flushUsage();
      expect(harness.orchestrator.getPendingUsageCount()).toBe(0);
      for (const id of ids) expect(harness.repository.getJob(id)?.usage?.llmCalls).toBe(1);
    });
  });
});
