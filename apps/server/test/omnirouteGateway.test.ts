import Database from "better-sqlite3";
import Fastify from "fastify";
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ProjectSchema } from "@vg/shared";
import { registerLlmRoutes } from "../src/api/llm.js";
import { parseConfig } from "../src/lib/config.js";
import { getLlmGatewaySettings } from "../src/providers/llm/gatewaySettings.js";
import {
  OmniRouteCatalogService,
  parseOmnirouteModelsPayload,
  resolveOmnirouteModelId,
  shouldGatewayFallback,
} from "../src/providers/llm/omnirouteCatalog.js";
import { estimateLlmCost } from "../src/providers/llm/pricing.js";
import { LlmProviderRegistry } from "../src/providers/llm/registry.js";
import { generateRoutedStructured } from "../src/providers/llm/structured.js";
import { LlmError } from "../src/providers/llm/types.js";

const now = "2026-11-04T00:00:00.000Z";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

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

function catalogPayload() {
  return {
    data: [
      {
        id: "gemini-2.5-flash",
        owned_by: "google",
        context_window: 1_000_000,
        vision: true,
        pricing: { inputPerMTok: 0.1, outputPerMTok: 0.4 },
        weird_extra: { ignore: true },
      },
      {
        id: "cc/claude-sonnet",
        ownedBy: "anthropic",
        architecture: { modality: "text+image" },
      },
    ],
  };
}

describe("OmniRoute catalog and health", () => {
  it("parses OpenAI-style model rows and caches catalog for 10 minutes", async () => {
    expect(parseOmnirouteModelsPayload(catalogPayload())).toEqual([
      {
        id: "gemini-2.5-flash",
        ownedBy: "google",
        contextWindow: 1_000_000,
        vision: true,
        pricing: { inputPerMTok: 0.1, outputPerMTok: 0.4 },
      },
      {
        id: "cc/claude-sonnet",
        ownedBy: "anthropic",
        vision: true,
      },
    ]);

    const fetchImpl = vi.fn(async () => jsonResponse(catalogPayload()));
    const catalog = new OmniRouteCatalogService(
      parseConfig({ OMNIROUTE_API_KEY: "omni-key" }),
      fetchImpl as typeof fetch,
    );
    expect(await catalog.getModels()).toHaveLength(2);
    expect(await catalog.getModels()).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 11 * 60_000);
    expect(await catalog.getModels()).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("reports health up and down with a short timeout", async () => {
    const upFetch = vi.fn(async () => jsonResponse(catalogPayload()));
    const up = new OmniRouteCatalogService(
      parseConfig({ OMNIROUTE_API_KEY: "omni-key" }),
      upFetch as typeof fetch,
    );
    await expect(up.health()).resolves.toMatchObject({
      reachable: true,
      modelCount: 2,
      configured: true,
      lastError: null,
      baseUrl: "http://127.0.0.1:20128/v1",
    });

    const down = new OmniRouteCatalogService(
      parseConfig({ OMNIROUTE_API_KEY: "omni-key" }),
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }) as typeof fetch,
    );
    await expect(down.health()).resolves.toMatchObject({
      reachable: false,
      modelCount: 0,
      configured: true,
      lastError: "fetch failed",
    });

    const off = new OmniRouteCatalogService(parseConfig({}), vi.fn() as typeof fetch);
    await expect(off.health()).resolves.toMatchObject({
      reachable: false,
      configured: false,
      setupHint: expect.stringContaining("OMNIROUTE_API_KEY"),
    });
  });
});

