import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { estimateBudget, type BudgetEstimateInput } from "@vg/shared";
import { LlmProviderRegistry } from "../src/providers/llm/registry.js";
import { LlmCache } from "../src/providers/llm/cache.js";
import { runStoryEngine } from "../src/stages/script/storyEngine.js";
import { createPipelineHarness } from "./pipelineFixtures.js";
import type { StageContext } from "../src/pipeline/stageExecutor.js";

// TASK-145 record test: SCRIPT-stage call bounds per budget mode, read from estimateBudget's public output.
// Pure function, no DB, no network. The storyEngine max constant (full 10 / lite 7, modes.ts) is not exported,
// so the runtime section below pins a copy of it. The observable bounds here are the per-task maxes, and
// SCRIPT max is their sum (modes.ts, TASK-141).

const project = (mode: "BALANCED" | "QUALITY") => ({
  topic: "TASK-145 mode bounds",
  settings: { targetDurationSec: 120, budget: { mode } },
}) as unknown as BudgetEstimateInput;

function scriptStage(mode: "BALANCED" | "QUALITY") {
  const estimate = estimateBudget(project(mode));
  const stage = estimate.perStage.find((item) => item.stage === "SCRIPT");
  if (!stage) throw new Error(`no SCRIPT stage for ${mode}`);
  return stage;
}

describe("TASK-145 record: storyOutline and SCRIPT bounds per mode", () => {
  it("QUALITY (story engine full, repairAttempts 2): storyOutline max is 2 + repairs = 4", () => {
    const outline = scriptStage("QUALITY").tasks?.find((item) => item.task === "storyOutline");
    expect(outline?.calls).toEqual({ min: 1, max: 4 });
  });

  it("BALANCED (story engine lite, repairAttempts 1): storyOutline max is 2 + repairs = 3", () => {
    const outline = scriptStage("BALANCED").tasks?.find((item) => item.task === "storyOutline");
    expect(outline?.calls).toEqual({ min: 1, max: 3 });
  });

  it("SCRIPT max equals the sum of its task maxes (BALANCED 15, QUALITY 30 as recorded in modes.ts)", () => {
    for (const mode of ["BALANCED", "QUALITY"] as const) {
      const stage = scriptStage(mode);
      const taskSum = (stage.tasks ?? []).reduce((sum, item) => sum + item.calls.max, 0);
      expect(stage.calls.max).toBe(taskSum);
    }
    expect(scriptStage("BALANCED").calls.max).toBe(15);
    expect(scriptStage("QUALITY").calls.max).toBe(30);
  });
});

// Runtime counter (TASK-145 mode counters): counts real provider calls made inside runStoryEngine with the mock
// provider. Off mode has no engine (it takes the legacy path), so only lite and full are counted here.
// Engine call caps are a pinned copy of modes.ts storyEngineMax (line 500): full 10, lite 7. Not read from modes.ts at runtime.
// Happy path only: the mock critic passes, so no rewrite round runs. Lite's rewrite cap (1) is not guarded by these tests.
const ENGINE_MAX: Record<"full" | "lite", number> = { full: 10, lite: 7 };
const ENGINE_MIN: Record<"full" | "lite", number> = { full: 4, lite: 3 };
// Recorded counts for the mock fixture (measured 2026-11-19). Exact pin: any extra call fails here even under the cap.
const ENGINE_RECORDED: Record<"full" | "lite", number> = { full: 7, lite: 6 };

const runHarnesses: ReturnType<typeof createPipelineHarness>[] = [];
afterEach(() => {
  for (const harness of runHarnesses.splice(0)) harness.close();
});

const RUN_RESEARCH = {
  summary: "Tóm tắt.",
  keyFacts: [
    { fact: "Vụ nổ Big Bang xảy ra khoảng 13.8 tỷ năm trước.", confidence: "high", sourceHint: "NASA" },
    { fact: "Bức xạ tàn dư vũ trụ được phát hiện năm 1965.", confidence: "high", sourceHint: "Penzias" },
    { fact: "Vũ trụ đang giãn nở.", confidence: "high", sourceHint: "Hubble" },
  ],
  timeline: [{ date: "13.8 tỷ năm", event: "Big Bang" }],
  angles: ["Nguồn gốc"],
  outline: [
    { section: "Mở đầu", purpose: "Big Bang", points: ["Khởi đầu"] },
    { section: "Bằng chứng", purpose: "CMB", points: ["Khám phá"] },
    { section: "Tương lai", purpose: "Số phận", points: ["Giãn nở"] },
  ],
  cautions: ["Không nhầm vật chất tối"],
} as never;

async function countEngineCalls(engineMode: "full" | "lite"): Promise<number> {
  const harness = createPipelineHarness({
    config: { LLM_DEFAULT_PROVIDER: "mock", LLM_ENABLE_MOCK: true, LLM_CACHE_ENABLED: false },
  });
  runHarnesses.push(harness);
  const project = harness.repository.getProject(harness.projectId)!;
  const registry = new LlmProviderRegistry(harness.config);
  const cache = new LlmCache(harness.sqlite, false);
  const job = harness.repository.createJob({ projectId: harness.projectId, stage: "SCRIPT", maxAttempts: 3, previousState: "PENDING" });
  const context: StageContext = {
    project,
    job,
    signal: new AbortController().signal,
    reportProgress() {},
    recordUsage() {},
    logger: Fastify({ logger: false }).log,
  };
  const provider = registry.get("mock")!;
  const original = provider.generate.bind(provider) as (req: any, ...rest: unknown[]) => Promise<any>;
  let calls = 0;
  provider.generate = (async (req: any, ...rest: unknown[]) => {
    calls += 1;
    return original(req, ...rest);
  }) as typeof provider.generate;
  const result = await runStoryEngine({
    project,
    applicableResearch: RUN_RESEARCH,
    engineMode,
    scriptGuidance: "",
    context,
    sqlite: harness.sqlite,
    registry,
    cache,
    config: harness.config,
    inputHash: "counter-hash",
    cacheKeyExtra: "counter-cache",
  });
  expect(result.fallback).toBe(false);
  return calls;
}

describe("TASK-145 runtime counter: engine provider calls per mode stay within the mode cap", () => {
  it("lite run makes at least 3 and at most 7 provider calls", async () => {
    const calls = await countEngineCalls("lite");
    expect(calls).toBeGreaterThanOrEqual(ENGINE_MIN.lite);
    expect(calls).toBeLessThanOrEqual(ENGINE_MAX.lite);
    expect(calls).toBe(ENGINE_RECORDED.lite);
  });

  it("full run makes at least 4 and at most 10 provider calls", async () => {
    const calls = await countEngineCalls("full");
    expect(calls).toBeGreaterThanOrEqual(ENGINE_MIN.full);
    expect(calls).toBeLessThanOrEqual(ENGINE_MAX.full);
    expect(calls).toBe(ENGINE_RECORDED.full);
  });
});
