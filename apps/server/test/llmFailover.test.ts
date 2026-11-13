import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ProjectSchema } from "@vg/shared";
import { buildApp } from "../src/app.js";
import { testActor } from "./testActor.js";
import { parseConfig, type AppConfig } from "../src/lib/config.js";
import { LlmProviderRegistry } from "../src/providers/llm/registry.js";
import { generateRoutedStructured } from "../src/providers/llm/structured.js";
import { FailoverTracker } from "../src/providers/llm/failover.js";
import { LlmError } from "../src/providers/llm/types.js";
import { AutonomySupervisor, listSupervisorState } from "../src/operator/supervisor.js";
import { ASSISTANT_TOOLS } from "../src/assistant/tools.js";

// TASK-127: no network and no real CLIs; providers are spied and made to throw the error codes.
const schema = z.object({ ok: z.literal(true) });
const ok = { text: '{"ok":true}', usage: { inputTokens: 2, outputTokens: 3 }, finishReason: "stop" as const };
const nowIso = "2026-06-15T18:00:00.000Z";

function project(tasks: unknown) {
  return ProjectSchema.parse({
    id: "11111111-1111-4111-8111-111111111111", title: "T", description: "", topic: "T", mode: "ASSISTED",
    settings: { llm: { tasks }, budget: { mode: "BALANCED" } }, status: "DRAFT", stage: "TOPIC",
    thumbnailPath: null, durationSec: null, version: 1, createdAt: nowIso, updatedAt: nowIso, archivedAt: null,
  });
}

function makeRegistry() {
  return new LlmProviderRegistry(parseConfig({
    LLM_ENABLE_MOCK: "true", GEMINI_API_KEY: "g", GEMINI_MODEL: "gemini-2.5-flash", OPENAI_API_KEY: "o", OPENAI_MODEL: "gpt-x",
  }));
}

const quotaError = () => new LlmError("quota", "LLM_QUOTA_EXHAUSTED", false, 429);
const rateError = () => new LlmError("slow down", "LLM_RATE_LIMIT", true, 429);

