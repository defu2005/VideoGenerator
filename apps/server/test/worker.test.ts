import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { buildHealthReport } from "../src/api/health.js";
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
      config: { STAGE_TIMEOUT_MS: 600_000, JOB_MAX_ATTEMPTS: 2, JOB_RETRY_BASE_MS: 0 },
    });
    const project = harness.repository.getProject(harness.projectId)!;
    harness.sqlite.prepare("UPDATE projects SET settings = ? WHERE id = ?").run(JSON.stringify({
      ...project.settings,
      stageTimeouts: {
        source: "mixed",
        inputHash: "test",
        summary: "test",
        stages: { RESEARCH: { timeoutMs: 10, reason: "test", source: "user" } },
      },
    }), harness.projectId);
    harness.orchestrator.runStage(harness.projectId, "RESEARCH");
    await harness.worker.tick();
    expect(harness.repository.getActiveJob(harness.projectId)?.attempt).toBe(2);
    await harness.worker.tick();
    const stage = harness.repository.getStage(harness.projectId, "RESEARCH");
    expect(stage.state).toBe("FAILED");
    expect(stage.error?.code).toBe("STAGE_TIMEOUT");
    expect(stage.error?.message).toMatch(/^Bước .+ chạy quá 1 phút \(dự án \d+ cảnh, lần 2\/2\)/);
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

  it("runs one render at a time while an LLM job from another project runs beside it", async () => {
    const harness = makeHarness({ config: { WORKER_CONCURRENCY: 3, RENDER_CONCURRENCY: 1, FAKE_STAGE_DELAY_MS: 0 } });
    const otherRender = randomUUID();
    const researchProject = randomUUID();
    const createdAt = harness.clock().toISOString();
    const insert = harness.sqlite.prepare(
      "INSERT INTO projects (id, title, description, topic, mode, settings, status, stage, thumbnail_path, duration_sec, version, created_at, updated_at, archived_at, run_mode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const settings = JSON.stringify({
      language: "en",
      targetDurationSec: 120,
      aspectRatio: "16:9",
      edit: { engine: "legacy" },
      stageExecutors: {},
      autoRender: false,
    });
    for (const id of [otherRender, researchProject]) {
      insert.run(id, "Lane", "", "Topic", "ASSISTED", settings, "DRAFT", "TOPIC", null, null, 1, createdAt, createdAt, null, null);
      harness.repository.ensureStages(id);
    }
    const queue = (projectId: string, stage: "RENDER" | "RESEARCH") => {
      const job = harness.repository.createJob({ projectId, stage, maxAttempts: 1, previousState: "PENDING" });
      harness.repository.updateStage(projectId, stage, { state: "QUEUED", progress: 0, message: "Waiting for a worker", jobId: job.id });
      return job;
    };
    queue(harness.projectId, "RENDER");
    queue(otherRender, "RENDER");
    queue(researchProject, "RESEARCH");

    let rendersRunning = 0;
    let maxRenders = 0;
    let llmWhileRender = false;
    let releaseRender: () => void = () => undefined;
    let releaseResearch: () => void = () => undefined;
    let renderCalls = 0;
    harness.executors.set("RENDER", {
      stage: "RENDER",
      async run() {
        renderCalls += 1;
        rendersRunning += 1;
        maxRenders = Math.max(maxRenders, rendersRunning);
        if (renderCalls === 1) await new Promise<void>((resolve) => { releaseRender = resolve; });
        rendersRunning -= 1;
        return { message: "rendered" };
      },
    });
    harness.executors.set("RESEARCH", {
      stage: "RESEARCH",
      async run() {
        llmWhileRender = rendersRunning > 0;
        await new Promise<void>((resolve) => { releaseResearch = resolve; });
        return { message: "researched" };
      },
    });

    const pending = harness.worker.tick();
    expect(maxRenders).toBe(1);
    expect(llmWhileRender).toBe(true);
    expect(buildHealthReport(harness.sqlite, harness.config.RENDER_CONCURRENCY).render).toBe("render: 1/1 đang chạy");
    releaseRender();
    releaseResearch();
    await pending;
    const renders = harness.sqlite.prepare("SELECT status FROM jobs WHERE stage = 'RENDER' ORDER BY rowid").all() as Array<{ status: string }>;
    expect(renders.map((row) => row.status)).toEqual(["SUCCEEDED", "QUEUED"]);
    expect(maxRenders).toBe(1);

    await harness.worker.tick();
    const finished = harness.sqlite.prepare("SELECT status FROM jobs WHERE stage = 'RENDER' ORDER BY rowid").all() as Array<{ status: string }>;
    expect(finished.map((row) => row.status)).toEqual(["SUCCEEDED", "SUCCEEDED"]);
    expect(maxRenders).toBe(1);
  });
});
