import { afterEach, describe, expect, it } from "vitest";
import { createPipelineHarness, drainUntilGate } from "./pipelineFixtures.js";

const harnesses: ReturnType<typeof createPipelineHarness>[] = [];
function makeHarness(options: Parameters<typeof createPipelineHarness>[0] = {}) {
  const harness = createPipelineHarness(options);
  harnesses.push(harness);
  return harness;
}

afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.close();
});

describe("pipeline worker", () => {
  it("retries retryable failures with exponential backoff and succeeds on the next attempt", async () => {
    const harness = makeHarness({ failures: { RESEARCH: "once" } });
    harness.orchestrator.runStage(harness.projectId, "RESEARCH");
    await harness.worker.tick();
    let job = harness.repository.getActiveJob(harness.projectId);
    expect(job?.status).toBe("QUEUED");
    expect(job?.attempt).toBe(2);
    expect(Date.parse(job!.runAfter) - harness.clock().getTime()).toBe(2_000);
    harness.advance(2_000);
    await harness.worker.tick();
    job = harness.repository.listJobs(harness.projectId, 1)[0];
    expect(job.status).toBe("SUCCEEDED");
    expect(job.attempt).toBe(2);
  });

  it("fails non-retryable errors immediately and exhausts retry attempts", async () => {
    const nonRetryable = makeHarness({ failures: { RESEARCH: "non_retryable" } });
    nonRetryable.orchestrator.runStage(nonRetryable.projectId, "RESEARCH");
    await nonRetryable.worker.tick();
    expect(nonRetryable.repository.getStage(nonRetryable.projectId, "RESEARCH").error?.retryable).toBe(false);
    expect(nonRetryable.repository.getProject(nonRetryable.projectId)?.status).toBe("FAILED");

    const exhausted = makeHarness({
      failures: { RESEARCH: "always" },
      config: { JOB_MAX_ATTEMPTS: 2, JOB_RETRY_BASE_MS: 0 },
    });
    exhausted.orchestrator.runStage(exhausted.projectId, "RESEARCH");
    await exhausted.worker.tick();
    await exhausted.worker.tick();
    expect(exhausted.repository.listJobs(exhausted.projectId, 1)[0].status).toBe("FAILED");
    expect(exhausted.repository.getProject(exhausted.projectId)?.status).toBe("FAILED");
  });

  it("continues an assisted run after retrying a failed stage", async () => {
    const harness = makeHarness({ failures: { VOICE: "non_retryable" } });
    harness.orchestrator.runAll(harness.projectId);
    await drainUntilGate(harness);
    harness.orchestrator.approveGate(harness.projectId, "VISUAL_REVIEW");
    for (let iteration = 0; iteration < 10; iteration += 1) {
      if (harness.repository.getProject(harness.projectId)?.status === "FAILED") break;
      await harness.worker.tick();
    }

    expect(harness.repository.getProject(harness.projectId)?.status).toBe("FAILED");
    expect(harness.orchestrator.getPipeline(harness.projectId).runMode).toBe("ALL");

    harness.executors.set("VOICE", { run: async () => ({ message: "VOICE completed" }) });
    harness.orchestrator.retry(harness.projectId, "VOICE");
    await drainUntilGate(harness);

    const state = harness.orchestrator.getPipeline(harness.projectId);
    expect(state.currentStage).toBe("MUSIC_REVIEW");
    expect(state.stages.find((stage) => stage.stage === "VOICE")?.state).toBe("DONE");
    expect(state.stages.find((stage) => stage.stage === "SUBTITLE")?.state).toBe("DONE");
    expect(state.stages.find((stage) => stage.stage === "MUSIC_SEARCH")?.state).toBe("DONE");
    expect(state.stages.find((stage) => stage.stage === "MUSIC_REVIEW")?.state).toBe("WAITING_USER");
  });

  it("times out a stage and records retryable STAGE_TIMEOUT", async () => {
    const harness = makeHarness({
      failures: { RESEARCH: "hang" },
      config: { STAGE_TIMEOUT_MS: 10, JOB_MAX_ATTEMPTS: 2, JOB_RETRY_BASE_MS: 0 },
    });
    harness.orchestrator.runStage(harness.projectId, "RESEARCH");
    await harness.worker.tick();
    expect(harness.repository.getActiveJob(harness.projectId)?.attempt).toBe(2);
    await harness.worker.tick();
    const stage = harness.repository.getStage(harness.projectId, "RESEARCH");
    expect(stage.state).toBe("FAILED");
    expect(stage.error?.code).toBe("STAGE_TIMEOUT");
  });

  it("cancels a running executor promptly and restores the stage", async () => {
    const harness = makeHarness({ config: { FAKE_STAGE_DELAY_MS: 5_000 } });
    harness.orchestrator.runStage(harness.projectId, "RESEARCH");
    const running = harness.worker.tick();
    const started = Date.now();
    harness.orchestrator.cancel(harness.projectId);
    await running;
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(harness.orchestrator.getPipeline(harness.projectId).activeJob).toBeNull();
    expect(harness.repository.getStage(harness.projectId, "RESEARCH").state).toBe("PENDING");
  });

  it("resumes a RUNNING database job as QUEUED at startup", async () => {
    const harness = makeHarness();
    harness.orchestrator.runStage(harness.projectId, "RESEARCH");
    const queued = harness.repository.getActiveJob(harness.projectId)!;
    harness.repository.atomic(() => {
      harness.repository.updateJob(queued.id, { status: "RUNNING", startedAt: harness.clock().toISOString() });
      harness.repository.updateStage(harness.projectId, "RESEARCH", { state: "RUNNING" });
    });
    await harness.worker.start();
    expect(harness.repository.getActiveJob(harness.projectId)?.status).toBe("QUEUED");
    await harness.worker.tick();
    expect(harness.repository.getStage(harness.projectId, "RESEARCH").state).toBe("DONE");
  });
});
