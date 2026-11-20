import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeService } from "../../src/node/nodeService.js";
import { writeAudit, flushAuditQueue } from "../../src/auth/auditLog.js";
import { createPipelineHarness } from "../pipelineFixtures.js";

// TASK-143 load benchmark. Synchronous on purpose: better-sqlite3 is synchronous,
// so the workload runs as ordered loops. Profiler counters are cleared after
// setup so percentiles and counts cover only the measured workload.
// Not part of the normal suite: run with RUN_LOAD_TEST=1.

export type LoadTestResult = {
  nodeCount: number;
  heartbeatCalls: number;
  usageWrites: number;
  jobClaims: number;
  totalStatements: number;
  durationMs: number;
  statementsPerSec: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  busyCount: number;
  busyRetrySuccessCount: number;
  busyRetryFailureCount: number;
  dbSizeBytes: number;
  walSizeBytes: number;
};

export function runLoadBenchmark(nodeCounts = [5, 20, 50]): LoadTestResult[] {
  const results: LoadTestResult[] = [];

  for (const n of nodeCounts) {
    const root = mkdtempSync(join(tmpdir(), `vg-load-${n}-`));
    const harness = createPipelineHarness();
    const dbHandle = harness.sqlite;

    const clock = () => new Date();
    const nodeService = new NodeService(harness.sqlite, harness.config, harness.repository, harness.orchestrator, clock);

    // Setup (not measured): register N nodes through the real join path.
    const nodeIds: string[] = [];
    for (let i = 0; i < n; i++) {
      const { token } = nodeService.createJoinToken(undefined);
      const { nodeId } = nodeService.join({
        joinToken: token,
        name: `load-node-${n}-${i}`,
        version: "0.1.0",
        capabilities: ["render"],
        resources: { cpuCores: 8, ramBytes: 16_000_000_000 },
      });
      nodeIds.push(nodeId);
    }

    dbHandle.profiler.clear();
    const startTime = performance.now();

    // 1. Each node sends 8 heartbeats through the real heartbeat path (coalescing applies).
    let heartbeatCalls = 0;
    for (const nodeId of nodeIds) {
      const nodeRow = nodeService.get(nodeId);
      for (let step = 0; step < 8; step++, heartbeatCalls++) {
        nodeService.heartbeat(nodeRow, {
          status: "online",
          version: "0.1.0",
          capabilities: ["render"],
          resources: { cpuCores: 8 },
          running: [],
          load: { cpuPercent: 10 + (step % 5), ramUsedBytes: 2_000_000_000 + step * 10_000_000, activeJobs: 0 },
        });
      }
    }

    // 2. 40 LLM usage writes per node-count run (direct insert; the relay batcher is not exercised here).
    const insertUsage = harness.sqlite.prepare(`
      INSERT INTO llm_relay_usage (
        id, caller, workspace_id, model, job_id, input_tokens, output_tokens,
        cost_usd, estimated, status, code, latency_ms, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const usageWrites = 40;
    for (let m = 0; m < usageWrites; m++) {
      insertUsage.run(
        `usage-${n}-${m}`, "user", null, "omniroute:fast", `load-job-${n}-${m % 10}`,
        500, 200, 0.003, 0, "ok", null, 420, new Date().toISOString(),
      );
      if (m % 5 === 0) {
        writeAudit(harness.sqlite, { action: "llm.generate", source: "api", outcome: "ok", summary: `call-${m}` });
      }
    }

    // 3. Job creation and lease claims (10 per run).
    const jobClaims = 10;
    for (let j = 0; j < jobClaims; j++) {
      const job = harness.repository.createJob({
        projectId: harness.projectId,
        stage: "RENDER",
        maxAttempts: 3,
        previousState: "PENDING",
      });
      harness.repository.setJobLease(job.id, {
        nodeId: nodeIds[j % nodeIds.length],
        leaseId: `lease-${j}`,
        leaseUntil: new Date(Date.now() + 60_000).toISOString(),
        heartbeatAt: new Date().toISOString(),
      });
    }

    flushAuditQueue(harness.sqlite);
    const durationMs = performance.now() - startTime;

    const stats = dbHandle.getDbStats();
    const summary = dbHandle.profiler.getMetricsSummary();
    results.push({
      nodeCount: n,
      heartbeatCalls,
      usageWrites,
      jobClaims,
      totalStatements: summary.totalStatements,
      durationMs: Number(durationMs.toFixed(1)),
      statementsPerSec: Number((summary.totalStatements / (durationMs / 1000)).toFixed(0)),
      p50Ms: summary.p50Ms,
      p95Ms: summary.p95Ms,
      maxMs: summary.maxMs,
      busyCount: stats.busyCount,
      busyRetrySuccessCount: stats.busyRetrySuccessCount,
      busyRetryFailureCount: stats.busyRetryFailureCount,
      dbSizeBytes: stats.dbSize,
      walSizeBytes: stats.walSize,
    });

    harness.close();
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // Windows file locks: ignore
    }
  }

  return results;
}

if (process.env.RUN_LOAD_TEST === "1") {
  console.log("=== CONTROL-PLANE LOAD BENCHMARK (TASK-143) ===");
  const results = runLoadBenchmark();
  console.table(
    results.map((r) => ({
      Nodes: r.nodeCount,
      Heartbeats: r.heartbeatCalls,
      "Stmts/s": r.statementsPerSec,
      "Total Stmts": r.totalStatements,
      "Duration (ms)": r.durationMs,
      "p50 (ms)": r.p50Ms,
      "p95 (ms)": r.p95Ms,
      "max (ms)": r.maxMs,
      SQLITE_BUSY: r.busyCount,
      "Retry OK": r.busyRetrySuccessCount,
      "Retry Fail": r.busyRetryFailureCount,
    })),
  );
}
