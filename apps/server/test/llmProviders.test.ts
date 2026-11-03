import { LlmProviderIdSchema } from "@vg/shared";
import Database from "better-sqlite3";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";
import { parseConfig } from "../src/lib/config.js";
import { AnthropicProvider } from "../src/providers/llm/anthropic.js";
import { GeminiProvider } from "../src/providers/llm/gemini.js";
import { OpenAiCompatibleProvider } from "../src/providers/llm/openaiCompatible.js";
import { classifyCopilotFailure } from "../src/providers/llm/copilotCli.js";
import { LlmProviderRegistry } from "../src/providers/llm/registry.js";
import { LlmError, type LlmRequest } from "../src/providers/llm/types.js";
import { getProviderMonthCalls, registerLlmRoutes } from "../src/api/llm.js";

const request: LlmRequest = {
  model: "unit-model",
  system: "system",
  messages: [{ role: "user", content: "prompt" }],
  maxOutputTokens: 200,
  temperature: 0.2,
  json: true,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

afterEach(() => vi.unstubAllGlobals());

describe("LLM provider adapters", () => {
  it("classifies Copilot CLI invalid-model output as a configuration error", () => {
    const error = classifyCopilotFailure('Error: model "x" is not supported');
    expect(error.code).toBe("LLM_NOT_CONFIGURED");
    expect(error.message).toBe("Model không hợp lệ cho Copilot CLI");
  });

  it("maps Anthropic requests and responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      model: "claude-test",
      content: [{ type: "text", text: "{\"ok\":true}" }],
      usage: { input_tokens: 7, output_tokens: 11 },
      stop_reason: "end_turn",
    }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new AnthropicProvider("secret", "claude-test", 1_000);
    const result = await provider.generate(request, new AbortController().signal);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(new Headers(init.headers).get("x-api-key")).toBe("secret");
    expect(new Headers(init.headers).get("anthropic-version")).toBe("2023-06-01");
    expect(JSON.parse(String(init.body))).toMatchObject({ model: "unit-model", max_tokens: 200, messages: request.messages });
    expect(result).toEqual({
      text: "{\"ok\":true}",
      usage: { inputTokens: 7, outputTokens: 11 },
      model: "claude-test",
      provider: "anthropic",
      finishReason: "stop",
    });
  });

  it("maps Gemini requests, JSON mode, text, and usage", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      candidates: [{ content: { parts: [{ text: "{\"ok\":true}" }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 13, candidatesTokenCount: 17 },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new GeminiProvider("secret", null, 1_000);
    const result = await provider.generate(request, new AbortController().signal);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("models/unit-model:generateContent?key=secret");
    expect(JSON.parse(String(init.body))).toMatchObject({
      generationConfig: { maxOutputTokens: 200, responseMimeType: "application/json" },
      contents: [{ role: "user", parts: [{ text: "prompt" }] }],
    });
    expect(result.usage).toEqual({ inputTokens: 13, outputTokens: 17 });
    expect(result.finishReason).toBe("stop");
  });

  it("maps OpenAI-compatible requests and responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      model: "chat-model",
      choices: [{ message: { content: "{\"ok\":true}" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 19, completion_tokens: 23 },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAiCompatibleProvider("openrouter", "OpenRouter", "https://example.test/v1/", "secret", null, 1_000);
    const result = await provider.generate(request, new AbortController().signal);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://example.test/v1/chat/completions");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer secret");
    expect(JSON.parse(String(init.body))).toMatchObject({
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: "system" }, { role: "user", content: "prompt" }],
    });
    expect(result.usage).toEqual({ inputTokens: 19, outputTokens: 23 });
    expect(result.finishReason).toBe("stop");
  });

  it("maps provider output-limit stop reasons", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({
      content: [{ type: "text", text: "{}" }],
      usage: { input_tokens: 2, output_tokens: 3 },
      stop_reason: "max_tokens",
    })).mockResolvedValueOnce(jsonResponse({
      choices: [{ message: { content: "{}" }, finish_reason: "length" }],
      usage: { prompt_tokens: 2, completion_tokens: 3 },
    })).mockResolvedValueOnce(jsonResponse({
      candidates: [{ content: { parts: [{ text: "{}" }] }, finishReason: "MAX_TOKENS" }],
      usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 3 },
    })));
    const anthropic = new AnthropicProvider("secret", "claude-test", 1_000);
    const openai = new OpenAiCompatibleProvider("openai", "OpenAI", "https://example.test/v1", "secret", null, 1_000);
    const gemini = new GeminiProvider("secret", null, 1_000);
    const signal = new AbortController().signal;
    expect((await anthropic.generate(request, signal)).finishReason).toBe("length");
    expect((await openai.generate(request, signal)).finishReason).toBe("length");
    expect((await gemini.generate(request, signal)).finishReason).toBe("length");
  });

  it.each([
    [401, "LLM_AUTH", false],
    [403, "LLM_AUTH", false],
    [429, "LLM_RATE_LIMIT", true],
    [500, "LLM_UNAVAILABLE", true],
    [400, "LLM_BAD_REQUEST", false],
  ] as const)("maps HTTP %s to %s", async (status, code, retryable) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, status)));
    const provider = new OpenAiCompatibleProvider("openai", "OpenAI", "https://example.test/v1", "secret", null, 1_000);
    await expect(provider.generate(request, new AbortController().signal)).rejects.toMatchObject({ code, retryable, status });
  });

  it("maps malformed JSON and network timeouts", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{", { status: 200 })));
    const provider = new OpenAiCompatibleProvider("openai", "OpenAI", "https://example.test/v1", "secret", null, 1_000);
    await expect(provider.generate(request, new AbortController().signal)).rejects.toMatchObject({ code: "LLM_UNAVAILABLE" });

    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    })));
    const timeoutProvider = new OpenAiCompatibleProvider("openai", "OpenAI", "https://example.test/v1", "secret", null, 5);
    await expect(timeoutProvider.generate(request, new AbortController().signal)).rejects.toMatchObject({
      code: "LLM_TIMEOUT",
      retryable: true,
    });
  });
});

