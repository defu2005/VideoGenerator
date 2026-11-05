import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { currentWindowStart, nextReset } from "@vg/shared";
import { openDatabase } from "../src/db/client.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { parseConfig } from "../src/lib/config.js";
import { LlmCache } from "../src/providers/llm/cache.js";
import { createLlmQuotaController, saveUserQuotaRule } from "../src/providers/llm/quota.js";
import { LlmProviderRegistry } from "../src/providers/llm/registry.js";
import { generateRoutedStructured } from "../src/providers/llm/structured.js";
import { LlmError } from "../src/providers/llm/types.js";
import { parseRetryAfterMs } from "../src/providers/llm/http.js";
import { createPipelineHarness } from "./pipelineFixtures.js";
import { ProjectSchema } from "@vg/shared";

const roots: string[] = [];
const harnesses: ReturnType<typeof createPipelineHarness>[] = [];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const harness of harnesses.splice(0)) harness.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function database() {
  const root = mkdtempSync(join(tmpdir(), "vg-quota-"));
  roots.push(root);
  const opened = openDatabase(join(root, "app.db"));
  migrateDatabase(opened.db);
  return opened;
}

const nowIso = "2026-06-15T18:00:00.000Z";
const fixedNow = new Date(nowIso);

function project(llm?: unknown, mode: "AUTO" | "ASSISTED" = "ASSISTED") {
  return ProjectSchema.parse({
    id: "11111111-1111-4111-8111-111111111111",
    title: "Test",
    description: "",
    topic: "Test topic",
    mode,
    settings: {
      ...(llm ? { llm } : {}),
      budget: { mode: "BALANCED" },
    },
    status: "DRAFT",
    stage: "TOPIC",
    thumbnailPath: null,
    durationSec: null,
    version: 1,
    createdAt: nowIso,
    updatedAt: nowIso,
    archivedAt: null,
  });
}

function dayRequests(sqlite: ReturnType<typeof database>["sqlite"], provider: string, model: string) {
  const row = sqlite.prepare(
    "SELECT COALESCE(SUM(requests), 0) AS requests FROM llm_quota_usage WHERE provider = ? AND model = ? AND window = 'day'",
  ).get(provider, model) as { requests: number };
  return row.requests;
}

