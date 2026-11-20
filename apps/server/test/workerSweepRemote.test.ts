import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listOverdueChecks, readOverdueMark } from "../src/jobs/overdueStore.js";
import { createPipelineHarness } from "./pipelineFixtures.js";

// The 10 s timer must run sweepRemote for leased remote jobs. agentStage.test.ts calls sweepRemote
// directly, so these tests go through the timer to prove the wiring. A remote job past its limit gets
// an overdue mark and keeps its lease: the clock never kills it (only the decider or the node does).
const HOUR = 3_600_000;

describe("worker timer runs sweepRemote for leased remote jobs", () => {
  let h: ReturnType<typeof createPipelineHarness>;
  beforeEach(() => { vi.useFakeTimers(); h = createPipelineHarness(); });
  afterEach(async () => {
    await h.worker.stop?.();
    h.close();
    vi.useRealTimers();
  });

  /** Sets up the worker and a RESEARCH job, then marks it as leased and started `startedAgoMs` ago. Setup order matters: start() requeues RUNNING jobs. */
  async function startLeasedJob(startedAgoMs: number): Promise<string> {
    const project = h.repository.getProject(h.projectId)!;
    h.sqlite.prepare("UPDATE projects SET settings = ? WHERE id = ?").run(JSON.stringify({
      ...project.settings,
      onOverdue: "abort",
      stageTimeouts: { source: "mixed", inputHash: "fixture", summary: "fixture", stages: { RESEARCH: { timeoutMs: HOUR, reason: "test", source: "user" } } },
    }), h.projectId);
    h.worker.setOverdue({ sqlite: h.sqlite });
    h.worker.setSweep(() => {});
    h.repository.ensureStages(h.projectId);
    const job = h.repository.createJob({ projectId: h.projectId, stage: "RESEARCH", maxAttempts: 3, previousState: "PENDING" });
    await h.worker.start();
    const now = h.clock().getTime();
    h.sqlite.prepare("UPDATE jobs SET status = 'RUNNING', lease_id = ?, started_at = ?, heartbeat_at = ? WHERE id = ?")
      .run("lease-1", new Date(now - startedAgoMs).toISOString(), new Date(now).toISOString(), job.id);
    return job.id;
  }

  it("marks a leased job past its limit on the 10 s tick and leaves it running with its lease", async () => {
    const id = await startLeasedJob(2 * HOUR);
    expect(readOverdueMark(h.sqlite, id)).toBeNull();
    vi.advanceTimersByTime(10_000);
    expect(readOverdueMark(h.sqlite, id)).not.toBeNull();
    // The first overdue check runs async after the mark; wait for it before asserting the job is still held.
    await vi.waitFor(() => expect(listOverdueChecks(h.sqlite, id).length).toBeGreaterThan(0));
    expect(h.repository.getJob(id)?.status).toBe("RUNNING");
    expect((h.sqlite.prepare("SELECT lease_id AS l FROM jobs WHERE id = ?").get(id) as { l: string | null }).l).toBe("lease-1");
  });

  it("leaves a leased job under its limit alone", async () => {
    const id = await startLeasedJob(60_000);
    vi.advanceTimersByTime(10_000);
    vi.advanceTimersByTime(10_000);
    expect(readOverdueMark(h.sqlite, id)).toBeNull();
    expect(h.repository.getJob(id)?.status).toBe("RUNNING");
  });

  it("clears the overdue mark on the next tick once the lease is gone", async () => {
    const id = await startLeasedJob(2 * HOUR);
    vi.advanceTimersByTime(10_000);
    expect(readOverdueMark(h.sqlite, id)).not.toBeNull();
    h.sqlite.prepare("UPDATE jobs SET lease_id = NULL WHERE id = ?").run(id);
    vi.advanceTimersByTime(10_000);
    // Read the column directly: readOverdueMark only reports RUNNING jobs.
    expect((h.sqlite.prepare("SELECT overdue_at AS o FROM jobs WHERE id = ?").get(id) as { o: string | null }).o).toBeNull();
  });
});
