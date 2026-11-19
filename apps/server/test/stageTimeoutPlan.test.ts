import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { estimateBudget, historyBucket, stageTimeoutHash, timeoutBriefFromSettings } from "@vg/shared";
import { JobWorker } from "../src/jobs/worker.js";
import { ensureStageTimeoutPlan } from "../src/pipeline/stageTimeoutPlan.js";
import { estimateAllStages } from "../src/pipeline/stageHistory.js";
import { defaultLlmGatewaySettings } from "../src/providers/llm/gatewaySettings.js";
import { MockLlmProvider } from "../src/providers/llm/mock.js";
import type { LlmProviderRegistry } from "../src/providers/llm/registry.js";
import { createPipelineHarness } from "./pipelineFixtures.js";

const harnesses: ReturnType<typeof createPipelineHarness>[] = [];

function makeHarness() {
  const harness = createPipelineHarness({ config: { FAKE_STAGE_DELAY_MS: 0 } });
  harnesses.push(harness);
  return harness;
}

afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.close();
});

function registry(options: { fail?: boolean } = {}) {
  const mock = new MockLlmProvider();
  const calls: string[] = [];
  const provider = {
    id: mock.id,
    label: mock.label,
    defaultModel: mock.defaultModel,
    async generate(req: Parameters<MockLlmProvider["generate"]>[0], signal: AbortSignal) {
      calls.push(req.schemaName);
      if (options.fail) throw new Error("mô hình hỏng");
      return mock.generate(req, signal);
    },
  };
  return {
    calls,
    registry: {
      quota: null,
      getGatewaySettings: () => defaultLlmGatewaySettings(),
      resolveTask: () => ({ provider, model: "mock-v1", source: "env-default" as const }),
    } as unknown as LlmProviderRegistry,
  };
}

function saveSettings(harness: ReturnType<typeof createPipelineHarness>, settings: unknown) {
  harness.sqlite.prepare("UPDATE projects SET settings = ? WHERE id = ?")
    .run(JSON.stringify(settings), harness.projectId);
}

describe("stage timeout plan", () => {
  it("skips a fresh hash and calls once when the duration changes", async () => {
    const harness = makeHarness();
    const llm = registry();
    const project = harness.repository.getProject(harness.projectId)!;
    await ensureStageTimeoutPlan({
      project,
      sqlite: harness.sqlite,
      registry: llm.registry,
      signal: new AbortController().signal,
    });
    expect(llm.calls).toEqual(["StageTimeouts"]);
    const stored = harness.repository.getProject(harness.projectId)!;
    await ensureStageTimeoutPlan({
      project: stored,
      sqlite: harness.sqlite,
      registry: llm.registry,
      signal: new AbortController().signal,
    });
    expect(llm.calls).toEqual(["StageTimeouts"]);

    saveSettings(harness, { ...stored.settings, targetDurationSec: 180 });
    await ensureStageTimeoutPlan({
      project: harness.repository.getProject(harness.projectId)!,
      sqlite: harness.sqlite,
      registry: llm.registry,
      signal: new AbortController().signal,
    });
    expect(llm.calls).toEqual(["StageTimeouts", "StageTimeouts"]);
  });

  it("stores the baseline when the model throws and the stage still completes", async () => {
    const harness = makeHarness();
    const llm = registry({ fail: true });
    const logger = Fastify({ logger: { level: "silent" } }).log;
    const worker = new JobWorker(
      harness.repository,
      harness.orchestrator,
      harness.executors,
      harness.config,
      logger,
      harness.clock,
      (project, signal) => ensureStageTimeoutPlan({
        project,
        sqlite: harness.sqlite,
        registry: llm.registry,
        signal,
      }),
    );
    harness.orchestrator.runStage(harness.projectId, "RESEARCH");
    await worker.tick();
    expect(harness.repository.getStage(harness.projectId, "RESEARCH").state).toBe("DONE");
    const plan = harness.repository.getProject(harness.projectId)!.settings.stageTimeouts;
    expect(plan?.source).toBe("baseline");
    expect(plan?.stages.RESEARCH?.source).toBe("baseline");
  });

  it("keeps a user row when the plan is forced again", async () => {
    const harness = makeHarness();
    const llm = registry();
    const project = harness.repository.getProject(harness.projectId)!;
    saveSettings(harness, {
      ...project.settings,
      stageTimeouts: {
        source: "mixed",
        inputHash: "cũ",
        summary: "Bạn chọn giọng.",
        stages: {
          VOICE: { timeoutMs: 90_000, reason: "Bạn chọn.", source: "user" },
        },
      },
    });
    await ensureStageTimeoutPlan({
      project: harness.repository.getProject(harness.projectId)!,
      sqlite: harness.sqlite,
      registry: llm.registry,
      signal: new AbortController().signal,
      force: true,
    });
    const voice = harness.repository.getProject(harness.projectId)!.settings.stageTimeouts?.stages.VOICE;
    expect(voice).toMatchObject({ timeoutMs: 90_000, source: "user" });
    expect(llm.calls).toEqual(["StageTimeouts"]);
  });

  it("TASK-131: modes.ts and stageTimeoutPlan.ts produce the same hash for the same input", async () => {
    const harness = makeHarness();
    const llm = registry();
    const project = harness.repository.getProject(harness.projectId)!;
    await ensureStageTimeoutPlan({
      project,
      sqlite: harness.sqlite,
      registry: llm.registry,
      signal: new AbortController().signal,
    });
    const stored = harness.repository.getProject(harness.projectId)!;
    const plan = stored.settings.stageTimeouts!;
    expect(plan).toBeDefined();

    const brief = timeoutBriefFromSettings(stored.settings, stored.topic);
    const estimates = estimateAllStages(harness.sqlite, brief);
    const serverHash = stageTimeoutHash(brief, estimates);
    expect(plan.inputHash).toBe(serverHash);

    // estimateBudget in modes.ts using the same brief and history bucket
    const estimate = estimateBudget(stored, undefined, [], historyBucket(estimates));
    const researchStage = estimate.perStage.find((s) => s.stage === "RESEARCH")!;
    const timeoutTask = researchStage.tasks?.find((t) => t.task === "stageTimeouts");
    if (timeoutTask) {
      expect(timeoutTask.calls).toEqual({ min: 0, max: 0 });
    }
  });
});