describe("llm quota counting and cool-downs", () => {
  it("counts real calls, including repairs, and skips cache hits and preflight errors", async () => {
    const opened = database();
    const controller = createLlmQuotaController({ sqlite: opened.sqlite, now: () => fixedNow });
    const registry = new LlmProviderRegistry(parseConfig({
      LLM_ENABLE_MOCK: "true",
      OPENAI_API_KEY: "test-key",
      OPENAI_MODEL: "primary-model",
    }));
    registry.quota = controller;
    const cache = new LlmCache(opened.sqlite, true);
    const routed = registry.resolveTask("musicAssist", project({
      tasks: { musicAssist: { provider: "mock", model: "mock-v1" } },
    }));
    const base = {
      registry,
      route: routed,
      task: "musicAssist" as const,
      system: "system",
      prompt: "count me",
      schema: z.object({ ok: z.literal(true) }),
      schemaName: "QuotaProbe",
      schemaVersion: "1",
      maxOutputTokens: 256,
      repairAttempts: 1 as const,
      signal: new AbortController().signal,
      cache,
    };
    let calls = 0;
    vi.spyOn(registry.get("mock")!, "generate").mockImplementation(async () => {
      calls += 1;
      if (calls === 1) {
        return { text: "nope", usage: { inputTokens: 2, outputTokens: 1 }, model: "mock-v1", provider: "mock", finishReason: "stop" as const };
      }
      return { text: '{"ok":true}', usage: { inputTokens: 3, outputTokens: 4 }, model: "mock-v1", provider: "mock", finishReason: "stop" as const };
    });
    await generateRoutedStructured(base);
    expect(dayRequests(opened.sqlite, "mock", "mock-v1")).toBe(2);
    await generateRoutedStructured(base);
    expect(dayRequests(opened.sqlite, "mock", "mock-v1")).toBe(2);

    const visionRoute = registry.resolveTask("visionCheck", project({
      tasks: { visionCheck: { provider: "openai", model: "primary-model" } },
    }));
    await expect(generateRoutedStructured({
      ...base,
      route: visionRoute,
      task: "visionCheck",
      cache: undefined,
      images: [{ path: "missing.jpg", label: "img" }],
    })).rejects.toMatchObject({ code: "VISION_PROVIDER_REQUIRED" });
    expect(dayRequests(opened.sqlite, "openai", "primary-model")).toBe(0);
    opened.sqlite.close();
  });

  it("honours Retry-After, waits for the next day on a daily quota message, and caps backoff", () => {
    const opened = database();
    const controller = createLlmQuotaController({ sqlite: opened.sqlite, now: () => fixedNow });
    const headers = new Headers({ "retry-after": "15", "x-ratelimit-reset": "30" });
    expect(parseRetryAfterMs(headers, fixedNow.getTime())).toBe(15_000);
    const retry = controller.onQuotaFailure({
      provider: "gemini",
      model: "gemini-2.5-flash",
      error: new LlmError("slow", "LLM_RATE_LIMIT", true, 429, undefined, 15_000),
    });
    expect(retry.until).toBe(new Date(fixedNow.getTime() + 15_000).toISOString());

    const daily = controller.onQuotaFailure({
      provider: "groq",
      model: "llama",
      error: new LlmError("Quota exceeded for metric requests per day", "LLM_QUOTA_EXHAUSTED", false),
    });
    expect(daily.until).toBe(nextReset("day", fixedNow, "America/Los_Angeles").toISOString());

    const first = controller.onQuotaFailure({
      provider: "mock",
      model: "mock-v1",
      error: new LlmError("429", "LLM_RATE_LIMIT", true),
    });
    expect(Date.parse(first.until) - fixedNow.getTime()).toBe(60_000);
    const second = controller.onQuotaFailure({
      provider: "mock",
      model: "mock-v1",
      error: new LlmError("429", "LLM_RATE_LIMIT", true),
    });
    expect(Date.parse(second.until) - fixedNow.getTime()).toBe(5 * 60_000);
    controller.onQuotaFailure({ provider: "mock", model: "mock-v1", error: new LlmError("429", "LLM_RATE_LIMIT", true) });
    const capped = controller.onQuotaFailure({
      provider: "mock",
      model: "mock-v1",
      error: new LlmError("429", "LLM_RATE_LIMIT", true),
    });
    expect(Date.parse(capped.until) - fixedNow.getTime()).toBe(6 * 60 * 60_000);
    opened.sqlite.close();
  });

  it("lets a user rule override a preset limit", () => {
    const opened = database();
    const controller = createLlmQuotaController({ sqlite: opened.sqlite, now: () => fixedNow });
    saveUserQuotaRule(opened.sqlite, {
      provider: "gemini",
      model: "gemini-2.5-flash",
      kind: "free_tier",
      limits: [{ window: "day", requests: 1 }],
      resetTz: "America/Los_Angeles",
      note: "riêng",
      source: "user",
      enabled: true,
    });
    expect(controller.isUnavailable("gemini", "gemini-2.5-flash")).toBe(false);
    controller.recordCall({ provider: "gemini", model: "gemini-2.5-flash", inputTokens: 1, outputTokens: 1 });
    expect(controller.isUnavailable("gemini", "gemini-2.5-flash")).toBe(true);
    opened.sqlite.close();
  });
});

