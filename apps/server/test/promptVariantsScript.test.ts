import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LlmProviderRegistry } from "../src/providers/llm/registry.js";
import { ResearchExecutor } from "../src/stages/research/researchExecutor.js";
import { ScriptExecutor } from "../src/stages/script/scriptExecutor.js";
import { createPipelineHarness } from "./pipelineFixtures.js";
import { registerPromptVariant, promotePromptVariant } from "../src/learning/promptVariants.js";
import type { StageContext } from "../src/pipeline/stageExecutor.js";
import type { AppConfig } from "../src/lib/config.js";

// TASK-148e: only the active SCRIPT variant reaches the writer prompt. Mock LLM only, no network.
const MARKER = "Phong cách viết đã được người dùng duyệt";
const harnesses: ReturnType<typeof createPipelineHarness>[] = [];
afterEach(() => { for (const h of harnesses.splice(0)) h.close(); });

function makeHarness(config: Record<string, unknown> = {}) {
  const harness = createPipelineHarness({ config: { LLM_DEFAULT_PROVIDER: "mock", LLM_ENABLE_MOCK: true, FAKE_STAGE_DELAY_MS: 0, ...config } as Partial<AppConfig> });
  harnesses.push(harness);
  return harness;
}

function ctx(harness: ReturnType<typeof createPipelineHarness>, stage: "RESEARCH" | "SCRIPT"): StageContext {
  const job = harness.repository.createJob({ projectId: harness.projectId, stage, maxAttempts: harness.config.JOB_MAX_ATTEMPTS, previousState: "PENDING" });
  return {
    project: harness.repository.getProject(harness.projectId)!,
    job,
    signal: new AbortController().signal,
    reportProgress() {},
    recordUsage() {},
    logger: Fastify({ logger: false }).log,
  };
}

/** Runs RESEARCH then SCRIPT and returns every prompt text the mock writer received for SCRIPT. */
async function scriptPrompts(harness: ReturnType<typeof createPipelineHarness>): Promise<string[]> {
  const registry = new LlmProviderRegistry(harness.config);
  const mock = registry.get("mock")!;
  const generate = vi.spyOn(mock, "generate");
  await new ResearchExecutor(harness.sqlite, registry, harness.config).run(ctx(harness, "RESEARCH"));
  const before = generate.mock.calls.length;
  await new ScriptExecutor(harness.sqlite, registry, harness.config).run(ctx(harness, "SCRIPT"));
  return generate.mock.calls.slice(before).map(([request]) => `${request.system}\n${request.messages.map((m) => m.content).join("\n")}`);
}

describe("TASK-148e: only the active variant enters SCRIPT", () => {
  it("no variant: marker absent", async () => {
    const harness = makeHarness();
    const prompts = await scriptPrompts(harness);
    expect(prompts.length).toBeGreaterThan(0);
    expect(prompts.some((p) => p.includes(MARKER))).toBe(false);
  });

  it("candidate only: marker absent", async () => {
    const harness = makeHarness();
    registerPromptVariant(harness.sqlite, { stage: "SCRIPT", text: "CANDIDATE-ONLY-STYLE" });
    const prompts = await scriptPrompts(harness);
    expect(prompts.some((p) => p.includes("CANDIDATE-ONLY-STYLE"))).toBe(false);
  });

  it("promoted: marker and text present", async () => {
    const harness = makeHarness();
    const v = registerPromptVariant(harness.sqlite, { stage: "SCRIPT", text: "PROMOTED-STYLE-ONE" });
    promotePromptVariant(harness.sqlite, { id: v.id, decidedBy: "user" });
    const prompts = await scriptPrompts(harness);
    expect(prompts.some((p) => p.includes(MARKER) && p.includes("PROMOTED-STYLE-ONE"))).toBe(true);
  });

  it("replaced: the earlier promoted text is gone, only the new active one remains", async () => {
    const harness = makeHarness();
    const first = registerPromptVariant(harness.sqlite, { stage: "SCRIPT", text: "OLD-STYLE-TEXT" });
    const second = registerPromptVariant(harness.sqlite, { stage: "SCRIPT", text: "NEW-STYLE-TEXT" });
    promotePromptVariant(harness.sqlite, { id: first.id, decidedBy: "user" });
    promotePromptVariant(harness.sqlite, { id: second.id, decidedBy: "user" });
    const prompts = await scriptPrompts(harness);
    expect(prompts.some((p) => p.includes("NEW-STYLE-TEXT"))).toBe(true);
    expect(prompts.some((p) => p.includes("OLD-STYLE-TEXT"))).toBe(false);
  });
});
