import { afterEach, describe, expect, it, vi } from "vitest";
import { clearAuditQueue, flushAuditQueue, getPendingAuditCount, writeAudit } from "../src/auth/auditLog.js";
import { createPipelineHarness } from "./pipelineFixtures.js";

// TASK-143: terminal-job usage and audit queue retention when the commit fails.
const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

describe("usage and audit flush resilience (TASK-143)", () => {
  it("writes usage for a terminal job immediately when allowTerminal is set", () => {
    const harness = createPipelineHarness();
    cleanups.push(() => harness.close());
    const job = harness.repository.createJob({ projectId: harness.projectId, stage: "VISUAL_SEARCH", maxAttempts: 3, previousState: "PENDING" });
    harness.repository.updateJob(job.id, { status: "CANCELLED" });

    harness.orchestrator.recordUsage(job.id, { llmCalls: 3, costUsd: 0.03 }, { allowTerminal: true });

    expect(harness.orchestrator.getPendingUsageCount()).toBe(0);
    expect(harness.repository.getJob(job.id)?.usage?.llmCalls).toBe(3);
  });

  it("keeps batched usage of a running job when the user cancels it through the orchestrator", () => {
    const harness = createPipelineHarness();
    cleanups.push(() => harness.close());
    const job = harness.repository.createJob({ projectId: harness.projectId, stage: "VISUAL_SEARCH", maxAttempts: 3, previousState: "PENDING" });
    harness.repository.updateJob(job.id, { status: "RUNNING" });
    harness.orchestrator.recordUsage(job.id, { llmCalls: 4, costUsd: 0.04 }, { batch: true });
    expect(harness.orchestrator.getPendingUsageCount()).toBe(1);

    harness.orchestrator.cancel(harness.projectId, "VISUAL_SEARCH");
    harness.orchestrator.flushUsage();

    expect(harness.repository.getJob(job.id)?.status).toBe("CANCELLED");
    expect(harness.repository.getJob(job.id)?.usage?.llmCalls).toBe(4);
  });

  it("keeps audit rows queued when the audit commit fails, then writes them once on retry", () => {
    const harness = createPipelineHarness();
    cleanups.push(() => {
      clearAuditQueue(harness.sqlite);
      harness.close();
    });
    writeAudit(harness.sqlite, { action: "test.queued", outcome: "ok", source: "api" } as never, { batch: true });
    writeAudit(harness.sqlite, { action: "test.queued_2", outcome: "ok", source: "api" } as never, { batch: true });
    expect(getPendingAuditCount(harness.sqlite)).toBe(2);

    // Inject a commit failure on the audit transaction.
    const spy = vi.spyOn(harness.sqlite, "transaction").mockImplementationOnce(() => () => {
      throw new Error("audit commit failed");
    });
    expect(() => flushAuditQueue(harness.sqlite)).toThrow("audit commit failed");
    spy.mockRestore();
    expect(getPendingAuditCount(harness.sqlite)).toBe(2);

    expect(flushAuditQueue(harness.sqlite)).toBe(2);
    expect(getPendingAuditCount(harness.sqlite)).toBe(0);
    const count = harness.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action LIKE 'test.queued%'").get() as { n: number };
    expect(count.n).toBe(2);

    // A second flush must not duplicate rows.
    expect(flushAuditQueue(harness.sqlite)).toBe(0);
    const after = harness.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action LIKE 'test.queued%'").get() as { n: number };
    expect(after.n).toBe(2);
  });

  it("keeps batched job usage queued when the flush commit fails, then persists it exactly once", () => {
    const harness = createPipelineHarness();
    cleanups.push(() => harness.close());
    const job = harness.repository.createJob({ projectId: harness.projectId, stage: "SCRIPT", maxAttempts: 3, previousState: "PENDING" });
    harness.repository.updateJob(job.id, { status: "RUNNING" });
    harness.orchestrator.recordUsage(job.id, { llmCalls: 1, inputTokens: 23, outputTokens: 7, costUsd: 0.01 }, { batch: true });

    const originalAtomic = harness.repository.atomic;
    harness.repository.atomic = () => {
      throw Object.assign(new Error("injected offline transaction failure"), { code: "SQLITE_BUSY" });
    };
    try {
      expect(() => harness.orchestrator.flushUsage()).toThrow("injected offline transaction failure");
    } finally {
      harness.repository.atomic = originalAtomic;
    }
    expect(harness.orchestrator.getPendingUsageCount()).toBe(1);
    expect(harness.repository.getJob(job.id)?.usage?.llmCalls ?? 0).toBe(0);

    harness.orchestrator.flushUsage();
    expect(harness.orchestrator.getPendingUsageCount()).toBe(0);
    expect(harness.repository.getJob(job.id)?.usage?.llmCalls).toBe(1);
    expect(harness.repository.getJob(job.id)?.usage?.costUsd).toBeCloseTo(0.01);

    // A further flush with nothing queued must not add usage again.
    harness.orchestrator.flushUsage();
    expect(harness.repository.getJob(job.id)?.usage?.llmCalls).toBe(1);
  });

  it("rolls back the whole batch when the second job write fails inside the real transaction, then retries each job once", () => {
    const harness = createPipelineHarness();
    cleanups.push(() => harness.close());
    const first = harness.repository.createJob({ projectId: harness.projectId, stage: "SCRIPT", maxAttempts: 3, previousState: "PENDING" });
    const second = harness.repository.createJob({ projectId: harness.projectId, stage: "VISUAL_SEARCH", maxAttempts: 3, previousState: "PENDING" });
    harness.repository.updateJob(first.id, { status: "RUNNING" });
    harness.repository.updateJob(second.id, { status: "RUNNING" });
    harness.orchestrator.recordUsage(first.id, { llmCalls: 2, costUsd: 0.02 }, { batch: true });
    harness.orchestrator.recordUsage(second.id, { llmCalls: 5, costUsd: 0.05 }, { batch: true });
    expect(harness.orchestrator.getPendingUsageCount()).toBe(2);

    // Real atomic transaction; the second usage write throws, so the first write must roll back.
    const originalUpdate = harness.repository.updateJob.bind(harness.repository);
    const spy = vi.spyOn(harness.repository, "updateJob").mockImplementation((id: string, patch: never) => {
      if (id === second.id && (patch as { usage?: unknown }).usage) throw new Error("injected second write failure");
      return originalUpdate(id, patch);
    });
    expect(() => harness.orchestrator.flushUsage()).toThrow("injected second write failure");
    spy.mockRestore();

    expect(harness.repository.getJob(first.id)?.usage?.llmCalls ?? 0).toBe(0);
    expect(harness.repository.getJob(second.id)?.usage?.llmCalls ?? 0).toBe(0);
    expect(harness.orchestrator.getPendingUsageCount()).toBe(2);

    harness.orchestrator.flushUsage();
    expect(harness.orchestrator.getPendingUsageCount()).toBe(0);
    expect(harness.repository.getJob(first.id)?.usage?.llmCalls).toBe(2);
    expect(harness.repository.getJob(second.id)?.usage?.llmCalls).toBe(5);
  });

  it("stop() after a failed flush persists the queued usage on clean shutdown", () => {
    const harness = createPipelineHarness();
    cleanups.push(() => harness.close());
    const job = harness.repository.createJob({ projectId: harness.projectId, stage: "SCRIPT", maxAttempts: 3, previousState: "PENDING" });
    harness.repository.updateJob(job.id, { status: "RUNNING" });
    harness.orchestrator.recordUsage(job.id, { llmCalls: 3, costUsd: 0.03 }, { batch: true });

    const originalAtomic = harness.repository.atomic;
    harness.repository.atomic = () => {
      throw Object.assign(new Error("injected offline transaction failure"), { code: "SQLITE_BUSY" });
    };
    try {
      expect(() => harness.orchestrator.flushUsage()).toThrow();
    } finally {
      harness.repository.atomic = originalAtomic;
    }
    expect(harness.orchestrator.getPendingUsageCount()).toBe(1);

    harness.orchestrator.stop();
    expect(harness.orchestrator.getPendingUsageCount()).toBe(0);
    expect(harness.repository.getJob(job.id)?.usage?.llmCalls).toBe(3);
  });
});
