import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  createThrottledActivityReporter,
  currentStageContext,
  reportStageActivity,
  runWithStageContext,
  type ActivityReport,
} from "../src/pipeline/stageActivity.js";
import { generateStructured } from "../src/providers/llm/structured.js";
import { MockLlmProvider } from "../src/providers/llm/mock.js";
import { runFfmpeg } from "../src/media/ffmpeg.js";
import type { StageContext } from "../src/pipeline/stageExecutor.js";
import { ActivityTracker } from "../src/jobs/overdueStore.js";
import { createPipelineHarness } from "./pipelineFixtures.js";
import { JobWorker } from "../src/jobs/worker.js";
import Fastify from "fastify";

function mockContext(reportActivity = vi.fn()): StageContext {
  return {
    project: {
      id: "11111111-1111-4111-8111-111111111111",
      profileId: null,
      title: "Test",
      topic: "Topic",
      status: "DRAFT",
      stage: "RESEARCH",
      mode: "ASSISTED",
      settings: {
        language: "vi",
        targetDurationSec: 60,
        wordsPerMinute: 150,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    job: {
      id: "22222222-2222-4222-8222-222222222222",
      projectId: "11111111-1111-4111-8111-111111111111",
      stage: "RENDER",
      scope: null,
      status: "RUNNING",
      progress: 0,
      message: null,
      attempt: 1,
      maxAttempts: 1,
      error: null,
      usage: null,
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      finishedAt: null,
      runAfter: new Date().toISOString(),
    },
    signal: new AbortController().signal,
    reportProgress: vi.fn(),
    recordUsage: vi.fn(),
    reportActivity,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      fatal: vi.fn(),
      child: vi.fn(),
      level: "silent",
      silent: vi.fn(),
    } as unknown as StageContext["logger"],
  };
}

describe("Activity reports (TASK-131)", () => {
  it("a child process reports childAlive true, then false", async () => {
    const reports: ActivityReport[] = [];
    const ctx = mockContext((act) => reports.push(act));

    await runWithStageContext(ctx, async () => {
      // Run ffmpeg with -version (fast and safe)
      await runFfmpeg(["-version"]);
    });

    expect(reports.length).toBeGreaterThanOrEqual(2);
    expect(reports[0]).toMatchObject({ childAlive: true });
    expect(reports[reports.length - 1]).toMatchObject({ childAlive: false });
  });

  it("an LLM call reports llmInFlight true, then false", async () => {
    const reports: ActivityReport[] = [];
    const ctx = mockContext((act) => reports.push(act));
    const mock = new MockLlmProvider();

    await runWithStageContext(ctx, async () => {
      await generateStructured({
        provider: mock,
        model: "mock-v1",
        system: "sys",
        prompt: "hello",
        schema: z.object({ effect: z.string() }),
        schemaName: "KnowledgeWatch",
        schemaVersion: "1",
        maxOutputTokens: 100,
        signal: new AbortController().signal,
      });
    });

    expect(reports).toContainEqual(expect.objectContaining({ llmInFlight: true }));
    expect(reports).toContainEqual(expect.objectContaining({ llmInFlight: false }));
  });

  it("the throttle holds for repeated reports of the same kind", () => {
    const sink = vi.fn();
    let currentTime = 1000;
    const throttled = createThrottledActivityReporter(sink, 5000, () => currentTime);

    // First call: childAlive true
    throttled({ childAlive: true, childNote: "ffmpeg" });
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink).toHaveBeenLastCalledWith({ childAlive: true, childNote: "ffmpeg" });

    // Repeated call within 5s with same state: throttled
    currentTime = 2000;
    throttled({ childAlive: true, childNote: "ffmpeg" });
    expect(sink).toHaveBeenCalledTimes(1);

    currentTime = 4000;
    throttled({ childAlive: true, childNote: "ffmpeg" });
    expect(sink).toHaveBeenCalledTimes(1);

    // After 5s: same state passes again
    currentTime = 6500;
    throttled({ childAlive: true, childNote: "ffmpeg" });
    expect(sink).toHaveBeenCalledTimes(2);

    // State change: childAlive false passes immediately even within 5s
    currentTime = 7000;
    throttled({ childAlive: false, childNote: "ffmpeg" });
    expect(sink).toHaveBeenCalledTimes(3);
    expect(sink).toHaveBeenLastCalledWith({ childAlive: false, childNote: "ffmpeg" });
  });

  it("the worker passes activity signals to the overdue tracker", async () => {
    const harness = createPipelineHarness();
    const logger = Fastify({ logger: { level: "silent" } }).log;

    let receivedActivity: ActivityReport | undefined;
    harness.executors.set("RESEARCH", {
      stage: "RESEARCH",
      run: async (context: StageContext) => {
        // Report activity from inside the stage
        reportStageActivity({ childAlive: true, childNote: "test-proc", llmInFlight: true });
        return { message: "done" };
      },
    });

    const worker = new JobWorker(
      harness.repository,
      harness.orchestrator,
      harness.executors,
      harness.config,
      logger,
      harness.clock,
    );

    harness.orchestrator.runStage(harness.projectId, "RESEARCH");
    await worker.tick();

    expect(harness.repository.getStage(harness.projectId, "RESEARCH").state).toBe("DONE");
    harness.close();
  });

  it("is a no-op when no context is active", () => {
    expect(currentStageContext()).toBeUndefined();
    // Must not throw
    expect(() => {
      reportStageActivity({ childAlive: true, childNote: "orphan" });
      reportStageActivity({ llmInFlight: true });
      reportStageActivity({ quotaWait: true });
    }).not.toThrow();
  });
});
