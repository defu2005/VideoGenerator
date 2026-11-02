import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { LlmCache } from "../src/providers/llm/cache.js";
import { generateStructured } from "../src/providers/llm/structured.js";
import type { LlmProvider } from "../src/providers/llm/types.js";

const schema = z.object({ answer: z.string().min(1) });
const controller = () => new AbortController().signal;

function cacheDb(): { db: Database.Database; cache: LlmCache } {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE llm_cache (key TEXT PRIMARY KEY, provider TEXT NOT NULL, model TEXT NOT NULL, response_text TEXT NOT NULL, created_at TEXT NOT NULL)");
  return { db, cache: new LlmCache(db, true) };
}

function providerFrom(responses: string[]): LlmProvider {
  return {
    id: "mock",
    label: "Mock",
    defaultModel: "mock-v1",
    generate: vi.fn(async () => ({
      text: responses.shift() ?? "{}",
      usage: { inputTokens: 3, outputTokens: 5 },
      model: "mock-v1",
      provider: "mock",
      finishReason: "stop" as const,
    })),
  };
}

describe("generateStructured", () => {
  it("strips code fences and leading text before schema validation", async () => {
    const { db, cache } = cacheDb();
    const provider = providerFrom(["Here is the result:\n```json\n{\"answer\":\"ok\"}\n```"]);
    const result = await generateStructured({
      provider, model: "mock-v1", system: "system", prompt: "prompt", schema,
      schemaName: "Example", schemaVersion: "1", maxOutputTokens: 100, signal: controller(), cache,
    });
    expect(result.value).toEqual({ answer: "ok" });
    expect(result.usage.llmCalls).toBe(1);
    db.close();
  });

  it("makes one repair call and caches the valid response", async () => {
    const { db, cache } = cacheDb();
    const provider = providerFrom(["not json", "{\"answer\":\"repaired\"}"]);
    const first = await generateStructured({
      provider, model: "mock-v1", system: "system", prompt: "prompt", schema,
      schemaName: "Example", schemaVersion: "1", maxOutputTokens: 100, signal: controller(), cache,
    });
    expect(first.value.answer).toBe("repaired");
    expect(first.usage.llmCalls).toBe(2);
    const second = await generateStructured({
      provider, model: "mock-v1", system: "system", prompt: "prompt", schema,
      schemaName: "Example", schemaVersion: "1", maxOutputTokens: 100, signal: controller(), cache,
    });
    expect(second.cached).toBe(true);
    expect(second.usage).toEqual({ llmCalls: 0, inputTokens: 0, outputTokens: 0 });
    db.close();
  });

  it("fails after the single repair attempt without exposing the bad response in the error", async () => {
    const { db, cache } = cacheDb();
    const provider = providerFrom(["bad first", "{\"answer\":3}"]);
    const result = await generateStructured({
      provider, model: "mock-v1", system: "system", prompt: "prompt", schema,
      schemaName: "Example", schemaVersion: "1", maxOutputTokens: 100, signal: controller(), cache,
    }).catch((error: unknown) => error);
    expect(result).toMatchObject({
      code: "LLM_INVALID_OUTPUT",
      retryable: false,
      usage: { llmCalls: 2, inputTokens: 6, outputTokens: 10 },
    });
    expect(provider.generate).toHaveBeenCalledTimes(2);
    db.close();
  });

  it("records the first response usage when the repair provider call fails", async () => {
    const { db, cache } = cacheDb();
    const provider = providerFrom(["invalid"]);
    vi.mocked(provider.generate)
      .mockImplementationOnce(async () => ({
        text: "invalid",
        usage: { inputTokens: 3, outputTokens: 5 },
        model: "mock-v1",
        provider: "mock",
        finishReason: "stop",
      }))
      .mockRejectedValueOnce(new Error("repair failed"));
    await expect(generateStructured({
      provider, model: "mock-v1", system: "system", prompt: "prompt", schema,
      schemaName: "Example", schemaVersion: "1", maxOutputTokens: 100, signal: controller(), cache,
    })).rejects.toMatchObject({
      code: "LLM_UNAVAILABLE",
      usage: { llmCalls: 2, inputTokens: 3, outputTokens: 5 },
    });
    db.close();
  });

  it("clamps each provider request to its declared output-token limit", async () => {
    const { db, cache } = cacheDb();
    const provider = providerFrom(["{\"answer\":\"ok\"}"]);
    provider.limits = { maxOutputTokens: 7 };
    await generateStructured({
      provider, model: "mock-v1", system: "system", prompt: "prompt", schema,
      schemaName: "Example", schemaVersion: "1", maxOutputTokens: 100, signal: controller(), cache,
    });
    expect(provider.generate).toHaveBeenCalledWith(
      expect.objectContaining({ maxOutputTokens: 7 }),
      expect.anything(),
    );
    db.close();
  });

  it("skips repair for truncated output and attaches its usage", async () => {
    const { db, cache } = cacheDb();
    const provider = providerFrom(["not complete"]);
    vi.mocked(provider.generate).mockResolvedValueOnce({
      text: "not complete",
      usage: { inputTokens: 3, outputTokens: 5 },
      model: "mock-v1",
      provider: "mock",
      finishReason: "length",
    });
    await expect(generateStructured({
      provider, model: "mock-v1", system: "system", prompt: "prompt", schema,
      schemaName: "Example", schemaVersion: "1", maxOutputTokens: 100, signal: controller(), cache,
    })).rejects.toMatchObject({
      code: "LLM_OUTPUT_TRUNCATED",
      retryable: false,
      usage: { llmCalls: 1, inputTokens: 3, outputTokens: 5 },
    });
    expect(provider.generate).toHaveBeenCalledTimes(1);
    db.close();
  });
});