function setup(fallbacks: Array<{ provider: string; model: string }> = [{ provider: "openai", model: "gpt-x" }, { provider: "mock", model: "mock-v1" }]) {
  const registry = makeRegistry();
  const routed = registry.resolveTask("musicAssist", project({
    musicAssist: { provider: "gemini", model: "gemini-2.5-flash", fallbacks },
  }));
  const gemini = vi.spyOn(registry.get("gemini")!, "generate");
  const openai = vi.spyOn(registry.get("openai")!, "generate");
  const mock = vi.spyOn(registry.get("mock")!, "generate");
  const run = (extra: Record<string, unknown> = {}) => generateRoutedStructured({
    registry, route: routed, task: "musicAssist", system: "s", prompt: `p-${Math.random()}`, schema,
    schemaName: "Probe", schemaVersion: "1", maxOutputTokens: 256, repairAttempts: 0,
    signal: new AbortController().signal, ...extra,
  });
  return { registry, gemini, openai, mock, run };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("llm failover chain", () => {
  it("moves a quota error to the fallback and bills the fallback", async () => {
    const { gemini, openai, run } = setup();
    gemini.mockRejectedValue(quotaError());
    openai.mockResolvedValue({ ...ok, model: "gpt-x", provider: "openai" });
    const result = await run();
    expect(result.provider).toBe("openai");
    const last = result.usage.calls.at(-1)!;
    expect(last).toMatchObject({ provider: "openai", model: "gpt-x", fallback: true, ok: true });
  });

  it("fails over on a rate limit and on a 503", async () => {
    const { registry, gemini, openai, run } = setup();
    gemini.mockRejectedValue(rateError());
    openai.mockResolvedValue({ ...ok, model: "gpt-x", provider: "openai" });
    expect((await run()).provider).toBe("openai");
    expect(registry.failover.recentFailovers()).toHaveLength(1);
    gemini.mockRejectedValue(new LlmError("down", "LLM_UNAVAILABLE", true, 503));
    registry.failover.recordSuccess("gemini", "gemini-2.5-flash");
    expect((await run()).provider).toBe("openai");
  });

  it("does not fail over on an invalid output", async () => {
    const { gemini, openai, run } = setup();
    gemini.mockResolvedValue({ text: "not json", usage: { inputTokens: 1, outputTokens: 1 }, model: "gemini-2.5-flash", provider: "gemini", finishReason: "stop" });
    await expect(run()).rejects.toMatchObject({ code: "LLM_INVALID_OUTPUT" });
    expect(openai).not.toHaveBeenCalled();
  });

  it("does not fail over when the call is aborted", async () => {
    const { gemini, openai, run } = setup();
    const controller = new AbortController();
    gemini.mockImplementation(async () => {
      controller.abort();
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    });
    await expect(run({ signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(openai).not.toHaveBeenCalled();
  });

  it("skips a fallback that cannot read images and says why", async () => {
    const { gemini, openai, mock, run } = setup();
    gemini.mockRejectedValue(quotaError());
    const attempt = run({ images: [{ path: "does-not-matter.png", label: "a" }] });
    await expect(attempt).rejects.toMatchObject({ code: "LLM_ALL_PROVIDERS_EXHAUSTED" });
    await expect(attempt).rejects.toThrow(/không đọc được ảnh|vision/i);
    expect(openai).not.toHaveBeenCalled();
    expect(mock).not.toHaveBeenCalled();
  });

  it("skips a fallback whose context is too small", async () => {
    const { registry, gemini, openai, mock, run } = setup();
    gemini.mockRejectedValue(quotaError());
    Object.defineProperty(registry.get("openai")!, "limits", { value: { maxInputTokens: 5 }, configurable: true });
    mock.mockResolvedValue({ ...ok, model: "mock-v1", provider: "mock" });
    const result = await run({ prompt: "x".repeat(4000) });
    expect(result.provider).toBe("mock");
    expect(openai).not.toHaveBeenCalled();
  });

  it("throws LLM_ALL_PROVIDERS_EXHAUSTED listing every provider and reason", async () => {
    const { gemini, openai, mock, run } = setup();
    gemini.mockRejectedValue(quotaError());
    openai.mockRejectedValue(rateError());
    mock.mockRejectedValue(new LlmError("down", "LLM_UNAVAILABLE", true, 503));
    const error = await run().catch((caught: unknown) => caught as LlmError);
    expect(error).toBeInstanceOf(LlmError);
    expect(error.code).toBe("LLM_ALL_PROVIDERS_EXHAUSTED");
    expect(error.retryable).toBe(true);
    for (const text of ["gemini/gemini-2.5-flash", "LLM_QUOTA_EXHAUSTED", "openai/gpt-x", "LLM_RATE_LIMIT", "mock/mock-v1", "LLM_UNAVAILABLE"]) {
      expect(error.message).toContain(text);
    }
  });

  it("skips a cooling provider without calling it, until the cooldown ends", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(nowIso));
    const { gemini, openai, run } = setup();
    gemini.mockRejectedValue(quotaError());
    openai.mockResolvedValue({ ...ok, model: "gpt-x", provider: "openai" });
    await run();
    expect(gemini).toHaveBeenCalledTimes(1);
    await run();
    expect(gemini).toHaveBeenCalledTimes(1); // still resting
    vi.setSystemTime(new Date(Date.parse(nowIso) + 31 * 60_000));
    await run();
    expect(gemini).toHaveBeenCalledTimes(2); // quota rest (30 min) is over
  });

  it("clears the cooldown after a success", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(nowIso));
    const { registry, gemini, openai, run } = setup();
    gemini.mockRejectedValueOnce(rateError());
    openai.mockResolvedValue({ ...ok, model: "gpt-x", provider: "openai" });
    await run();
    expect(registry.failover.snapshot().cooldowns).toHaveLength(1);
    vi.setSystemTime(new Date(Date.parse(nowIso) + 61_000));
    gemini.mockResolvedValue({ ...ok, model: "gemini-2.5-flash", provider: "gemini" });
    expect((await run()).provider).toBe("gemini");
    expect(registry.failover.snapshot().cooldowns).toHaveLength(0);
  });
});

