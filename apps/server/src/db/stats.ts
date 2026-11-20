import type Database from "better-sqlite3";
import { existsSync, statSync } from "node:fs";
import { flushAuditQueue } from "../auth/auditLog.js";

export type DbStatementStat = {
  sql: string;
  count: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  totalMs: number;
};

export type DbCheckpointInfo = {
  timestamp: string | null;
  mode: string | null;
  busy: number;
  log: number;
  checkpointed: number;
};

export type DbStats = {
  dbSize: number;
  walSize: number;
  busyCount: number;
  busyRetrySuccessCount: number;
  busyRetryFailureCount: number;
  lastCheckpoint: DbCheckpointInfo | null;
  pragmas: {
    journalMode: string;
    busyTimeout: number;
    synchronous: string;
  };
  topSlowStatements: DbStatementStat[];
};

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  const weight = rank - lower;
  return Number((sorted[lower] * (1 - weight) + sorted[upper] * weight).toFixed(2));
}

function syncSleep(ms: number): void {
  if (ms <= 0) return;
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      /* busy spin fallback */
    }
  }
}

function isBusyError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as { code?: string; message?: string };
  return err.code === "SQLITE_BUSY" ||
    (typeof err.message === "string" && (
      err.message.includes("SQLITE_BUSY") ||
      err.message.includes("database is locked") ||
      err.message.includes("database table is locked")
    ));
}

type StatementMetrics = {
  count: number;
  totalMs: number;
  maxMs: number;
  durations: number[];
};

const globalFlushers = new Map<string, Array<() => void>>();

export function registerTableFlusher(tableName: string, flusher: () => void): void {
  const list = globalFlushers.get(tableName) ?? [];
  list.push(flusher);
  globalFlushers.set(tableName, list);
}

export class DbProfiler {
  private statements = new Map<string, StatementMetrics>();
  private busyRetries = 0;
  private busyRetrySuccesses = 0;
  private busyRetryFailures = 0;
  private maxSamplesPerStatement = 200;
  private flushers = new Map<string, Array<() => void>>();
  public onBeforeQuery?: (sql: string) => void;

  constructor(options?: { maxSamplesPerStatement?: number }) {
    if (options?.maxSamplesPerStatement) {
      this.maxSamplesPerStatement = options.maxSamplesPerStatement;
    }
  }

  registerFlusher(tableName: string, flusher: () => void): void {
    const list = this.flushers.get(tableName) ?? [];
    list.push(flusher);
    this.flushers.set(tableName, list);
  }

  notifyBeforeQuery(sql: string): void {
    if (this.onBeforeQuery) {
      try {
        this.onBeforeQuery(sql);
      } catch {
        // ignore
      }
    }
    const allTables = new Set([...this.flushers.keys(), ...globalFlushers.keys()]);
    for (const table of allTables) {
      if (sql.includes(table)) {
        const local = this.flushers.get(table) ?? [];
        const global = globalFlushers.get(table) ?? [];
        for (const fn of [...local, ...global]) {
          try {
            fn();
          } catch {
            // ignore
          }
        }
      }
    }
  }

  recordBusyRetry(): void {
    this.busyRetries++;
  }

  recordBusySuccess(): void {
    this.busyRetrySuccesses++;
  }

  recordBusyFailure(): void {
    this.busyRetryFailures++;
  }

  getBusyRetries(): number {
    return this.busyRetries;
  }

  getBusyRetrySuccessCount(): number {
    return this.busyRetrySuccesses;
  }

  getBusyRetryFailureCount(): number {
    return this.busyRetryFailures;
  }

  getMetricsSummary(): { totalStatements: number; p50Ms: number; p95Ms: number; maxMs: number } {
    let totalStatements = 0;
    let allDurations: number[] = [];
    let overallMaxMs = 0;

    for (const metrics of this.statements.values()) {
      totalStatements += metrics.count;
      allDurations.push(...metrics.durations);
      if (metrics.maxMs > overallMaxMs) overallMaxMs = metrics.maxMs;
    }

    allDurations.sort((a, b) => a - b);
    return {
      totalStatements,
      p50Ms: percentile(allDurations, 50),
      p95Ms: percentile(allDurations, 95),
      maxMs: Number(overallMaxMs.toFixed(2)),
    };
  }