describe("OmniRoute gateway routing", () => {
  it("maps by catalog id or explicit mapping, and never auto-maps CLI providers", () => {
    const ids = new Set(["gemini-2.5-flash", "cc/claude-sonnet"]);
    expect(resolveOmnirouteModelId("gemini", "gemini-2.5-flash", ids, [])).toBe("gemini-2.5-flash");
    expect(resolveOmnirouteModelId("anthropic", "claude-sonnet-5-5", ids, [
      { provider: "anthropic", model: "claude-sonnet-5-5", omnirouteModel: "cc/claude-sonnet" },
    ])).toBe("cc/claude-sonnet");
    expect(resolveOmnirouteModelId("claude-cli", "claude-sonnet-5-5", ids, [])).toBeUndefined();
    expect(resolveOmnirouteModelId("claude-cli", "claude-sonnet-5-5", ids, [
      { provider: "claude-cli", model: "claude-sonnet-5-5", omnirouteModel: "cc/claude-sonnet" },
    ])).toBe("cc/claude-sonnet");
  });

  it("prefer mode routes through OmniRoute and falls back only on connection/5xx", async () => {
    const registry = new LlmProviderRegistry(parseConfig({
      LLM_ENABLE_MOCK: "true",
      OMNIROUTE_API_KEY: "omni-key",
      OMNIROUTE_MODEL: "gemini-2.5-flash",
      GEMINI_API_KEY: "gemini-key",
      GEMINI_MODEL: "gemini-2.5-flash",
    }));
    registry.setGatewaySettingsLoader(() => ({ mode: "prefer", mappings: [] }));
    await registry.omnirouteCatalog.getModels({
      fetchImpl: vi.fn(async () => jsonResponse(catalogPayload())) as typeof fetch,
    });

    const omni = registry.get("omniroute")!;
    const gemini = registry.get("gemini")!;
    const omniGenerate = vi.spyOn(omni, "generate").mockResolvedValue({
      text: '{"summary":"via gateway"}',
      usage: { inputTokens: 5, outputTokens: 7 },
      model: "gemini-2.5-flash",
      provider: "omniroute",
      finishReason: "stop",
    });
    const geminiGenerate = vi.spyOn(gemini, "generate");

    const routed = registry.resolveTask("research", project({
      tasks: { research: { provider: "gemini", model: "gemini-2.5-flash" } },
    }));
    const throughGateway = await generateRoutedStructured({
      registry,
      route: routed,
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
    expect(throughGateway.value.summary).toBe("via gateway");
    expect(throughGateway.provider).toBe("omniroute");
    expect(throughGateway.usage.calls).toEqual([
      expect.objectContaining({ provider: "omniroute", model: "gemini-2.5-flash", ok: true, fallback: false }),
    ]);
    expect(geminiGenerate).not.toHaveBeenCalled();

    omniGenerate.mockRejectedValueOnce(new LlmError("down", "LLM_UNAVAILABLE", true, 503));
    geminiGenerate.mockResolvedValue({
      text: '{"summary":"direct"}',
      usage: { inputTokens: 2, outputTokens: 3 },
      model: "gemini-2.5-flash",
      provider: "gemini",
      finishReason: "stop",
    });
    const recovered = await generateRoutedStructured({
      registry,
      route: routed,
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
    expect(recovered.value.summary).toBe("direct");
    expect(recovered.usage.calls).toEqual([
      expect.objectContaining({ provider: "omniroute", ok: false, fallback: false }),
      expect.objectContaining({ provider: "gemini", ok: true, fallback: true }),
    ]);

    omniGenerate.mockRejectedValueOnce(new LlmError("bad request", "LLM_BAD_REQUEST", false, 400));
    await expect(generateRoutedStructured({
      registry,
      route: routed,
      task: "research",
      system: "research",
      prompt: "Offline fixture prompt",
      schema: z.object({ summary: z.string() }),
      schemaName: "Research",
      schemaVersion: "1",
      maxOutputTokens: 256,
      repairAttempts: 0,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: "LLM_BAD_REQUEST" });
    expect(shouldGatewayFallback(new LlmError("x", "LLM_BAD_REQUEST", false, 400))).toBe(false);
    expect(shouldGatewayFallback(new LlmError("x", "LLM_UNAVAILABLE", true))).toBe(true);
  });

  it("only mode fails preflight when the task model is not listed", async () => {
    const registry = new LlmProviderRegistry(parseConfig({
      LLM_ENABLE_MOCK: "true",
      OMNIROUTE_API_KEY: "omni-key",
    }));
    registry.setGatewaySettingsLoader(() => ({ mode: "only", mappings: [] }));
    await registry.omnirouteCatalog.getModels({
      fetchImpl: vi.fn(async () => jsonResponse(catalogPayload())) as typeof fetch,
    });
    const routed = registry.resolveTask("research", project({
      tasks: { research: { provider: "mock", model: "mock-v1" } },
    }));
    await expect(generateRoutedStructured({
      registry,
      route: routed,
      task: "research",
      system: "research",
      prompt: "Offline fixture prompt",
      schema: z.object({ summary: z.string() }),
      schemaName: "Research",
      schemaVersion: "1",
      maxOutputTokens: 256,
      repairAttempts: 0,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({
      code: "LLM_NOT_CONFIGURED",
      message: expect.stringContaining("only"),
    });
  });

  it("only mode never falls back to a direct provider when OmniRoute fails", async () => {
    const registry = new LlmProviderRegistry(parseConfig({
      LLM_ENABLE_MOCK: "true",
      OMNIROUTE_API_KEY: "omni-key",
      GEMINI_API_KEY: "gemini-key",
      GEMINI_MODEL: "gemini-2.5-flash",
    }));
    registry.setGatewaySettingsLoader(() => ({ mode: "only", mappings: [] }));
    await registry.omnirouteCatalog.getModels({
      fetchImpl: vi.fn(async () => jsonResponse(catalogPayload())) as typeof fetch,
    });
    vi.spyOn(registry.get("omniroute")!, "generate")
      .mockRejectedValue(new LlmError("down", "LLM_UNAVAILABLE", true, 503));
    const geminiGenerate = vi.spyOn(registry.get("gemini")!, "generate");
    const mockGenerate = vi.spyOn(registry.get("mock")!, "generate");
    const routed = registry.resolveTask("research", project({
      tasks: { research: { provider: "gemini", model: "gemini-2.5-flash" } },
    }));
    await expect(generateRoutedStructured({
      registry,
      route: { ...routed, fallback: { provider: "mock", model: "mock-v1" } },
      task: "research",
      system: "research",
      prompt: "Offline fixture prompt",
      schema: z.object({ summary: z.string() }),
      schemaName: "Research",
      schemaVersion: "1",
      maxOutputTokens: 256,
      repairAttempts: 0,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: "LLM_UNAVAILABLE" });
    expect(geminiGenerate).not.toHaveBeenCalled();
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it("records usage under provider omniroute with catalog pricing", async () => {
    const registry = new LlmProviderRegistry(parseConfig({
      LLM_ENABLE_MOCK: "true",
      OMNIROUTE_API_KEY: "omni-key",
      OMNIROUTE_MODEL: "gemini-2.5-flash",
      LLM_PRICES_JSON: JSON.stringify({ "omniroute:gemini-2.5-flash": { inputPerMTok: 9, outputPerMTok: 9 } }),
    }));
    registry.setGatewaySettingsLoader(() => ({
      mode: "prefer",
      mappings: [{ provider: "mock", model: "mock-v1", omnirouteModel: "gemini-2.5-flash" }],
    }));
    await registry.omnirouteCatalog.getModels({
      fetchImpl: vi.fn(async () => jsonResponse(catalogPayload())) as typeof fetch,
    });
    const omni = registry.get("omniroute")!;
    vi.spyOn(omni, "generate").mockResolvedValue({
      text: '{"summary":"priced"}',
      usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 },
      model: "gemini-2.5-flash",
      provider: "omniroute",
      finishReason: "stop",
    });
    const routed = registry.resolveTask("research", project({
      default: { provider: "mock", model: "mock-v1" },
    }));
    const generated = await generateRoutedStructured({
      registry,
      route: routed,
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
    expect(generated.provider).toBe("omniroute");
    expect(generated.model).toBe("gemini-2.5-flash");
    expect(estimateLlmCost(
      { LLM_PRICES_JSON: JSON.stringify({ "omniroute:gemini-2.5-flash": { inputPerMTok: 9, outputPerMTok: 9 } }) },
      generated.provider,
      generated.model,
      generated.usage,
    )).toBeCloseTo(0.5);
  });
});

describe("OmniRoute gateway API", () => {
  it("serves health, catalog refresh, and persists gateway settings", async () => {
    const sqlite = new Database(":memory:");
    sqlite.exec("CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)");
    expect(getLlmGatewaySettings(sqlite)).toEqual({ mode: "off", mappings: [] });

    const fetchImpl = vi.fn(async () => jsonResponse(catalogPayload())) as typeof fetch;
    const registry = new LlmProviderRegistry(parseConfig({
      LLM_ENABLE_MOCK: "true",
      OMNIROUTE_API_KEY: "omni-key",
    }), { fetchImpl });
    registry.setGatewaySettingsLoader(() => getLlmGatewaySettings(sqlite));

    const app = Fastify().withTypeProvider<ZodTypeProvider>();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    registerLlmRoutes(app, registry, sqlite, undefined, undefined, fetchImpl);
    try {
      const health = await app.inject({ method: "GET", url: "/api/llm/providers/omniroute/health" });
      expect(health.statusCode).toBe(200);
      expect(health.json()).toMatchObject({ reachable: true, modelCount: 2 });

      const saved = await app.inject({
        method: "PUT",
        url: "/api/settings/llm-gateway",
        payload: {
          mode: "prefer",
          mappings: [{ provider: "mock", model: "mock-v1", omnirouteModel: "gemini-2.5-flash" }],
        },
      });
      expect(saved.statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url: "/api/settings/llm-gateway" })).json()).toEqual({
        mode: "prefer",
        mappings: [{ provider: "mock", model: "mock-v1", omnirouteModel: "gemini-2.5-flash" }],
      });

      registry.omnirouteCatalog.invalidate();
      const refreshed = await app.inject({ method: "POST", url: "/api/llm/providers/omniroute/catalog/refresh" });
      expect(refreshed.statusCode).toBe(200);
      expect(refreshed.json().models.map((model: { id: string }) => model.id)).toEqual([
        "gemini-2.5-flash",
        "cc/claude-sonnet",
      ]);
    } finally {
      await app.close();
      sqlite.close();
    }
  });
});
