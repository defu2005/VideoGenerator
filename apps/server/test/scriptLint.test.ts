import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveBudget } from "@vg/shared";
import { LlmProviderRegistry } from "../src/providers/llm/registry.js";
import { ResearchExecutor } from "../src/stages/research/researchExecutor.js";
import { ScriptExecutor } from "../src/stages/script/scriptExecutor.js";
import { formatGuidance } from "../src/stages/script/prompt.js";
import { createPipelineHarness } from "./pipelineFixtures.js";
import type { StageContext } from "../src/pipeline/stageExecutor.js";
import type { AppConfig } from "../src/lib/config.js";

const harnesses: ReturnType<typeof createPipelineHarness>[] = [];
afterEach(() => { for (const h of harnesses.splice(0)) h.close(); });

function setup(mode: "ECO" | "QUALITY", customFeatures?: Record<string, unknown>) {
  const harness = createPipelineHarness({ config: { LLM_DEFAULT_PROVIDER: "mock", LLM_ENABLE_MOCK: true } as Partial<AppConfig> });
  harnesses.push(harness);
  const project = harness.repository.getProject(harness.projectId)!;
  const budgetSettings = customFeatures
    ? { mode: "CUSTOM", features: { ...resolveBudget(mode), ...customFeatures } }
    : { mode };
  harness.sqlite.prepare("UPDATE projects SET settings = ? WHERE id = ?")
    .run(JSON.stringify({ ...project.settings, budget: budgetSettings }), harness.projectId);
  const registry = new LlmProviderRegistry(harness.config);
  const generate = vi.spyOn(registry.get("mock")!, "generate");
  return { harness, registry, generate };
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

function notes(harness: ReturnType<typeof createPipelineHarness>): string[] {
  const row = harness.sqlite.prepare("SELECT review_notes FROM scripts WHERE project_id = ?").get(harness.projectId) as { review_notes: string | null };
  return row.review_notes ? JSON.parse(row.review_notes) as string[] : [];
}

describe("script lint in the executor", () => {
  it("formatGuidance carries purpose, hook styles and reading level", () => {
    const { harness } = setup("ECO");
    const project = harness.repository.getProject(harness.projectId)!;
    for (const format of ["story", "explainer"] as const) {
      const text = formatGuidance({ ...project, settings: { ...project.settings, format } });
      const recipe = format === "story" ? "story" : "explainer";
      expect(text).toContain(`Format guidance (${recipe})`);
      expect(text).toContain("Each section must do its job");
      expect(text).toContain("Allowed hook tactics:");
      expect(text).toContain("Reading level:");
    }
  });

  it("feeds fix findings to the review prompt and saves leftovers as [lint] notes", async () => {
    const { harness, registry, generate } = setup("QUALITY", { storyEngine: "off" });
    await new ResearchExecutor(harness.sqlite, registry, harness.config).run(ctx(harness, "RESEARCH"));
    await new ScriptExecutor(harness.sqlite, registry, harness.config).run(ctx(harness, "SCRIPT"));
    const prompts = generate.mock.calls.map((call) => String(call[0].messages[0]?.content));
    expect(prompts.some((p) => p.includes("Problems found by the checker; fix each one"))).toBe(true);
    expect(notes(harness).some((n) => n.startsWith("[lint] "))).toBe(true);
    expect(notes(harness).length).toBeLessThanOrEqual(8);
  });

  it("still lints with review off and adds no LLM call", async () => {
    const { harness, registry, generate } = setup("ECO");
    await new ResearchExecutor(harness.sqlite, registry, harness.config).run(ctx(harness, "RESEARCH"));
    const before = generate.mock.calls.length;
    await new ScriptExecutor(harness.sqlite, registry, harness.config).run(ctx(harness, "SCRIPT"));
    expect(generate.mock.calls.length - before).toBe(1);
    expect(notes(harness).some((n) => n.startsWith("[lint] "))).toBe(true);
  });
});