  recordStatement(sql: string, durationMs: number): void {
    const key = sql.trim();
    let metrics = this.statements.get(key);
    if (!metrics) {
      metrics = { count: 0, totalMs: 0, maxMs: 0, durations: [] };
      this.statements.set(key, metrics);
    }
    metrics.count++;
    metrics.totalMs += durationMs;
    if (durationMs > metrics.maxMs) metrics.maxMs = durationMs;

    if (metrics.durations.length < this.maxSamplesPerStatement) {
      metrics.durations.push(durationMs);
    } else {
      // Reservoir replacement when capped
      const idx = Math.floor(Math.random() * metrics.count);
      if (idx < this.maxSamplesPerStatement) {
        metrics.durations[idx] = durationMs;
      }
    }
  }

  getTopSlowStatements(limit = 10): DbStatementStat[] {
    const list: DbStatementStat[] = [];
    for (const [sql, metrics] of this.statements.entries()) {
      const sorted = [...metrics.durations].sort((a, b) => a - b);
      list.push({
        sql,
        count: metrics.count,
        p50Ms: percentile(sorted, 50),
        p95Ms: percentile(sorted, 95),
        maxMs: Number(metrics.maxMs.toFixed(2)),
        totalMs: Number(metrics.totalMs.toFixed(2)),
      });
    }

    // Sort by p95 descending, then maxMs descending
    list.sort((a, b) => b.p95Ms - a.p95Ms || b.maxMs - a.maxMs);
    return list.slice(0, limit);
  }

  clear(): void {
    this.statements.clear();
    this.busyRetries = 0;
  }
}

export type WrappedDatabase = Database.Database & {
  profiler: DbProfiler;
  lastCheckpoint: DbCheckpointInfo | null;
  getDbStats: (dbPath?: string) => DbStats;
  checkpoint: (mode?: "PASSIVE" | "FULL" | "RESTART" | "TRUNCATE") => DbCheckpointInfo;
};

const WRAPPED_MARKER = Symbol.for("vg.db.wrapped");

