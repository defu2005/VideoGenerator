import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LlmProviderRegistry } from "../src/providers/llm/registry.js";
import { ScriptSchema } from "@vg/shared";
import { ResearchExecutor } from "../src/stages/research/researchExecutor.js";
import { ScriptExecutor } from "../src/stages/script/scriptExecutor.js";
import { drainUntilGate } from "./pipelineFixtures.js";
import { StageError, type StageContext } from "../src/pipeline/stageExecutor.js";
import type { AppConfig } from "../src/lib/config.js";
import { createPipelineHarness } from "./pipelineFixtures.js";

const harnesses: ReturnType<typeof createPipelineHarness>[] = [];
function makeHarness(config: Record<string, unknown> = {}) {
  const harness = createPipelineHarness({ config: config as Partial<AppConfig> });
  harnesses.push(harness);
  return harness;
}

afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.close();
});

function contextFor(harness: ReturnType<typeof createPipelineHarness>, stage: "RESEARCH" | "SCRIPT") {
  const job = harness.repository.createJob({
    projectId: harness.projectId,
    stage,
    maxAttempts: harness.config.JOB_MAX_ATTEMPTS,
    previousState: "PENDING",
  });
  const usage: Array<Record<string, number>> = [];
  const progress: number[] = [];
  const context: StageContext = {
    project: harness.repository.getProject(harness.projectId)!,
    job,
    signal: new AbortController().signal,
    reportProgress(value) { progress.push(value); },
    recordUsage(value) { usage.push(value as Record<string, number>); },
    logger: Fastify({ logger: false }).log,
  };
  return { context, usage, progress };
}

