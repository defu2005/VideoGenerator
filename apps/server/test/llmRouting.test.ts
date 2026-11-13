import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectSchema } from "@vg/shared";
import { parseConfig } from "../src/lib/config.js";
import { createLlmCacheKey } from "../src/providers/llm/cache.js";
import { LlmProviderRegistry, resolveLlmRoute } from "../src/providers/llm/registry.js";
import { generateRoutedStructured } from "../src/providers/llm/structured.js";
import { LlmError } from "../src/providers/llm/types.js";
import { runWithAutonomyBudget } from "../src/operator/autonomyBudget.js";
import { z } from "zod";

const now = "2026-11-03T00:00:00.000Z";

afterEach(() => vi.unstubAllGlobals());

function project(llm?: unknown) {
  return ProjectSchema.parse({
    id: "11111111-1111-4111-8111-111111111111",
    title: "Test",
    description: "",
    topic: "Test topic",
    mode: "ASSISTED",
    settings: llm ? { llm } : {},
    status: "DRAFT",
    stage: "TOPIC",
    thumbnailPath: null,
    durationSec: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  });
}

describe("task-specific LLM routing", () => {
  it("uses a configured free route at 80% and rejects paid calls at 100%", async () => {
    const request = vi.fn(async () => { throw new Error("paid provider must not be contacted"); });
    vi.stubGlobal("fetch", request);
    const registry = new LlmProviderRegistry(parseConfig({ OPENAI_API_KEY: "fixture", LLM_ENABLE_MOCK: "true" }));
    const execute = (withFallback: boolean) => generateRoutedStructured({
      registry,
      route: registry.resolveTask("research", project({ tasks: { research: {
        provider: "openai", model: "gpt-fixture",
        ...(withFallback ? { fallback: { provider: "mock", model: "fixture-free" } } : {}),
      } } })),
      task: "research", system: "research", prompt: "Offline fixture",
      schema: z.object({ summary: z.string() }), schemaName: "research", schemaVersion: "1",
      maxOutputTokens: 200, signal: new AbortController().signal,
    });
    const retryAt = "2026-11-10T17:00:00.000Z";
    const warning = await runWithAutonomyBudget(() => ({ state: "warn", retryAt: null }), () => execute(true));
    expect(warning.provider).toBe("mock");
    const stopped = await runWithAutonomyBudget(() => ({ state: "stop", retryAt }), () => execute(true));
    expect(stopped.provider).toBe("mock");
    await expect(runWithAutonomyBudget(() => ({ state: "stop", retryAt }), () => execute(false)))
      .rejects.toMatchObject({ code: "AUTONOMY_BUDGET_WAIT", retryAt });
    expect(request).not.toHaveBeenCalled();
  });
  it("resolves all six sources in precedence order", () => {
    const config = parseConfig({
      LLM_ENABLE_MOCK: "true",
      LLM_DEFAULT_PROVIDER: "mock",
      LLM_DEFAULT_MODEL: "env-default",
      LLM_SCRIPT_PROVIDER: "mock",
      LLM_SCRIPT_MODEL: "env-task",
    });

    expect(resolveLlmRoute("script", project({ tasks: { script: { provider: "mock", model: "project-task" } } }), undefined, config))
      .toMatchObject({ source: "project-task", route: { model: "project-task" } });
    expect(resolveLlmRoute("script", project({ default: { provider: "mock", model: "project-default" } }), undefined, config))
      .toMatchObject({ source: "project-default", route: { model: "project-default" } });
    expect(resolveLlmRoute("research", project(), { tasks: { research: { provider: "mock", model: "app-task" } } }, config))
      .toMatchObject({ source: "app-task", route: { model: "app-task" } });
    expect(resolveLlmRoute("research", project(), { default: { provider: "mock", model: "app-default" } }, config))
      .toMatchObject({ source: "app-default", route: { model: "app-default" } });
    expect(resolveLlmRoute("script", project(), undefined, config))
      .toMatchObject({ source: "env-task", route: { model: "env-task" } });
    expect(resolveLlmRoute("research", project(), undefined, config))
      .toMatchObject({ source: "env-default", route: { model: "env-default" } });
  });

  it("uses mock once when the primary Copilot CLI route is disabled and records both route attempts", async () => {
    const registry = new LlmProviderRegistry(parseConfig({
      LLM_ENABLE_MOCK: "true",
      COPILOT_CLI_ENABLED: "false",
    }));
    const resolved = registry.resolveTask("research", project({
      tasks: {
        research: {
          provider: "copilot-cli",
          model: "auto",
          fallback: { provider: "mock", model: "fallback-model" },
        },
      },
    }));
    const generated = await generateRoutedStructured({
      registry,
      route: resolved,
      task: "research",
      system: "research",
      prompt: "Offline fixture prompt",
      schema: z.object({ summary: z.string() }),
      schemaName: "Research",
      schemaVersion: "1",
      maxOutputTokens: 256,
      repairAttempts: 0,
      signal: new AbortController().signal,
    });

    expect(generated.value.summary).toContain("unverified");
    expect(generated.usage.llmCalls).toBe(1);
    expect(generated.usage.calls).toEqual([
      expect.objectContaining({ task: "research", provider: "copilot-cli", model: "auto", ok: false, fallback: false }),
      expect.objectContaining({ task: "research", provider: "mock", model: "fallback-model", ok: true, fallback: true }),
    ]);
  });

  it("falls back on a mocked provider 5xx but not on a bad-request error", async () => {
    const registry = new LlmProviderRegistry(parseConfig({
      LLM_ENABLE_MOCK: "true",
      OPENAI_API_KEY: "test-key",
      OPENAI_MODEL: "primary-model",
    }));
    const routedProject = project({
      tasks: {
        research: {
          provider: "openai",
          model: "primary-model",
          fallback: { provider: "mock", model: "fallback-model" },
        },
      },
    });
    const primaryRoute = registry.resolveTask("research", routedProject);
    const generate = () => generateRoutedStructured({
      registry,
      route: primaryRoute,
      task: "research",
      system: "research",
      prompt: "Offline fixture prompt",
      schema: z.object({ summary: z.string() }),
      schemaName: "Research",
      schemaVersion: "1",
      maxOutputTokens: 256,
      repairAttempts: 0,
      signal: new AbortController().signal,
    });

    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    const recovered = await generate();
    expect(recovered.usage.calls).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: "openai", ok: false, fallback: false }),
      expect.objectContaining({ provider: "mock", ok: true, fallback: true }),
    ]));

    const badRequestFetch = vi.fn(async () => new Response("{}", { status: 400 }));
    vi.stubGlobal("fetch", badRequestFetch);
    const recoveredFromBadRequest = await generate();
    expect(recoveredFromBadRequest.usage.calls).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: "openai", fallback: false, ok: false }),
      expect.objectContaining({ provider: "mock", fallback: true, ok: true }),
    ]));
    expect(badRequestFetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    "LLM_AUTH",
    "LLM_RATE_LIMIT",
    "LLM_UNAVAILABLE",
    "LLM_TIMEOUT",
    "LLM_BAD_REQUEST",
    "LLM_OUTPUT_TRUNCATED",
    "LLM_NOT_CONFIGURED",
    "LLM_LIMIT_TOO_SMALL",
    "LLM_QUOTA_EXHAUSTED",
  ] as const)("falls back once for %s", async (code) => {
    const registry = new LlmProviderRegistry(parseConfig({
      LLM_ENABLE_MOCK: "true",
      OPENAI_API_KEY: "test-key",
      OPENAI_MODEL: "primary-model",
    }));
    const primary = registry.get("openai")!;
    const fallback = registry.get("mock")!;
    vi.spyOn(primary, "generate").mockRejectedValue(new LlmError(
      "primary failed", code, true, code === "LLM_UNAVAILABLE" ? 503 : undefined,
    ));
    vi.spyOn(fallback, "generate").mockResolvedValue({
      text: '{"answer":"fallback"}',
      usage: { inputTokens: 2, outputTokens: 3 },
      model: "fallback-model",
      provider: "mock",
      finishReason: "stop",
    });
    const routed = registry.resolveTask("research", project({
      tasks: { research: { provider: "openai", model: "primary-model", fallback: { provider: "mock", model: "fallback-model" } } },
    }));
    const result = await generateRoutedStructured({
      registry,
      route: routed,
      task: "research",
      system: "research",
      prompt: "Offline fixture prompt",
      schema: z.object({ answer: z.string() }),
      schemaName: "Example",
      schemaVersion: "1",
      maxOutputTokens: 256,
      repairAttempts: 0,
      signal: new AbortController().signal,
    });
    expect(result.usage.calls).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: "openai", ok: false, fallback: false }),
      expect.objectContaining({ provider: "mock", ok: true, fallback: true }),
    ]));
    expect(fallback.generate).toHaveBeenCalledTimes(1);
  });

  it("does not fall back after structured-output validation fails", async () => {
    const registry = new LlmProviderRegistry(parseConfig({
      LLM_ENABLE_MOCK: "true",
      OPENAI_API_KEY: "test-key",
      OPENAI_MODEL: "primary-model",
    }));
    const primary = registry.get("openai")!;
    const fallback = registry.get("mock")!;
    const fallbackGenerate = vi.spyOn(fallback, "generate");
    vi.spyOn(primary, "generate").mockResolvedValue({
      text: '{"answer":42}', usage: { inputTokens: 2, outputTokens: 3 },
      model: "primary-model", provider: "openai", finishReason: "stop",
    });
    const routed = registry.resolveTask("research", project({
      tasks: { research: { provider: "openai", model: "primary-model", fallback: { provider: "mock", model: "fallback-model" } } },
    }));
    await expect(generateRoutedStructured({
      registry, route: routed, task: "research", system: "research", prompt: "Offline fixture prompt",
      schema: z.object({ answer: z.string() }), schemaName: "Example", schemaVersion: "1",
      maxOutputTokens: 256, repairAttempts: 0, signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: "LLM_INVALID_OUTPUT" });
    expect(fallbackGenerate).not.toHaveBeenCalled();
  });

  it("includes the selected provider and model in its cache key", () => {
    const input = {
      provider: "mock",
      model: "model-a",
      system: "system",
      prompt: "prompt",
      schemaName: "Schema",
      schemaVersion: "1",
    };
    expect(createLlmCacheKey(input)).not.toBe(createLlmCacheKey({ ...input, model: "model-b" }));
    expect(createLlmCacheKey(input)).not.toBe(createLlmCacheKey({ ...input, provider: "openai" }));
  });
});