export function wrapDatabase(
  sqlite: Database.Database,
  options?: { profiler?: DbProfiler; dbPath?: string },
): WrappedDatabase {
  if ((sqlite as unknown as Record<symbol, unknown>)[WRAPPED_MARKER]) {
    return sqlite as WrappedDatabase;
  }

  const profiler = options?.profiler ?? new DbProfiler();
  profiler.registerFlusher("audit_log", () => {
    try {
      flushAuditQueue(sqlite);
    } catch {
      // ignore
    }
  });
  let lastCheckpoint: DbCheckpointInfo | null = null;
  const configuredPath = options?.dbPath ?? sqlite.name;

  function executeWithRetry<T>(sql: string, fn: () => T): T {
    let attempts = 0;
    const maxAttempts = 5;
    const start = performance.now();

    while (true) {
      try {
        const result = fn();
        if (attempts > 0) {
          profiler.recordBusySuccess();
        }
        const duration = performance.now() - start;
        profiler.recordStatement(sql, duration);
        return result;
      } catch (error) {
        if (isBusyError(error) && attempts < maxAttempts) {
          attempts++;
          profiler.recordBusyRetry();
          const backoffMs = Math.min(200, 10 * Math.pow(2, attempts - 1) + Math.floor(Math.random() * 10));
          syncSleep(backoffMs);
          continue;
        }
        if (attempts > 0 || isBusyError(error)) {
          profiler.recordBusyFailure();
        }
        const duration = performance.now() - start;
        profiler.recordStatement(sql, duration);
        throw error;
      }
    }
  }

  const origPrepare = sqlite.prepare.bind(sqlite);
  const origExec = sqlite.exec.bind(sqlite);

  sqlite.exec = function (sql: string) {
    profiler.notifyBeforeQuery(sql);
    return executeWithRetry(sql, () => origExec(sql));
  };

  sqlite.prepare = function (source: string) {
    profiler.notifyBeforeQuery(source);
    const stmt = origPrepare(source);

    const handler: ProxyHandler<Database.Statement> = {
      get(target, prop, receiver) {
        if (prop === "run") {
          return function (...params: unknown[]) {
            return executeWithRetry(source, () => target.run(...params));
          };
        }
        if (prop === "get") {
          return function (...params: unknown[]) {
            return executeWithRetry(source, () => target.get(...params));
          };
        }
        if (prop === "all") {
          return function (...params: unknown[]) {
            return executeWithRetry(source, () => target.all(...params));
          };
        }
        if (prop === "iterate") {
          return function (...params: unknown[]) {
            return executeWithRetry(source, () => target.iterate(...params));
          };
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    };

    return new Proxy(stmt, handler);
  } as unknown as typeof sqlite.prepare;

  function checkpoint(mode: "PASSIVE" | "FULL" | "RESTART" | "TRUNCATE" = "TRUNCATE"): DbCheckpointInfo {
    try {
      const rows = sqlite.pragma(`wal_checkpoint(${mode})`) as Array<{ busy: number; log: number; checkpointed: number }>;
      const row = rows[0] ?? { busy: 0, log: 0, checkpointed: 0 };
      lastCheckpoint = {
        timestamp: new Date().toISOString(),
        mode,
        busy: row.busy,
        log: row.log,
        checkpointed: row.checkpointed,
      };
      return lastCheckpoint;
    } catch (error) {
      lastCheckpoint = {
        timestamp: new Date().toISOString(),
        mode,
        busy: 1,
        log: -1,
        checkpointed: -1,
      };
      return lastCheckpoint;
    }
  }

  function getDbStats(dbPath?: string): DbStats {
    const targetPath = dbPath ?? configuredPath;
    let dbSize = 0;
    let walSize = 0;

    if (targetPath && targetPath !== ":memory:" && existsSync(targetPath)) {
      try {
        dbSize = statSync(targetPath).size;
      } catch {
        // ignore
      }
      const walPath = `${targetPath}-wal`;
      if (existsSync(walPath)) {
        try {
          walSize = statSync(walPath).size;
        } catch {
          // ignore
        }
      }
    }

    let journalMode = "unknown";
    let busyTimeout = 0;
    let synchronous = "unknown";

    try {
      const jm = sqlite.pragma("journal_mode", { simple: true });
      journalMode = String(jm);
    } catch {
      // ignore
    }

    try {
      const bt = sqlite.pragma("busy_timeout", { simple: true });
      busyTimeout = Number(bt) || 0;
    } catch {
      // ignore
    }

    try {
      const syn = sqlite.pragma("synchronous", { simple: true });
      const synNum = Number(syn);
      if (synNum === 0) synchronous = "OFF";
      else if (synNum === 1) synchronous = "NORMAL";
      else if (synNum === 2) synchronous = "FULL";
      else if (synNum === 3) synchronous = "EXTRA";
      else synchronous = String(syn);
    } catch {
      // ignore
    }

    return {
      dbSize,
      walSize,
      busyCount: profiler.getBusyRetries(),
      busyRetrySuccessCount: profiler.getBusyRetrySuccessCount(),
      busyRetryFailureCount: profiler.getBusyRetryFailureCount(),
      lastCheckpoint,
      pragmas: {
        journalMode,
        busyTimeout,
        synchronous,
      },
      topSlowStatements: profiler.getTopSlowStatements(10),
    };
  }

  const wrapped = sqlite as WrappedDatabase;
  (wrapped as unknown as Record<symbol, unknown>)[WRAPPED_MARKER] = true;
  wrapped.profiler = profiler;
  wrapped.lastCheckpoint = lastCheckpoint;
  wrapped.getDbStats = getDbStats;
  wrapped.checkpoint = checkpoint;

  return wrapped;
}
