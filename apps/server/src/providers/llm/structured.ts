import type { FastifyBaseLogger } from "fastify";
import type { z } from "zod";
import { LlmCache, createLlmCacheKey } from "./cache.js";
import type { LlmProvider } from "./types.js";
import { LlmError } from "./types.js";

export async function generateStructured<T>(input: {
  provider: LlmProvider;
  model: string;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  schemaName: string;
  schemaVersion: string;
  maxOutputTokens: number;
  signal: AbortSignal;
  cache?: LlmCache;
  cacheKeyExtra?: string;
  logger?: FastifyBaseLogger;
}): Promise<{
  value: T;
  usage: { llmCalls: number; inputTokens: number; outputTokens: number; tokensUnknown?: boolean };
  provider: string;
  model: string;
  cached: boolean;
}> {
  const key = createLlmCacheKey({
    provider: input.provider.id,
    model: input.model,
    system: input.system,
    prompt: input.prompt,
    schemaName: input.schemaName,
    schemaVersion: input.schemaVersion,
    cacheKeyExtra: input.cacheKeyExtra,
  });
  const cached = input.cache?.get(key);
  if (cached) {
    const parsed = extractJson(cached.responseText);
    const result = input.schema.safeParse(parsed);
    if (!result.success) {
      throw new LlmError("Cached LLM output no longer matches its schema", "LLM_INVALID_OUTPUT", false);
    }
    return {
      value: result.data,
      usage: { llmCalls: 0, inputTokens: 0, outputTokens: 0 },
      provider: input.provider.id,
      model: input.model,
      cached: true,
    };
  }

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let calls = 0;
  let tokensUnknown = false;
  const usage = () => ({
    llmCalls: calls,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    ...(tokensUnknown ? { tokensUnknown: true } : {}),
  });
  const maxOutputTokens = Math.min(input.maxOutputTokens, input.provider.limits?.maxOutputTokens ?? Number.POSITIVE_INFINITY);
  let response;
  try {
    response = await input.provider.generate({
      model: input.model,
      system: input.system,
      messages: [{ role: "user", content: input.prompt }],
      maxOutputTokens,
      json: true,
    }, input.signal);
  } catch (error) {
    throw withUsage(error, { ...usage(), llmCalls: calls + 1 }, input.provider.id === "copilot-cli");
  }
  calls += 1;
  totalInputTokens += response.usage.inputTokens;
  totalOutputTokens += response.usage.outputTokens;
  tokensUnknown ||= response.usage.tokensUnknown === true;

  if (response.finishReason === "length") {
    throw new LlmError(
      "LLM output was truncated by the provider limit. Try a shorter target duration or a higher output-token limit.",
      "LLM_OUTPUT_TRUNCATED",
      false,
      undefined,
      usage(),
    );
  }

  let rawText = response.text;
  let validation = validateOutput(input.schema, rawText);
  if (!validation.success) {
    try {
      response = await input.provider.generate({
        model: input.model,
        system: input.system,
        messages: [
          { role: "user", content: input.prompt },
          { role: "assistant", content: rawText },
          { role: "user", content: `Correct the JSON to satisfy these validation issues. Return only corrected JSON:\n${JSON.stringify(validation.issues)}` },
        ],
        maxOutputTokens,
        json: true,
      }, input.signal);
    } catch (error) {
      throw withUsage(error, { ...usage(), llmCalls: calls + 1 }, input.provider.id === "copilot-cli");
    }
    calls += 1;
    totalInputTokens += response.usage.inputTokens;
    totalOutputTokens += response.usage.outputTokens;
    tokensUnknown ||= response.usage.tokensUnknown === true;
    if (response.finishReason === "length") {
      throw new LlmError(
        "LLM output was truncated by the provider limit. Try a shorter target duration or a higher output-token limit.",
        "LLM_OUTPUT_TRUNCATED",
        false,
        undefined,
        usage(),
      );
    }
    rawText = response.text;
    validation = validateOutput(input.schema, rawText);
  }
  if (!validation.success) {
    input.logger?.warn({ preview: rawText.slice(0, 240), schema: input.schemaName }, "LLM output failed structured validation");
    throw new LlmError("The LLM response did not match the required output format.", "LLM_INVALID_OUTPUT", false, undefined, usage());
  }

  input.cache?.put(key, input.provider.id, input.model, rawText);
  return {
    value: validation.data,
    usage: usage(),
    provider: input.provider.id,
    model: input.model,
    cached: false,
  };
}

function withUsage(
  error: unknown,
  usage: { llmCalls: number; inputTokens: number; outputTokens: number; tokensUnknown?: boolean },
  tokensUnknown = false,
): LlmError {
  if (error instanceof LlmError) {
    const unknownTokens = tokensUnknown || usage.tokensUnknown === true || error.usage?.tokensUnknown === true;
    return new LlmError(error.message, error.code, error.retryable, error.status, {
      llmCalls: Math.max(usage.llmCalls, error.usage?.llmCalls ?? 0),
      inputTokens: usage.inputTokens + (error.usage?.inputTokens ?? 0),
      outputTokens: usage.outputTokens + (error.usage?.outputTokens ?? 0),
      ...(unknownTokens ? { tokensUnknown: true } : {}),
    });
  }
  return new LlmError(
    error instanceof Error ? error.message : String(error),
    "LLM_UNAVAILABLE",
    true,
    undefined,
    { ...usage, ...(tokensUnknown ? { tokensUnknown: true } : {}) },
  );
}

function validateOutput<T>(schema: z.ZodType<T>, text: string):
  | { success: true; data: T }
  | { success: false; issues: { path: string; message: string }[] } {
  let value: unknown;
  try {
    value = extractJson(text);
  } catch {
    return { success: false, issues: [{ path: "", message: "Output must contain one valid JSON object." }] };
  }
  const parsed = schema.safeParse(value);
  return parsed.success
    ? { success: true, data: parsed.data }
    : {
      success: false,
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.map(String).join("."),
        message: issue.message,
      })),
    };
}

function extractJson(text: string): unknown {
  const withoutFence = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");
  if (start < 0 || end < start) throw new SyntaxError("LLM response did not contain a JSON object");
  try {
    return JSON.parse(withoutFence.slice(start, end + 1)) as unknown;
  } catch {
    throw new SyntaxError("LLM response contained malformed JSON");
  }
}