describe("llm quota routing", () => {
  function registryFor(opened: ReturnType<typeof database>, options: {
    spend?: number;
    notify?: (message: string) => void;
    policy?: "wait" | "paid_fallback";
    cap?: number;
  } = {}) {
    if (options.policy) {
      opened.sqlite.prepare(
        "INSERT INTO app_settings (key, value, updated_at) VALUES ('llmQuota', ?, ?)",
      ).run(JSON.stringify({
        rules: [],
        disabled: [],
        quotaPolicy: options.policy,
        paidFallbackDailyUsd: options.cap ?? 1,
        nearLimitRatio: 0.9,
      }), fixedNow.toISOString());
    }
    const controller = createLlmQuotaController({
      sqlite: opened.sqlite,
      now: () => fixedNow,
      spendToday: () => options.spend ?? 0,
      notifyPaid: options.notify,
      costOf: () => 0.25,
    });
    const registry = new LlmProviderRegistry(parseConfig({
      LLM_ENABLE_MOCK: "true",
      GEMINI_API_KEY: "gemini-key",
      GEMINI_MODEL: "gemini-2.5-flash",
      OPENAI_API_KEY: "openai-key",
      OPENAI_MODEL: "gpt-paid",
    }));
    registry.quota = controller;
    return { registry, controller };
  }

  function seedExhausted(sqlite: ReturnType<typeof database>["sqlite"], provider: string, model: string) {
    const start = currentWindowStart("day", fixedNow, "America/Los_Angeles").toISOString();
    sqlite.prepare(
      "INSERT INTO llm_quota_usage (id, provider, model, window_start, window, requests, input_tokens, output_tokens) VALUES (?, ?, ?, ?, 'day', 100000, 0, 0)",
    ).run(randomUUID(), provider, model, start);
  }

  const schema = z.object({ ok: z.literal(true) });
  const ok = {
    text: '{"ok":true}',
    usage: { inputTokens: 2, outputTokens: 3 },
    finishReason: "stop" as const,
  };

  it("skips an exhausted primary without calling it and keeps a single legacy fallback", async () => {
    const opened = database();
    const { registry } = registryFor(opened);
    seedExhausted(opened.sqlite, "gemini", "gemini-2.5-flash");
    const gemini = vi.spyOn(registry.get("gemini")!, "generate").mockRejectedValue(new Error("primary should be skipped"));
    const mock = vi.spyOn(registry.get("mock")!, "generate").mockResolvedValue({ ...ok, model: "fallback-model", provider: "mock" });
    const routed = registry.resolveTask("musicAssist", project({
      tasks: { musicAssist: { provider: "gemini", model: "gemini-2.5-flash", fallback: { provider: "mock", model: "fallback-model" } } },
    }));
    const result = await generateRoutedStructured({
      registry,
      route: routed,
      task: "musicAssist",
      system: "s",
      prompt: "p",
      schema,
      schemaName: "QuotaProbe",
      schemaVersion: "1",
      maxOutputTokens: 256,
      repairAttempts: 0,
      signal: new AbortController().signal,
    });
    expect(gemini).not.toHaveBeenCalled();
    expect(mock).toHaveBeenCalledTimes(1);
    expect(result.usage.calls).toEqual([
      expect.objectContaining({ provider: "mock", fallback: true, fallbackReason: "quota", ok: true }),
    ]);
    opened.sqlite.close();
  });

  it("follows fallbacks order and prefers free entries in ECO", async () => {
    const opened = database();
    const { registry } = registryFor(opened);
    const openai = vi.spyOn(registry.get("openai")!, "generate").mockRejectedValue(new Error("paid primary should wait in ECO"));
    const gemini = vi.spyOn(registry.get("gemini")!, "generate").mockResolvedValue({ ...ok, model: "gemini-2.5-flash", provider: "gemini" });
    const routed = registry.resolveTask("musicAssist", project({
      tasks: {
        musicAssist: {
          provider: "openai",
          model: "gpt-paid",
          fallbacks: [
            { provider: "gemini", model: "gemini-2.5-flash" },
            { provider: "mock", model: "mock-v1" },
          ],
        },
      },
    }));
    await generateRoutedStructured({
      registry,
      route: { ...routed, budgetMode: "ECO" },
      task: "musicAssist",
      system: "s",
      prompt: "p",
      schema,
      schemaName: "QuotaProbe",
      schemaVersion: "1",
      maxOutputTokens: 256,
      repairAttempts: 0,
      signal: new AbortController().signal,
    });
    expect(gemini).toHaveBeenCalledTimes(1);
    expect(openai).not.toHaveBeenCalled();
    openai.mockResolvedValue({ ...ok, model: "gpt-paid", provider: "openai" });
    await generateRoutedStructured({
      registry,
      route: { ...routed, budgetMode: "BALANCED" },
      task: "musicAssist",
      system: "s",
      prompt: "balanced",
      schema,
      schemaName: "QuotaProbe",
      schemaVersion: "1",
      maxOutputTokens: 256,
      repairAttempts: 0,
      signal: new AbortController().signal,
    });
    expect(openai).toHaveBeenCalledTimes(1);
    opened.sqlite.close();
  });

  it("waits when every entry is exhausted and reschedules the job without spending an attempt", async () => {
    const opened = database();
    const { registry } = registryFor(opened, { policy: "wait" });
    seedExhausted(opened.sqlite, "gemini", "gemini-2.5-flash");
    const gemini = vi.spyOn(registry.get("gemini")!, "generate").mockRejectedValue(new Error("exhausted primary should be skipped"));
    const routed = registry.resolveTask("musicAssist", project({
      tasks: { musicAssist: { provider: "gemini", model: "gemini-2.5-flash" } },
    }, "AUTO"));
    await expect(generateRoutedStructured({
      registry,
      route: routed,
      task: "musicAssist",
      system: "s",
      prompt: "p",
      schema,
      schemaName: "QuotaProbe",
      schemaVersion: "1",
      maxOutputTokens: 256,
      repairAttempts: 0,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({
      code: "LLM_QUOTA_WAIT",
      retryable: true,
      message: expect.stringMatching(/^Chờ quota reset lúc \d{2}:\d{2}$/),
      retryAt: expect.any(String),
    });
    expect(gemini).not.toHaveBeenCalled();

    const harness = createPipelineHarness({ mode: "AUTO" });
    harnesses.push(harness);
    harness.repository.ensureStages(harness.projectId);
    const job = harness.repository.createJob({
      projectId: harness.projectId,
      stage: "SCRIPT",
      maxAttempts: 3,
      previousState: "PENDING",
    });
    harness.repository.updateStage(harness.projectId, "SCRIPT", {
      state: "QUEUED",
      progress: 0,
      message: null,
      jobId: job.id,
      error: null,
    });
    harness.repository.updateJob(job.id, { status: "RUNNING", startedAt: harness.clock().toISOString() });
    const retryAt = "2026-11-03T07:00:00.000Z";
    harness.orchestrator.failJob(job.id, {
      code: "LLM_QUOTA_WAIT",
      message: "Chờ quota reset lúc 07:00",
      retryable: true,
      retryAt,
    });
    const updated = harness.repository.getJob(job.id);
    expect(updated?.status).toBe("QUEUED");
    expect(updated?.attempt).toBe(1);
    expect(updated?.runAfter).toBe(retryAt);
    expect(updated?.message).toBe("Chờ quota reset lúc 07:00");
    opened.sqlite.close();
  });

  it("uses a paid fallback under the daily cap once, and waits when the cap is already spent", async () => {
    const notices: string[] = [];
    const opened = database();
    const under = registryFor(opened, { policy: "paid_fallback", cap: 1, spend: 0, notify: (message) => notices.push(message) });
    seedExhausted(opened.sqlite, "gemini", "gemini-2.5-flash");
    const paid = vi.spyOn(under.registry.get("openai")!, "generate").mockResolvedValue({ ...ok, model: "gpt-paid", provider: "openai" });
    const routed = under.registry.resolveTask("musicAssist", project({
      tasks: {
        musicAssist: {
          provider: "gemini",
          model: "gemini-2.5-flash",
          fallbacks: [{ provider: "openai", model: "gpt-paid" }],
        },
      },
    }));
    const input = {
      registry: under.registry,
      route: routed,
      task: "musicAssist" as const,
      system: "s",
      prompt: "paid",
      schema,
      schemaName: "QuotaProbe",
      schemaVersion: "1",
      maxOutputTokens: 256,
      repairAttempts: 0 as const,
      signal: new AbortController().signal,
    };
    await generateRoutedStructured(input);
    await generateRoutedStructured({ ...input, prompt: "paid-again", signal: new AbortController().signal });
    expect(paid).toHaveBeenCalledTimes(2);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("gpt-paid");
    expect(notices[0]).toContain("musicAssist");

    const over = database();
    const capped = registryFor(over, { policy: "paid_fallback", cap: 1, spend: 2 });
    seedExhausted(over.sqlite, "gemini", "gemini-2.5-flash");
    const blocked = vi.spyOn(capped.registry.get("openai")!, "generate").mockRejectedValue(new Error("paid fallback should wait"));
    await expect(generateRoutedStructured({
      ...input,
      registry: capped.registry,
      route: capped.registry.resolveTask("musicAssist", project({
        tasks: {
          musicAssist: {
            provider: "gemini",
            model: "gemini-2.5-flash",
            fallbacks: [{ provider: "openai", model: "gpt-paid" }],
          },
        },
      })),
    })).rejects.toMatchObject({ code: "LLM_QUOTA_WAIT" });
    expect(blocked).not.toHaveBeenCalled();
    opened.sqlite.close();
    over.sqlite.close();
  });
});