describe("LLM registry", () => {
  it("lists every provider with configured flags and no secrets, and resolves project, stage, and environment choices", () => {
    const config = parseConfig({
      ANTHROPIC_API_KEY: "anthropic-secret",
      OPENAI_API_KEY: "openai-secret",
      OPENAI_MODEL: "openai-model",
      LLM_ENABLE_MOCK: "false",
      LLM_DEFAULT_PROVIDER: "anthropic",
      LLM_DEFAULT_MODEL: "global-model",
      LLM_SCRIPT_PROVIDER: "openai",
      LLM_SCRIPT_MODEL: "stage-model",
    });
    const registry = new LlmProviderRegistry(config);
    const listed = registry.list();
    expect(listed.map((provider) => provider.id)).toEqual(LlmProviderIdSchema.options);
    expect(listed.filter((provider) => provider.configured).map((provider) => provider.id)).toEqual(["anthropic", "openai", "ollama"]);
    expect(listed.find((provider) => provider.id === "gemini")).toMatchObject({ configured: false, hint: expect.stringContaining("GEMINI_API_KEY") });
    expect(JSON.stringify(registry.list())).not.toContain("secret");
    expect(registry.resolve(undefined, undefined, "script")).toMatchObject({ provider: { id: "openai" }, model: "stage-model" });
    expect(registry.resolve({ provider: "anthropic" }, { provider: "openai" }, "script"))
      .toMatchObject({ provider: { id: "anthropic" }, model: "stage-model" });
    expect(registry.resolve(undefined, { provider: "openai", model: "project-model" }, "research"))
      .toMatchObject({ provider: { id: "openai" }, model: "project-model" });
  });

  it("reports missing provider or model as non-retryable configuration errors", () => {
    const noProviders = new LlmProviderRegistry(parseConfig({ LLM_ENABLE_MOCK: "false" }));
    expect(() => noProviders.resolve(undefined, undefined, "research")).toThrowError(
      expect.objectContaining({ code: "LLM_NOT_CONFIGURED", retryable: false }),
    );
    expect(new LlmError("no model", "LLM_NOT_CONFIGURED", false).retryable).toBe(false);
  });

  it("marks Ollama unconfigured until a model can be resolved", () => {
    const noModel = new LlmProviderRegistry(parseConfig({ LLM_ENABLE_MOCK: "false" }));
    expect(noModel.list().find((provider) => provider.id === "ollama"))
      .toMatchObject({ configured: false, defaultModel: null, hint: "Set OLLAMA_MODEL" });
    const globalModel = new LlmProviderRegistry(parseConfig({
      LLM_ENABLE_MOCK: "false",
      LLM_DEFAULT_MODEL: "global-ollama",
    }));
    expect(globalModel.list().find((provider) => provider.id === "ollama")?.configured).toBe(true);
  });

  it("lists the enabled Claude CLI provider with its binary availability", () => {
    const disabled = new LlmProviderRegistry(parseConfig({
      LLM_ENABLE_MOCK: "false",
      CLAUDE_CLI_ENABLED: "false",
    }));
    expect(disabled.list().find((provider) => provider.id === "claude-cli")).toMatchObject({ configured: false });

    const missing = new LlmProviderRegistry(parseConfig({
      LLM_ENABLE_MOCK: "false",
      CLAUDE_CLI_ENABLED: "true",
      CLAUDE_CLI_PATH: "video-agent-claude-command-not-installed",
    }));
    expect(missing.list()).toContainEqual({
      id: "claude-cli",
      label: "Claude (subscription via Claude Code)",
      configured: false,
      defaultModel: null,
      hint: "Install Claude Code CLI and run `claude` once to log in",
    });
    const installed = new LlmProviderRegistry(parseConfig({
      LLM_ENABLE_MOCK: "false",
      CLAUDE_CLI_ENABLED: "true",
      CLAUDE_CLI_PATH: process.execPath,
      CLAUDE_CLI_MODEL: "sonnet",
    }));
    expect(installed.list().find((provider) => provider.id === "claude-cli"))
      .toMatchObject({ configured: true, defaultModel: "sonnet" });
    expect(installed.resolve({ provider: "claude-cli" }, undefined, "script").model).toBe("sonnet");
  });

  it("lists optional provider limits and the Copilot CLI without requiring a configured model", () => {
    const missingCli = new LlmProviderRegistry(parseConfig({
      LLM_ENABLE_MOCK: "false",
      COPILOT_CLI_ENABLED: "true",
      COPILOT_CLI_PATH: "video-agent-copilot-command-not-installed",
    }));
    expect(missingCli.list().find((provider) => provider.id === "copilot-cli"))
      .toMatchObject({
        configured: false,
        hint: "Install GitHub Copilot CLI and sign in once",
      });

    const registry = new LlmProviderRegistry(parseConfig({
      LLM_ENABLE_MOCK: "false",
      OPENAI_API_KEY: "openai-secret",
      OPENAI_MODEL: "openai-model",
      OPENAI_MAX_INPUT_TOKENS: "8000",
      OPENAI_MAX_OUTPUT_TOKENS: "4000",
      COPILOT_CLI_ENABLED: "true",
      COPILOT_CLI_PATH: process.execPath,
    }));
    expect(registry.list().find((provider) => provider.id === "openai")?.limits)
      .toEqual({ maxInputTokens: 8000, maxOutputTokens: 4000 });
    expect(registry.list().find((provider) => provider.id === "copilot-cli"))
      .toMatchObject({ configured: true, defaultModel: null });
    expect(registry.resolve({ provider: "copilot-cli" }, undefined, "research").model).toBe("");
  });

  it("reports current-month provider calls without imposing a call cap", async () => {
    const sqlite = new Database(":memory:");
    sqlite.exec("CREATE TABLE jobs (created_at TEXT NOT NULL, usage TEXT)");
    const now = new Date();
    const currentMonth = new Date(now.getFullYear(), now.getMonth(), 2).toISOString();
    const previousMonth = new Date(now.getFullYear(), now.getMonth(), 0).toISOString();
    const usage = JSON.stringify({
      llmCalls: 1,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      provider: "copilot-cli",
      model: "auto",
      tokensUnknown: true,
    });
    sqlite.prepare("INSERT INTO jobs (created_at, usage) VALUES (?, ?), (?, ?)")
      .run(currentMonth, usage, currentMonth, usage);
    sqlite.prepare("INSERT INTO jobs (created_at, usage) VALUES (?, ?)")
      .run(previousMonth, usage);

    const registry = new LlmProviderRegistry(parseConfig({
      LLM_ENABLE_MOCK: "false",
      COPILOT_CLI_ENABLED: "true",
      COPILOT_CLI_PATH: process.execPath,
    }));
    const app = Fastify().withTypeProvider<ZodTypeProvider>();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    registerLlmRoutes(app, registry, sqlite);
    try {
      const response = await app.inject({ method: "GET", url: "/api/llm/providers" });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "copilot-cli", usage: { monthCalls: 2 } }),
      ]));
      expect(() => registry.resolve({ provider: "copilot-cli" }, undefined, "script")).not.toThrow();
    } finally {
      await app.close();
      sqlite.close();
    }
  });

  it("counts failed provider attempts and excludes cached records from per-provider usage", () => {
    const sqlite = new Database(":memory:");
    sqlite.exec("CREATE TABLE jobs (created_at TEXT NOT NULL, usage TEXT)");
    const createdAt = new Date().toISOString();
    sqlite.prepare("INSERT INTO jobs (created_at, usage) VALUES (?, ?)").run(createdAt, JSON.stringify({
      llmCalls: 1,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      calls: [
        { task: "research", provider: "mock", model: "m1", inputTokens: 4, outputTokens: 5, cached: false, fallback: false, ok: true },
        { task: "research", provider: "openai", model: "m2", inputTokens: 0, outputTokens: 0, cached: false, fallback: false, ok: false },
        { task: "script", provider: "mock", model: "m1", inputTokens: 0, outputTokens: 0, cached: true, fallback: false, ok: true },
      ],
    }));

    expect(getProviderMonthCalls(sqlite)).toEqual(new Map([["mock", 1], ["openai", 1]]));
    sqlite.close();
  });

  it("validates app routing settings and serves cached model suggestions via mocked fetch", async () => {
    const sqlite = new Database(":memory:");
    sqlite.exec("CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)");
    const registry = new LlmProviderRegistry(parseConfig({
      LLM_ENABLE_MOCK: "true",
      OPENAI_API_KEY: "openai-secret",
      OPENAI_BASE_URL: "https://models.test/v1",
      OPENAI_MODEL: "configured-model",
    }));
    const fetchImpl = vi.fn(async () => jsonResponse({ data: [{ id: "remote-model" }] })) as typeof fetch;
    const app = Fastify().withTypeProvider<ZodTypeProvider>();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.setErrorHandler((error, _request, reply) => {
      reply.status(error.statusCode ?? 500).send({
        error: {
          code: "INVALID_LLM_PROVIDER",
          message: error.message,
          details: {},
        },
      });
    });
    registerLlmRoutes(app, registry, sqlite, undefined, fetchImpl);
    try {
      const saved = await app.inject({
        method: "PUT",
        url: "/api/settings/llm-routing",
        payload: { tasks: { research: { provider: "mock", model: "research-model" } } },
      });
      expect(saved.statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url: "/api/settings/llm-routing" })).json())
        .toEqual({ tasks: { research: { provider: "mock", model: "research-model" } } });

      const invalid = await app.inject({
        method: "PUT",
        url: "/api/settings/llm-routing",
        payload: { tasks: { research: { provider: "not-supported" } } },
      });
      expect(invalid.statusCode).toBe(400);

      const firstModels = await app.inject({ method: "GET", url: "/api/llm/providers/openai/models" });
      const secondModels = await app.inject({ method: "GET", url: "/api/llm/providers/openai/models" });
      expect(firstModels.statusCode).toBe(200);
      expect(firstModels.json().models).toEqual(expect.arrayContaining(["remote-model", "configured-model"]));
      expect(secondModels.json()).toEqual(firstModels.json());
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
      sqlite.close();
    }
  });

  it("returns static model suggestions when the remote list request times out", async () => {
    vi.useFakeTimers();
    try {
      const registry = new LlmProviderRegistry(parseConfig({
        LLM_ENABLE_MOCK: "false",
        OPENAI_API_KEY: "openai-secret",
        OPENAI_BASE_URL: "https://models.test/v1",
        OPENAI_MODEL: "configured-model",
      }));
      const fetchImpl = vi.fn((_url: string | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      })) as typeof fetch;
      const pending = registry.suggestModels("openai", fetchImpl);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(await pending).toEqual(expect.arrayContaining(["gpt-5", "configured-model"]));
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