describe("research and script stages", () => {
  it("uses mock provider, persists structured output, records usage, and caches unchanged research", async () => {
    const harness = makeHarness({ LLM_DEFAULT_PROVIDER: "mock", LLM_ENABLE_MOCK: true });
    const registry = new LlmProviderRegistry(harness.config);
    const mock = registry.get("mock")!;
    const generate = vi.spyOn(mock, "generate");
    const researchExecutor = new ResearchExecutor(harness.sqlite, registry, harness.config);
    const scriptExecutor = new ScriptExecutor(harness.sqlite, registry, harness.config);
    const researchCall = contextFor(harness, "RESEARCH");
    await researchExecutor.run(researchCall.context);
    expect(researchCall.usage[0]).toMatchObject({ llmCalls: 1, inputTokens: 10, outputTokens: 20 });
    expect(generate.mock.calls[0][0].maxOutputTokens).toBe(1_400);
    const notes = harness.sqlite.prepare("SELECT data, provider, cached FROM research_notes WHERE project_id = ?")
      .get(harness.projectId) as { data: string; provider: string; cached: number };
    expect(JSON.parse(notes.data)).toMatchObject({ keyFacts: expect.arrayContaining([expect.objectContaining({ confidence: "medium" })]) });
    expect(notes.provider).toBe("mock");
    expect(notes.cached).toBe(0);

    const scriptCall = contextFor(harness, "SCRIPT");
    await scriptExecutor.run(scriptCall.context);
    expect(scriptCall.usage[0]).toMatchObject({ llmCalls: 1, inputTokens: 10, outputTokens: 20 });
    const savedScript = harness.sqlite.prepare("SELECT data, origin, version FROM scripts WHERE project_id = ?")
      .get(harness.projectId) as { data: string; origin: string; version: number };
    const parsedScript = JSON.parse(savedScript.data) as { sections: { estDurationSec: number }[] };
    expect(savedScript.origin).toBe("AGENT");
    expect(savedScript.version).toBe(1);
    expect(parsedScript.sections[0].estDurationSec).toBeGreaterThan(0);
    expect(generate).toHaveBeenCalledTimes(2);

    const cachedCall = contextFor(harness, "RESEARCH");
    await researchExecutor.run(cachedCall.context);
    expect(cachedCall.usage[0]).toMatchObject({ llmCalls: 0, inputTokens: 0, outputTokens: 0 });
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("returns a non-retryable configuration error without a provider", async () => {
    const harness = makeHarness({ LLM_ENABLE_MOCK: false });
    const registry = new LlmProviderRegistry(harness.config);
    const executor = new ResearchExecutor(harness.sqlite, registry, harness.config);
    const call = contextFor(harness, "RESEARCH");
    await expect(executor.run(call.context)).rejects.toBeInstanceOf(StageError);
    await expect(executor.run(call.context)).rejects.toMatchObject({
      code: "LLM_NOT_CONFIGURED",
      retryable: false,
    });
  });

  it("pauses USER mode without LLM jobs and completes the script while skipping research", () => {
    const harness = makeHarness();
    const project = harness.repository.getProject(harness.projectId)!;
    harness.sqlite.prepare("UPDATE projects SET settings = ? WHERE id = ?")
      .run(JSON.stringify({ ...project.settings, stageExecutors: { script: "USER" } }), harness.projectId);
    const waiting = harness.orchestrator.runAll(harness.projectId);
    expect(waiting.stages.find((stage) => stage.stage === "RESEARCH")).toMatchObject({
      state: "WAITING_USER",
      message: "Write or paste your script in the Script tab",
    });
    expect(waiting.activeJob).toBeNull();
    expect(harness.repository.listJobs(harness.projectId, 20)).toHaveLength(0);

    const completed = harness.orchestrator.completeByUser(harness.projectId, "SCRIPT", { skip: ["RESEARCH"] });
    expect(completed.stages.find((stage) => stage.stage === "RESEARCH")?.state).toBe("SKIPPED");
    expect(completed.stages.find((stage) => stage.stage === "SCRIPT")?.message).toBe("Provided by user");
    expect(completed.activeJob?.stage).toBe("SCENE_PLAN");
    expect(harness.repository.listJobs(harness.projectId, 20).every((job) => job.usage === null)).toBe(true);
  });

  it("runs real LLM stages then fake stages through the visual review gate and reuses cached tokens", async () => {
    const harness = makeHarness({
      LLM_DEFAULT_PROVIDER: "mock",
      LLM_ENABLE_MOCK: true,
      FAKE_STAGE_DELAY_MS: 0,
    });
    const registry = new LlmProviderRegistry(harness.config);
    const provider = registry.get("mock")!;
    const generate = vi.spyOn(provider, "generate");
    harness.executors.set("RESEARCH", new ResearchExecutor(harness.sqlite, registry, harness.config));
    harness.executors.set("SCRIPT", new ScriptExecutor(harness.sqlite, registry, harness.config));
    harness.orchestrator.runAll(harness.projectId);
    await drainUntilGate(harness);
    const state = harness.orchestrator.getPipeline(harness.projectId);
    expect(state.stages.find((stage) => stage.stage === "RESEARCH")?.state).toBe("DONE");
    expect(state.stages.find((stage) => stage.stage === "SCRIPT")?.state).toBe("DONE");
    expect(state.stages.find((stage) => stage.stage === "VISUAL_REVIEW")?.state).toBe("WAITING_USER");
    const firstResearchJob = harness.repository.listJobs(harness.projectId, 20).find((job) => job.stage === "RESEARCH");
    const firstScriptJob = harness.repository.listJobs(harness.projectId, 20).find((job) => job.stage === "SCRIPT");
    expect(firstResearchJob?.usage).toMatchObject({ llmCalls: 1, inputTokens: 10, outputTokens: 20 });
    expect(firstScriptJob?.usage).toMatchObject({ llmCalls: 0, inputTokens: 0, outputTokens: 0 });
    expect(firstScriptJob?.message).toContain("Script from merged call");
    expect(generate).toHaveBeenCalledTimes(1);
    expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM research_notes WHERE project_id = ?").get(harness.projectId))
      .toMatchObject({ count: 1 });
    expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM scripts WHERE project_id = ?").get(harness.projectId))
      .toMatchObject({ count: 1 });

    harness.orchestrator.runStage(harness.projectId, "RESEARCH");
    await harness.worker.tick();
    const cachedJob = harness.repository.listJobs(harness.projectId, 20).find((job) => job.stage === "RESEARCH");
    expect(cachedJob?.usage).toMatchObject({ llmCalls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["merged", 1],
    ["separate", 2],
    ["off", 1],
  ] as const)("uses %s mode with %i provider calls for Generate All", async (mode, expectedCalls) => {
    const harness = makeHarness({
      LLM_DEFAULT_PROVIDER: "mock",
      LLM_ENABLE_MOCK: true,
      LLM_RESEARCH_MODE: mode,
      FAKE_STAGE_DELAY_MS: 0,
    });
    const registry = new LlmProviderRegistry(harness.config);
    const provider = registry.get("mock")!;
    const generate = vi.spyOn(provider, "generate");
    harness.executors.set("RESEARCH", new ResearchExecutor(harness.sqlite, registry, harness.config));
    harness.executors.set("SCRIPT", new ScriptExecutor(harness.sqlite, registry, harness.config));
    if (mode === "off") {
      harness.sqlite.prepare(
        "INSERT INTO research_notes (project_id, input_hash, provider, model, cached, created_at, data) VALUES (?, ?, ?, ?, false, ?, ?)",
      ).run(harness.projectId, "old-research", "mock", "mock-v1", new Date().toISOString(), "{}");
    }

    harness.orchestrator.runAll(harness.projectId);
    await drainUntilGate(harness);

    const state = harness.orchestrator.getPipeline(harness.projectId);
    const researchState = state.stages.find((stage) => stage.stage === "RESEARCH")?.state;
    expect(researchState).toBe(mode === "off" ? "SKIPPED" : "DONE");
    expect(state.stages.find((stage) => stage.stage === "SCRIPT")?.state).toBe("DONE");
    expect(generate).toHaveBeenCalledTimes(expectedCalls);
    if (mode === "off") {
      expect(generate.mock.calls[0][0].messages[0]?.content).toContain("No research notes are available");
    }
  });

  it("uses the project research-mode override and reads legacy visual ideas", async () => {
    const harness = makeHarness({
      LLM_DEFAULT_PROVIDER: "mock",
      LLM_ENABLE_MOCK: true,
      LLM_RESEARCH_MODE: "separate",
      FAKE_STAGE_DELAY_MS: 0,
    });
    const project = harness.repository.getProject(harness.projectId)!;
    harness.sqlite.prepare("UPDATE projects SET settings = ? WHERE id = ?")
      .run(JSON.stringify({ ...project.settings, researchMode: "merged" }), harness.projectId);
    const registry = new LlmProviderRegistry(harness.config);
    const provider = registry.get("mock")!;
    const generate = vi.spyOn(provider, "generate");
    harness.executors.set("RESEARCH", new ResearchExecutor(harness.sqlite, registry, harness.config));
    harness.executors.set("SCRIPT", new ScriptExecutor(harness.sqlite, registry, harness.config));
    harness.orchestrator.runAll(harness.projectId);
    await drainUntilGate(harness);
    expect(generate).toHaveBeenCalledTimes(1);

    const legacy = ScriptSchema.parse({
      title: "Legacy",
      hook: "",
      sections: [{
        id: "one",
        heading: "One",
        narration: "",
        visualIdeas: ["old visual", "archive"],
        estDurationSec: 0,
      }],
      outro: "",
    });
    expect(legacy.sections[0]).toMatchObject({
      visualQueries: { primary: "old visual", alternatives: ["archive"] },
      visualNotes: "old visual, archive",
      energy: "medium",
    });
    expect(legacy.music).toEqual({ mood: "", energy: "medium", keywords: [] });
  });

  it("records usage from failed initial and repair calls on the failed job", async () => {
    const harness = makeHarness({
      LLM_DEFAULT_PROVIDER: "mock",
      LLM_ENABLE_MOCK: true,
      FAKE_STAGE_DELAY_MS: 0,
    });
    const registry = new LlmProviderRegistry(harness.config);
    const provider = registry.get("mock")!;
    const invalidResponse = {
      text: "invalid",
      usage: { inputTokens: 7, outputTokens: 11 },
      model: "mock-v1",
      provider: "mock",
      finishReason: "stop" as const,
    };
    vi.spyOn(provider, "generate")
      .mockResolvedValueOnce(invalidResponse)
      .mockResolvedValueOnce(invalidResponse);
    harness.executors.set("RESEARCH", new ResearchExecutor(harness.sqlite, registry, harness.config));
    harness.orchestrator.runStage(harness.projectId, "RESEARCH");
    await harness.worker.tick();
    const job = harness.repository.listJobs(harness.projectId, 20).find((item) => item.stage === "RESEARCH");
    expect(job?.status).toBe("FAILED");
    expect(job?.usage).toMatchObject({ llmCalls: 2, inputTokens: 14, outputTokens: 22 });
  });

  it("records truncated output usage and does not issue a repair call", async () => {
    const harness = makeHarness({
      LLM_DEFAULT_PROVIDER: "mock",
      LLM_ENABLE_MOCK: true,
      FAKE_STAGE_DELAY_MS: 0,
    });
    const registry = new LlmProviderRegistry(harness.config);
    const provider = registry.get("mock")!;
    const generate = vi.spyOn(provider, "generate").mockResolvedValueOnce({
      text: "{}",
      usage: { inputTokens: 9, outputTokens: 13 },
      model: "mock-v1",
      provider: "mock",
      finishReason: "length",
    });
    harness.executors.set("RESEARCH", new ResearchExecutor(harness.sqlite, registry, harness.config));
    harness.orchestrator.runStage(harness.projectId, "RESEARCH");
    await harness.worker.tick();
    const job = harness.repository.listJobs(harness.projectId, 20).find((item) => item.stage === "RESEARCH");
    expect(job?.error).toMatchObject({ code: "LLM_OUTPUT_TRUNCATED", retryable: false });
    expect(job?.usage).toMatchObject({ llmCalls: 1, inputTokens: 9, outputTokens: 13 });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("makes one provider call and zero calls on a cached merged rerun through SCRIPT", async () => {
    const harness = makeHarness({ LLM_DEFAULT_PROVIDER: "mock", LLM_ENABLE_MOCK: true });
    const registry = new LlmProviderRegistry(harness.config);
    const provider = registry.get("mock")!;
    const generate = vi.spyOn(provider, "generate");
    const researchExecutor = new ResearchExecutor(harness.sqlite, registry, harness.config);
    const scriptExecutor = new ScriptExecutor(harness.sqlite, registry, harness.config);
    harness.sqlite.prepare("UPDATE projects SET run_mode = 'ALL' WHERE id = ?").run(harness.projectId);

    for (let run = 0; run < 2; run += 1) {
      const researchCall = contextFor(harness, "RESEARCH");
      await researchExecutor.run(researchCall.context);
      const hashes = harness.sqlite.prepare(
        "SELECT research_notes.input_hash AS research_hash, scripts.input_hash AS script_hash, scripts.origin, scripts.merged_call FROM research_notes JOIN scripts USING (project_id) WHERE research_notes.project_id = ?",
      ).get(harness.projectId) as { research_hash: string; script_hash: string; origin: string; merged_call: number };
      expect(hashes.research_hash).toBe(hashes.script_hash);
      expect(hashes).toMatchObject({ origin: "AGENT", merged_call: 1 });
      const scriptCall = contextFor(harness, "SCRIPT");
      await scriptExecutor.run(scriptCall.context);
      expect(scriptCall.context.job.stage).toBe("SCRIPT");
      if (run === 1) {
        expect(researchCall.usage[0]).toMatchObject({ llmCalls: 0, inputTokens: 0, outputTokens: 0 });
        expect(scriptCall.usage[0]).toMatchObject({ llmCalls: 0, inputTokens: 0, outputTokens: 0 });
      }
    }
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("regenerates a script separately when saved research no longer matches the merged hash", async () => {
    const harness = makeHarness({ LLM_DEFAULT_PROVIDER: "mock", LLM_ENABLE_MOCK: true });
    const registry = new LlmProviderRegistry(harness.config);
    const provider = registry.get("mock")!;
    const generate = vi.spyOn(provider, "generate");
    const researchExecutor = new ResearchExecutor(harness.sqlite, registry, harness.config);
    const scriptExecutor = new ScriptExecutor(harness.sqlite, registry, harness.config);
    harness.sqlite.prepare("UPDATE projects SET run_mode = 'ALL' WHERE id = ?").run(harness.projectId);

    await researchExecutor.run(contextFor(harness, "RESEARCH").context);
    harness.sqlite.prepare("UPDATE research_notes SET input_hash = ? WHERE project_id = ?")
      .run("edited-research-hash", harness.projectId);
    const scriptCall = contextFor(harness, "SCRIPT");
    await scriptExecutor.run(scriptCall.context);

    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[1][0].messages[0]?.content).toContain("Research notes");
    expect(scriptCall.usage[0]).toMatchObject({ llmCalls: 1, inputTokens: 10, outputTokens: 20 });
  });
});