describe("failover tracker cooldowns", () => {
  it("doubles the rate-limit cooldown up to 15 minutes and resets on success", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(nowIso));
    const tracker = new FailoverTracker();
    const lengths: number[] = [];
    for (let i = 0; i < 6; i++) {
      const entry = tracker.recordFailure("gemini", "m", rateError())!;
      lengths.push(entry.until - Date.now());
    }
    expect(lengths).toEqual([60_000, 120_000, 240_000, 480_000, 900_000, 900_000]);
    tracker.recordSuccess("gemini", "m");
    expect(tracker.cooldownFor("gemini", "m")).toBeNull();
    expect(tracker.recordFailure("gemini", "m", rateError())!.until - Date.now()).toBe(60_000);
  });

  it("rests a quota error until its reset time, else 30 minutes", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(nowIso));
    const tracker = new FailoverTracker();
    const reset = new Date(Date.parse(nowIso) + 5 * 3600_000).toISOString();
    expect(tracker.recordFailure("a", null, new LlmError("q", "LLM_QUOTA_EXHAUSTED", false, undefined, undefined, undefined, reset))!.until)
      .toBe(Date.parse(reset));
    expect(tracker.recordFailure("b", null, quotaError())!.until - Date.now()).toBe(30 * 60_000);
    expect(tracker.recordFailure("c", null, new LlmError("pay", "LLM_BAD_REQUEST", false, 402))!.reason).toBe("quota");
  });
});

describe("llm health, tool and anomaly", () => {
  const root = mkdtempSync(join(tmpdir(), "vg-failover-test-"));
  let config: AppConfig;
  let app: ReturnType<typeof buildApp>;

  beforeAll(() => {
    config = parseConfig({
      DATA_DIR: join(root, "data"), DATABASE_PATH: join(root, "failover.db"), PORT: "3013", HOST: "127.0.0.1",
      LOG_LEVEL: "silent", CORS_ORIGIN: "http://localhost:5173", WEB_BASE_URL: "http://localhost:5180",
      LLM_ENABLE_MOCK: "true", LLM_DEFAULT_PROVIDER: "mock", TTS_PROVIDER: "mock", WORKER_ENABLED: "false",
      FAKE_STAGE_DELAY_MS: "0", TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    });
    app = buildApp({ testActor, config });
  });

  afterAll(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("shows cooldowns through the health API and the get_llm_health tool", async () => {
    const ctx = app.vgAssistant.service.toolContext();
    ctx.registry.failover.recordFailure("gemini", "gemini-2.5-flash", rateError());
    const response = await app.inject({ method: "GET", url: "/api/llm/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json().cooldowns).toEqual([expect.objectContaining({ provider: "gemini", reason: "rate_limit" })]);
    const tool = ASSISTANT_TOOLS["get_llm_health"]!;
    expect(tool.risk).toBe("read");
    expect((await tool.execute({}, ctx) as { cooldowns: unknown[] }).cooldowns).toHaveLength(1);
  });

  it("raises llm_failover_storm only after more than 10 failovers in 10 minutes", () => {
    const ctx = app.vgAssistant.service.toolContext();
    const { sqlite, orchestrator, usage } = ctx;
    const supervisor = new AutonomySupervisor({
      repository: orchestrator.repository, usage, stageTimeoutMs: 60_000, logger: app.log,
      llmFailovers: () => ctx.registry.failover.recentFailovers().length,
    });
    const storm = () => listSupervisorState(sqlite).findings.some(({ kind }) => kind === "llm_failover_storm");
    for (let i = 0; i < 10; i++) ctx.registry.failover.recordFailover({ task: "t", from: "a/m", to: "b/m", reason: "LLM_RATE_LIMIT" });
    supervisor.runPass();
    expect(storm()).toBe(false);
    ctx.registry.failover.recordFailover({ task: "t", from: "a/m", to: "b/m", reason: "LLM_RATE_LIMIT" });
    supervisor.runPass();
    expect(storm()).toBe(true);
  });
});
