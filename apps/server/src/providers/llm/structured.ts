import type { FastifyBaseLogger } from "fastify";
import type { z } from "zod";
import type { LlmCallUsage, LlmTaskId } from "@vg/shared";
import type { LlmProviderRegistry, ResolvedLlmRoute } from "./registry.js";
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
  repairAttempts?: 0 | 1 | 2;
  signal: AbortSignal;
  cache?: LlmCache;
  cacheKeyExtra?: string;
  logger?: FastifyBaseLogger;
  task?: LlmTaskId;
} ): Promise<{
  value: T;
  usage: { llmCalls: number; inputTokens: number; outputTokens: number; tokensUnknown?: boolean; calls: LlmCallUsage[] };
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
      usage: {
        llmCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
        calls: [{
          task: input.task ?? "unknown",
          provider: input.provider.id,
          model: input.model,
          inputTokens: 0,
          outputTokens: 0,
          cached: true,
          fallback: false,
          ok: true,
        }],
      },
      provider: input.provider.id,
      model: input.model,
      cached: true,
    };
  }

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let calls = 0;
  let tokensUnknown = false;
  const callDetails: LlmCallUsage[] = [];
  const usage = () => ({
    llmCalls: calls,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    ...(tokensUnknown ? { tokensUnknown: true } : {}),
    calls: [...callDetails],
  });
  const maxOutputTokens = Math.min(input.maxOutputTokens, input.provider.limits?.maxOutputTokens ?? Number.POSITIVE_INFINITY);
  let response;
  try {
    response = await input.provider.generate({
      schemaName: input.schemaName,
      model: input.model,
      system: input.system,
      messages: [{ role: "user", content: input.prompt }],
      maxOutputTokens,
      json: true,
    }, input.signal);
  } catch (error) {
    if (input.signal.aborted || isAbortError(error)) throw error;
    const errorUsage = error instanceof LlmError ? error.usage : undefined;
    callDetails.push({
      task: input.task ?? "unknown",
      provider: input.provider.id,
      model: input.model,
      inputTokens: errorUsage?.inputTokens ?? 0,
      outputTokens: errorUsage?.outputTokens ?? 0,
      ...(input.provider.id === "copilot-cli" && attemptedCalls(error) ? { premiumRequests: 1 } : {}),
      cached: false,
      fallback: false,
      ok: false,
    });
    throw withUsage(error, { ...usage(), llmCalls: calls + attemptedCalls(error) }, input.provider.id === "copilot-cli");
  }
  calls += 1;
  totalInputTokens += response.usage.inputTokens;
  totalOutputTokens += response.usage.outputTokens;
  tokensUnknown ||= response.usage.tokensUnknown === true;
  callDetails.push({
    task: input.task ?? "unknown",
    provider: input.provider.id,
    model: input.model,
    inputTokens: response.usage.inputTokens,
    outputTokens: response.usage.outputTokens,
    ...(input.provider.id === "copilot-cli" ? { premiumRequests: 1 } : {}),
    cached: false,
    fallback: false,
    ok: true,
  });

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
  const repairAttempts = input.repairAttempts ?? 1;
  let repairs = 0;
  while (!validation.success && repairs < repairAttempts) {
    try {
      response = await input.provider.generate({
        schemaName: input.schemaName,
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
      if (input.signal.aborted || isAbortError(error)) throw error;
      const errorUsage = error instanceof LlmError ? error.usage : undefined;
      callDetails.push({
        task: input.task ?? "unknown",
        provider: input.provider.id,
        model: input.model,
        inputTokens: errorUsage?.inputTokens ?? 0,
        outputTokens: errorUsage?.outputTokens ?? 0,
        ...(input.provider.id === "copilot-cli" && attemptedCalls(error) ? { premiumRequests: 1 } : {}),
        cached: false,
        fallback: false,
        ok: false,
      });
      throw withUsage(error, { ...usage(), llmCalls: calls + attemptedCalls(error) }, input.provider.id === "copilot-cli");
    }
    calls += 1;
    repairs += 1;
    totalInputTokens += response.usage.inputTokens;
    totalOutputTokens += response.usage.outputTokens;
    tokensUnknown ||= response.usage.tokensUnknown === true;
    callDetails.push({
      task: input.task ?? "unknown",
      provider: input.provider.id,
      model: input.model,
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
      ...(input.provider.id === "copilot-cli" ? { premiumRequests: 1 } : {}),
      cached: false,
      fallback: false,
      ok: true,
    });
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
    input.logger?.warn({
      preview: rawText.slice(0, 240),
      schema: input.schemaName,
      issues: validation.success ? [] : validation.issues.slice(0, 15),
    }, "LLM output failed structured validation");
    const message = input.task === "sceneQueries" || input.task === "visualAltQueries" || input.task === "visualRerank"
      ? "The LLM response did not match the required output format. Bỏ qua bước AI, giữ kết quả bằng code."
      : "The LLM response did not match the required output format.";
    throw new LlmError(message, "LLM_INVALID_OUTPUT", false, undefined, usage());
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

export async function generateRoutedStructured<T>(input: {
  registry: LlmProviderRegistry;
  route: ResolvedLlmRoute;
  task: LlmTaskId;
} & Omit<Parameters<typeof generateStructured<T>>[0], "provider" | "model" | "task">): Promise<Awaited<ReturnType<typeof generateStructured<T>>>> {
  const { registry, route, task, ...request } = input;
  const fallbackAttempt = async (
    firstCalls: LlmCallUsage[],
    firstUsage: { llmCalls: number; inputTokens: number; outputTokens: number; tokensUnknown?: boolean },
  ) => {
    if (!route.fallback) throw new LlmError("No fallback route is configured.", "LLM_NOT_CONFIGURED", false);
    const fallback = route.failedRoute
      ? { provider: route.provider, model: route.model }
      : registry.resolveFallback(route.fallback);
    try {
      const generated = await generateStructured({
        ...request,
        provider: fallback.provider,
        model: fallback.model,
        task,
        maxOutputTokens: route.maxOutputTokens ?? request.maxOutputTokens,
      });
      return {
        ...generated,
        usage: {
          ...generated.usage,
          llmCalls: firstUsage.llmCalls + generated.usage.llmCalls,
          inputTokens: firstUsage.inputTokens + generated.usage.inputTokens,
          outputTokens: firstUsage.outputTokens + generated.usage.outputTokens,
          ...((firstUsage.tokensUnknown || generated.usage.tokensUnknown) ? { tokensUnknown: true } : {}),
          calls: [
            ...firstCalls,
            ...generated.usage.calls.map((call) => ({ ...call, fallback: true })),
          ],
        },
      };
    } catch (error) {
      if (!(error instanceof LlmError)) throw error;
      const fallbackUsage = error.usage;
      throw new LlmError(error.message, error.code, error.retryable, error.status, {
        llmCalls: firstUsage.llmCalls + (fallbackUsage?.llmCalls ?? 0),
        inputTokens: firstUsage.inputTokens + (fallbackUsage?.inputTokens ?? 0),
        outputTokens: firstUsage.outputTokens + (fallbackUsage?.outputTokens ?? 0),
        ...(firstUsage.tokensUnknown || fallbackUsage?.tokensUnknown ? { tokensUnknown: true } : {}),
        calls: [
          ...firstCalls,
          ...(fallbackUsage?.calls ?? []).map((call) => ({ ...call, fallback: true })),
        ],
      });
    }
  };

  if (route.failedRoute) {
    return fallbackAttempt([{
      task,
      provider: route.failedRoute.provider,
      model: route.failedRoute.model,
      inputTokens: 0,
      outputTokens: 0,
      cached: false,
      fallback: false,
      ok: false,
    }], { llmCalls: 0, inputTokens: 0, outputTokens: 0 });
  }

  try {
    return await generateStructured({
      ...request,
      provider: route.provider,
      model: route.model,
      maxOutputTokens: route.maxOutputTokens ?? request.maxOutputTokens,
      task,
    });
  } catch (error) {
    if (!(error instanceof LlmError) || !shouldFallback(error) || !route.fallback) throw error;
    return fallbackAttempt(
      error.usage?.calls ?? [],
      error.usage ?? { llmCalls: 0, inputTokens: 0, outputTokens: 0 },
    );
  }
}

function shouldFallback(error: LlmError): boolean {
  return error.code !== "LLM_INVALID_OUTPUT";
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

// Errors raised before a request reaches the provider (missing CLI, nothing configured) spend no call.
const NOT_SENT_CODES = new Set(["LLM_NOT_CONFIGURED", "LLM_LIMIT_TOO_SMALL"]);

function attemptedCalls(error: unknown): number {
  return error instanceof LlmError && NOT_SENT_CODES.has(error.code) ? 0 : 1;
}

function withUsage(
  error: unknown,
  usage: { llmCalls: number; inputTokens: number; outputTokens: number; tokensUnknown?: boolean; calls?: LlmCallUsage[] },
  tokensUnknown = false,
): LlmError {
  if (error instanceof LlmError) {
    const unknownTokens = tokensUnknown || usage.tokensUnknown === true || error.usage?.tokensUnknown === true;
    return new LlmError(error.message, error.code, error.retryable, error.status, {
      llmCalls: Math.max(usage.llmCalls, error.usage?.llmCalls ?? 0),
      inputTokens: usage.inputTokens + (error.usage?.inputTokens ?? 0),
      outputTokens: usage.outputTokens + (error.usage?.outputTokens ?? 0),
      ...(unknownTokens ? { tokensUnknown: true } : {}),
      ...((usage.calls || error.usage?.calls) ? {
        calls: [...(usage.calls ?? []), ...(error.usage?.calls ?? [])],
      } : {}),
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
