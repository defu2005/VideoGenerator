import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { currentWindowStart, nextReset } from "@vg/shared";
import { openDatabase } from "../src/db/client.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { parseConfig } from "../src/lib/config.js";
import { TokenVault } from "../src/publishing/tokenVault.js";
import { backfillLlmQuotaUsage, createLlmQuotaController, readQuotaStatus, saveUserQuotaRule } from "../src/providers/llm/quota.js";
import { replaceConnectionSnapshots } from "../src/providers/llm/omnirouteQuotaStore.js";
import { LlmProviderRegistry } from "../src/providers/llm/registry.js";
import { generateRoutedStructured } from "../src/providers/llm/structured.js";
import { OmniRouteQuotaSync } from "../src/services/omnirouteQuotaSync.js";
import { ProjectSchema } from "@vg/shared";
import Fastify from "fastify";
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";
import { registerLlmRoutes } from "../src/api/llm.js";

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const nowIso = "2026-06-15T18:00:00.000Z";
const fixedNow = new Date(nowIso);

function database() {
  const root = mkdtempSync(join(tmpdir(), "vg-omni-quota-"));
  roots.push(root);
  const opened = openDatabase(join(root, "app.db"));
  migrateDatabase(opened.db);
  return { ...opened, root };
}

function project(llm?: unknown) {
  return ProjectSchema.parse({
    id: "11111111-1111-4111-8111-111111111111",
    title: "Test",
    description: "",
    topic: "Test topic",
    mode: "ASSISTED",
    settings: { ...(llm ? { llm } : {}), budget: { mode: "BALANCED" } },
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

function snapshot(input: {
  provider?: string;
  key: string;
  used?: number | null;
  total?: number | null;
  remaining?: number | null;
  remainingPct?: number | null;
  resetAt?: string | null;
  unlimited?: boolean;
  fractionReported?: boolean | null;
  unit?: "requests" | "tokens" | "credits_usd" | "credits";
  fetchedAt?: string;
  error?: string | null;
}) {
  return {
    connectionId: "conn-1",
    omnirouteProvider: input.provider ?? "gemini",
    label: "Gemini",
    maskedAccount: "a***@gmail.com",
    quotaKey: input.key,
    used: input.used ?? 0,
    total: input.total ?? 100,
    remaining: input.remaining ?? null,
    remainingPct: input.remainingPct ?? 100,
    resetAt: input.resetAt ?? "2026-06-16T07:00:00.000Z",
    unlimited: input.unlimited ?? false,
    fractionReported: input.fractionReported ?? true,
    unit: input.unit ?? "requests" as const,
    expiresAt: null,
    fetchedAt: input.fetchedAt ?? nowIso,
    error: input.error ?? null,
    active: true,
    rateLimitNote: null,
  };
}

describe("live OmniRoute quota", () => {
  it("cools an exhausted live quota down until resetAt and skips the model", async () => {
    const opened = database();
    const resetAt = "2026-06-16T07:00:00.000Z";
    replaceConnectionSnapshots(opened.sqlite, [snapshot({
      key: "gemini-2.5-flash",
      used: 250,
      total: 250,
      remaining: 0,
      remainingPct: 0,
      resetAt,
    })]);
    const controller = createLlmQuotaController({ sqlite: opened.sqlite, now: () => fixedNow });
    expect(controller.isUnavailable("gemini", "gemini-2.5-flash")).toBe(true);
    const cooldown = opened.sqlite.prepare("SELECT until, reason FROM llm_cooldowns").get() as { until: string; reason: string };
    expect(cooldown.until).toBe(resetAt);
    expect(cooldown.reason).toBe("OmniRoute: hết quota gemini-2.5-flash");
    expect(controller.earliestRetryAt([{ provider: "gemini", model: "gemini-2.5-flash" }])).toBe(resetAt);

    const registry = new LlmProviderRegistry(parseConfig({
      LLM_ENABLE_MOCK: "true",
      GEMINI_API_KEY: "gemini-key",
      GEMINI_MODEL: "gemini-2.5-flash",
    }));
    registry.quota = controller;
    const gemini = vi.spyOn(registry.get("gemini")!, "generate").mockRejectedValue(new Error("must not call"));
    const routed = registry.resolveTask("musicAssist", project({
      tasks: { musicAssist: { provider: "gemini", model: "gemini-2.5-flash" } },
    }));
    await expect(generateRoutedStructured({
      registry,
      route: routed,
      task: "musicAssist",
      system: "s",
      prompt: "p",
      schema: z.object({ ok: z.literal(true) }),
      schemaName: "QuotaProbe",
      schemaVersion: "1",
      maxOutputTokens: 256,
      repairAttempts: 0,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: "LLM_QUOTA_WAIT", retryAt: resetAt });
    expect(gemini).not.toHaveBeenCalled();
    opened.sqlite.close();
  });

  it("uses local counting when the snapshot is stale", () => {
    const opened = database();
    const start = currentWindowStart("day", fixedNow, "America/Los_Angeles").toISOString();
    opened.sqlite.prepare(
      "INSERT INTO llm_quota_usage (id, provider, model, window_start, window, requests, input_tokens, output_tokens) VALUES (?, ?, ?, ?, 'day', 100000, 0, 0)",
    ).run(randomUUID(), "gemini", "gemini-2.5-flash", start);
    replaceConnectionSnapshots(opened.sqlite, [snapshot({
      key: "gemini-2.5-flash",
      remainingPct: 90,
      fetchedAt: new Date(fixedNow.getTime() - 21 * 60_000).toISOString(),
    })]);
    const controller = createLlmQuotaController({ sqlite: opened.sqlite, now: () => fixedNow });
    expect(controller.isUnavailable("gemini", "gemini-2.5-flash")).toBe(true);
    replaceConnectionSnapshots(opened.sqlite, [snapshot({ key: "gemini-2.5-flash", remainingPct: 90, fetchedAt: nowIso })]);
    expect(controller.isUnavailable("gemini", "gemini-2.5-flash")).toBe(false);
    opened.sqlite.close();
  });

  it("does not exhaust a fractionReported false snapshot", () => {
    const opened = database();
    replaceConnectionSnapshots(opened.sqlite, [snapshot({
      key: "gemini-2.5-flash",
      used: 0,
      total: 0,
      remainingPct: 0,
      fractionReported: false,
    })]);
    const controller = createLlmQuotaController({ sqlite: opened.sqlite, now: () => fixedNow });
    expect(controller.isUnavailable("gemini", "gemini-2.5-flash")).toBe(false);
    expect(opened.sqlite.prepare("SELECT COUNT(*) AS n FROM llm_cooldowns").get()).toEqual({ n: 0 });
    opened.sqlite.close();
  });
});

describe("credit rules", () => {
  it("spends estimated cost, ignores paid fallback, and does not wait forever", async () => {
    const opened = database();
    saveUserQuotaRule(opened.sqlite, {
      provider: "openrouter",
      model: "vendor/free",
      kind: "free_tier",
      limits: [{ window: "lifetime", creditsUsd: 1, unit: "credits_usd" }],
      resetTz: "UTC",
      note: "credit",
      source: "user",
      enabled: true,
    });
    const controller = createLlmQuotaController({
      sqlite: opened.sqlite,
      now: () => fixedNow,
      costOf: () => 0.4,
    });
    controller.recordCall({ provider: "openrouter", model: "vendor/free", inputTokens: 1000, outputTokens: 1000 });
    expect(readQuotaStatus(opened.sqlite, fixedNow).freeCreditSpendUsd).toBeCloseTo(0.4);
    expect(readQuotaStatus(opened.sqlite, fixedNow).paidFallbackSpendToday).toBe(0);
    expect(controller.isUnavailable("openrouter", "vendor/free")).toBe(false);
    controller.recordCall({ provider: "openrouter", model: "vendor/free", inputTokens: 1000, outputTokens: 1000 });
    controller.recordCall({ provider: "openrouter", model: "vendor/free", inputTokens: 1000, outputTokens: 1000 });
    expect(controller.isUnavailable("openrouter", "vendor/free")).toBe(true);
    expect(controller.earliestRetryAt([{ provider: "openrouter", model: "vendor/free" }])).toBeNull();

    const registry = new LlmProviderRegistry(parseConfig({
      LLM_ENABLE_MOCK: "true",
      OPENROUTER_API_KEY: "or-key",
      OPENROUTER_MODEL: "vendor/free",
    }));
    registry.quota = controller;
    const primary = vi.spyOn(registry.get("openrouter")!, "generate").mockRejectedValue(new Error("must not call"));
    const mock = vi.spyOn(registry.get("mock")!, "generate").mockResolvedValue({
      text: '{"ok":true}',
      usage: { inputTokens: 1, outputTokens: 1 },
      finishReason: "stop",
      model: "mock-v1",
      provider: "mock",
    });
    const routed = registry.resolveTask("musicAssist", project({
      tasks: { musicAssist: { provider: "openrouter", model: "vendor/free", fallback: { provider: "mock", model: "mock-v1" } } },
    }));
    const schema = z.object({ ok: z.literal(true) });
    await generateRoutedStructured({
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
    expect(primary).not.toHaveBeenCalled();
    expect(mock).toHaveBeenCalledTimes(1);

    const alone = registry.resolveTask("musicAssist", project({
      tasks: { musicAssist: { provider: "openrouter", model: "vendor/free" } },
    }));
    await expect(generateRoutedStructured({
      registry,
      route: alone,
      task: "musicAssist",
      system: "s",
      prompt: "alone",
      schema,
      schemaName: "QuotaProbe",
      schemaVersion: "1",
      maxOutputTokens: 256,
      repairAttempts: 0,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({
      code: "LLM_QUOTA_EXHAUSTED",
      retryable: false,
      message: "Hết credit, cần nạp hoặc tạo quy tắc mới",
    });
    opened.sqlite.close();
  });

  it("treats a passed expiry as exhausted and a three-day expiry as near", () => {
    const opened = database();
    saveUserQuotaRule(opened.sqlite, {
      provider: "deepseek",
      model: "deepseek-chat",
      kind: "free_tier",
      limits: [{ window: "lifetime", creditsUsd: 5, unit: "credits_usd", expiresAt: "2026-06-14T00:00:00.000Z" }],
      resetTz: "UTC",
      note: "hết hạn",
      source: "user",
      enabled: true,
    });
    const expired = readQuotaStatus(opened.sqlite, fixedNow).rows.find((row) => row.model === "deepseek-chat");
    expect(expired?.status).toBe("exhausted");
    saveUserQuotaRule(opened.sqlite, {
      provider: "deepseek",
      model: "deepseek-chat",
      kind: "free_tier",
      limits: [{ window: "lifetime", creditsUsd: 5, unit: "credits_usd", expiresAt: "2026-06-17T18:00:00.000Z" }],
      resetTz: "UTC",
      note: "sắp hết hạn",
      source: "user",
      enabled: true,
    });
    const near = readQuotaStatus(opened.sqlite, fixedNow).rows.find((row) => row.model === "deepseek-chat");
    expect(near?.status).toBe("near");
    opened.sqlite.close();
  });
});

describe("local quota fixes", () => {
  it("backfills jobs.usage once", () => {
    const opened = database();
    const projectId = randomUUID();
    const stamp = nowIso;
    opened.sqlite.prepare(
      "INSERT INTO projects (id, title, topic, mode, settings, status, stage, created_at, updated_at) VALUES (?, 't', 't', 'ASSISTED', '{}', 'DRAFT', 'TOPIC', ?, ?)",
    ).run(projectId, stamp, stamp);
    const usage = JSON.stringify({
      llmCalls: 2,
      inputTokens: 3,
      outputTokens: 4,
      costUsd: 0,
      calls: [
        { task: "script", provider: "mock", model: "m", inputTokens: 3, outputTokens: 4, cached: false, fallback: false, ok: true },
        { task: "script", provider: "mock", model: "m", inputTokens: 1, outputTokens: 1, cached: true, fallback: false, ok: true },
      ],
    });
    opened.sqlite.prepare(
      `INSERT INTO jobs (id, project_id, stage, status, usage, created_at, started_at, finished_at, run_after, previous_state)
       VALUES (?, ?, 'SCRIPT', 'SUCCEEDED', ?, ?, ?, ?, ?, 'PENDING')`,
    ).run(randomUUID(), projectId, usage, stamp, stamp, stamp, stamp);
    expect(backfillLlmQuotaUsage(opened.sqlite, fixedNow).applied).toBe(true);
    const day = opened.sqlite.prepare(
      "SELECT requests FROM llm_quota_usage WHERE provider = 'mock' AND model = 'm' AND window = 'day'",
    ).get() as { requests: number };
    expect(day.requests).toBe(1);
    expect(backfillLlmQuotaUsage(opened.sqlite, fixedNow).applied).toBe(false);
    const again = opened.sqlite.prepare(
      "SELECT requests FROM llm_quota_usage WHERE provider = 'mock' AND model = 'm' AND window = 'day'",
    ).get() as { requests: number };
    expect(again.requests).toBe(1);
    opened.sqlite.close();
  });

  it("shows the reset of the window that limits the most", () => {
    const opened = database();
    const minuteStart = currentWindowStart("minute", fixedNow, "America/Los_Angeles").toISOString();
    opened.sqlite.prepare(
      "INSERT INTO llm_quota_usage (id, provider, model, window_start, window, requests, input_tokens, output_tokens) VALUES (?, 'gemini', 'gemini-2.5-flash', ?, 'minute', 10, 0, 0)",
    ).run(randomUUID(), minuteStart);
    const row = readQuotaStatus(opened.sqlite, fixedNow).rows.find((item) => item.model === "gemini-2.5-flash");
    expect(row?.nextReset).toBe(nextReset("minute", fixedNow, "America/Los_Angeles").toISOString());

    opened.sqlite.prepare("DELETE FROM llm_quota_usage").run();
    const idle = readQuotaStatus(opened.sqlite, fixedNow).rows.find((item) => item.model === "gemini-2.5-flash");
    expect(idle?.nextReset).toBe(nextReset("day", fixedNow, "America/Los_Angeles").toISOString());
    opened.sqlite.close();
  });
});

describe("OmniRoute management token", () => {
  it("turns HTTP 401 into needs_token and never returns or logs the token", async () => {
    const opened = database();
    const token = "oma_live_secret1234";
    const logs: unknown[] = [];
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: "unauthorized", token }), { status: 401 }));
    const sync = new OmniRouteQuotaSync({
      sqlite: opened.sqlite,
      vault: new TokenVault(opened.sqlite, opened.root),
      baseUrl: "http://127.0.0.1:20128/v1",
      apiKey: "should-not-win",
      fetchImpl,
      logger: {
        info: (obj) => logs.push(obj),
        warn: (obj) => logs.push(obj),
        error: (obj) => logs.push(obj),
      },
      now: () => fixedNow,
    });
    sync.saveToken(token);
    await sync.refresh(true);
    expect(fetchImpl).toHaveBeenCalled();
    const header = new Headers((fetchImpl.mock.calls[0]?.[1] as RequestInit | undefined)?.headers);
    expect(header.get("authorization")).toBe(`Bearer ${token}`);
    const status = readQuotaStatus(opened.sqlite, fixedNow);
    status.omniroute.tokenLast4 = sync.tokenMeta().last4;
    const body = JSON.stringify(status);
    expect(status.omniroute.status).toBe("needs_token");
    expect(status.omniroute.tokenLast4).toBe("1234");
    expect(body).not.toContain(token);
    expect(JSON.stringify(logs)).not.toContain(token);
    const stored = opened.sqlite.prepare("SELECT error, label, masked_account FROM llm_provider_quota_snapshots").all();
    expect(JSON.stringify(stored)).not.toContain(token);

    const app = Fastify().withTypeProvider<ZodTypeProvider>();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    const registry = new LlmProviderRegistry(parseConfig({ LLM_ENABLE_MOCK: "true" }));
    registerLlmRoutes(app, registry, opened.sqlite, undefined, undefined, fetchImpl, sync);
    const response = await app.inject({ method: "GET", url: "/api/llm/quota" });
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain(token);
    expect(response.json().omniroute.tokenLast4).toBe("1234");
    await app.close();
    opened.sqlite.close();
  });

  it("stores masked emails and parsed quotas from a successful sync", async () => {
    const opened = database();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/providers")) {
        return new Response(JSON.stringify({
          connections: [{ id: "gh-1", provider: "github", name: "Copilot", isActive: true, email: "alice@gmail.com" }],
        }), { status: 200 });
      }
      if (url.endsWith("/api/usage/gh-1")) {
        return new Response(JSON.stringify({
          plan: "Copilot Pro",
          quotas: {
            premium_interactions: { used: 10, total: 300, remainingPercentage: 96, resetAt: "2026-07-01T00:00:00.000Z", unlimited: false },
          },
        }), { status: 200 });
      }
      if (url.endsWith("/api/rate-limits")) {
        return new Response(JSON.stringify({ accounts: [{ connectionId: "gh-1", remaining: 4 }] }), { status: 200 });
      }
      return new Response("no", { status: 404 });
    });
    const sync = new OmniRouteQuotaSync({
      sqlite: opened.sqlite,
      vault: new TokenVault(opened.sqlite, opened.root),
      baseUrl: "http://127.0.0.1:20128/v1",
      fetchImpl,
      now: () => fixedNow,
    });
    await sync.refresh(true);
    const row = opened.sqlite.prepare(
      "SELECT masked_account, quota_key, used, total, rate_limit_note FROM llm_provider_quota_snapshots",
    ).get() as { masked_account: string; quota_key: string; used: number; total: number; rate_limit_note: string };
    expect(row.masked_account).toBe("a***@gmail.com");
    expect(row.quota_key).toBe("premium_interactions");
    expect(row.used).toBe(10);
    expect(row.total).toBe(300);
    expect(row.rate_limit_note).toContain("4");
    expect(JSON.stringify(row)).not.toContain("alice@gmail.com");
    const view = readQuotaStatus(opened.sqlite, fixedNow).omniroute;
    expect(view.status).toBe("connected");
    expect(view.connections[0]?.quotas[0]?.display).toBe("10 / 300 lượt");
    opened.sqlite.close();
  });
});
