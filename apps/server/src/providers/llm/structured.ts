import type { FastifyBaseLogger } from "fastify";
import { join } from "node:path";
import { z } from "zod";
import type { LlmCallUsage, LlmGatewaySettings, LlmTaskId } from "@vg/shared";
import type { LlmProviderRegistry, ResolvedLlmRoute } from "./registry.js";
import { LlmCache, createLlmCacheKey } from "./cache.js";
import type { LlmImageAttachment, LlmProvider } from "./types.js";
import { LlmError } from "./types.js";
import { prepareVisionImages, visionCacheKeyExtra } from "./visionImages.js";
import {
  envOmnirouteVision,
  providerWithCapabilities,
  shouldGatewayFallback,
} from "./omnirouteCatalog.js";

const gatewayFallbackLogged = new WeakSet<AbortSignal>();

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
  images?: LlmImageAttachment[];
  /** Project data dir used to cache resized vision JPEGs. */
  visionCacheDir?: string;
} ): Promise<{
  value: T;
  usage: { llmCalls: number; inputTokens: number; outputTokens: number; tokensUnknown?: boolean; calls: LlmCallUsage[] };
  provider: string;
  model: string;
  cached: boolean;
}> {
  assertVisionCapable(input.provider, input.images);
  const preparedImages = await prepareVisionImages(
    input.images,
    input.visionCacheDir ?? join(process.cwd(), ".vision-cache"),
    input.signal,
  );
  const imageKey = visionCacheKeyExtra(preparedImages);
  const key = createLlmCacheKey({
    provider: input.provider.id,
    model: input.model,
    system: input.system,
    prompt: input.prompt,
    schemaName: input.schemaName,
    schemaVersion: input.schemaVersion,
    cacheKeyExtra: [input.cacheKeyExtra ?? "", imageKey].filter(Boolean).join("|"),
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

  // Only agy uses this. Some zod schemas (transforms) cannot be converted; then send none.
  let jsonSchema: Record<string, unknown> | undefined;
  try {
    jsonSchema = z.toJSONSchema(input.schema) as Record<string, unknown>;
  } catch {
    jsonSchema = undefined;
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
  const requestImages = preparedImages.map((image) => ({ path: image.path, label: image.label }));
  let response;
  try {
    response = await input.provider.generate({
      schemaName: input.schemaName,
      jsonSchema,
      model: input.model,
      system: input.system,
      messages: [{ role: "user", content: input.prompt }],
      maxOutputTokens,
      json: true,
      ...(requestImages.length ? { images: requestImages } : {}),
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
        jsonSchema,
        model: input.model,
        system: input.system,
        messages: [
          { role: "user", content: input.prompt },
          { role: "assistant", content: rawText },
          { role: "user", content: `Correct the JSON to satisfy these validation issues. Return only corrected JSON:\n${JSON.stringify(validation.issues)}` },
        ],
        maxOutputTokens,
        json: true,
        ...(requestImages.length ? { images: requestImages } : {}),
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
  gatewaySettings?: LlmGatewaySettings;
} & Omit<Parameters<typeof generateStructured<T>>[0], "provider" | "model" | "task">): Promise<Awaited<ReturnType<typeof generateStructured<T>>>> {
  const { registry, route: originalRoute, task, gatewaySettings, ...request } = input;
  const settings = gatewaySettings ?? registry.getGatewaySettings();
  const applied = await applyOmnirouteGateway(registry, originalRoute, settings, task);
  const route = applied.route;
  const gatewayDirect = applied.directFallback;

  const mergeFallbackUsage = (
    firstCalls: LlmCallUsage[],
    firstUsage: { llmCalls: number; inputTokens: number; outputTokens: number; tokensUnknown?: boolean },
    generated: Awaited<ReturnType<typeof generateStructured<T>>>,
  ) => ({
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
  });

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
      return mergeFallbackUsage(firstCalls, firstUsage, generated);
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
    if (!(error instanceof LlmError)) throw error;

    if (gatewayDirect && shouldGatewayFallback(error)) {
      logGatewayFallbackOnce(request.signal, request.logger, {
        task,
        from: `${route.provider}/${route.model}`,
        to: `${gatewayDirect.provider.id}/${gatewayDirect.model}`,
        code: error.code,
        status: error.status,
      });
      try {
        const generated = await generateStructured({
          ...request,
          provider: gatewayDirect.provider,
          model: gatewayDirect.model,
          task,
          maxOutputTokens: gatewayDirect.maxOutputTokens ?? request.maxOutputTokens,
        });
        return mergeFallbackUsage(
          error.usage?.calls ?? [],
          error.usage ?? { llmCalls: 0, inputTokens: 0, outputTokens: 0 },
          generated,
        );
      } catch (fallbackError) {
        if (!(fallbackError instanceof LlmError)) throw fallbackError;
        const firstUsage = error.usage ?? { llmCalls: 0, inputTokens: 0, outputTokens: 0 };
        const fallbackUsage = fallbackError.usage;
        throw new LlmError(fallbackError.message, fallbackError.code, fallbackError.retryable, fallbackError.status, {
          llmCalls: firstUsage.llmCalls + (fallbackUsage?.llmCalls ?? 0),
          inputTokens: firstUsage.inputTokens + (fallbackUsage?.inputTokens ?? 0),
          outputTokens: firstUsage.outputTokens + (fallbackUsage?.outputTokens ?? 0),
          ...(firstUsage.tokensUnknown || fallbackUsage?.tokensUnknown ? { tokensUnknown: true } : {}),
          calls: [
            ...(error.usage?.calls ?? []),
            ...(fallbackUsage?.calls ?? []).map((call) => ({ ...call, fallback: true })),
          ],
        });
      }
    }

    if (!shouldFallback(error) || !route.fallback) throw error;
    return fallbackAttempt(
      error.usage?.calls ?? [],
      error.usage ?? { llmCalls: 0, inputTokens: 0, outputTokens: 0 },
    );
  }
}

async function applyOmnirouteGateway(
  registry: LlmProviderRegistry,
  route: ResolvedLlmRoute,
  settings: LlmGatewaySettings,
  task: LlmTaskId,
): Promise<{ route: ResolvedLlmRoute; directFallback?: ResolvedLlmRoute }> {
  if (settings.mode === "off" || route.provider.id === "omniroute") {
    return { route };
  }

  const target = await registry.omnirouteCatalog.resolveGatewayTarget(
    route.provider.id,
    route.model,
    settings,
  );

  if (!target) {
    if (settings.mode === "only") {
      throw new LlmError(
        `Gateway OmniRoute (only): tác vụ "${task}" dùng ${route.provider.id}/${route.model || "(không có model)"} nhưng OmniRoute không có model tương ứng. Thêm mapping hoặc đổi model.`,
        "LLM_NOT_CONFIGURED",
        false,
      );
    }
    return { route };
  }

  const omni = registry.get("omniroute");
  if (!omni) {
    if (settings.mode === "only") {
      throw new LlmError(
        "Gateway OmniRoute (only): OmniRoute chưa được cấu hình. Đặt OMNIROUTE_API_KEY (hoặc OMNIROUTE_BASE_URL) trong .env.",
        "LLM_NOT_CONFIGURED",
        false,
      );
    }
    return { route };
  }

  const catalogVision = target.catalogModel?.vision;
  const capabilities = catalogVision === undefined
    ? (omni.capabilities ?? envOmnirouteVision())
    : catalogVision
      ? { vision: true, maxImagesPerCall: Math.max(1, omni.capabilities?.maxImagesPerCall ?? 10) }
      : { vision: false, maxImagesPerCall: 0 };
  const provider = providerWithCapabilities(omni, capabilities);

  const gatewayRoute: ResolvedLlmRoute = {
    provider,
    model: target.omnirouteModel,
    maxOutputTokens: route.maxOutputTokens,
    // prefer: the direct route is the fallback (directFallback below); only: no fallback at all.
    fallback: undefined,
    source: route.source,
  };

  return {
    route: gatewayRoute,
    directFallback: settings.mode === "prefer" ? route : undefined,
  };
}

function logGatewayFallbackOnce(
  signal: AbortSignal,
  logger: FastifyBaseLogger | undefined,
  details: { task: string; from: string; to: string; code: string; status?: number },
): void {
  if (gatewayFallbackLogged.has(signal)) return;
  gatewayFallbackLogged.add(signal);
  logger?.warn(details, "OmniRoute gateway unavailable; falling back to direct provider");
}

function shouldFallback(error: LlmError): boolean {
  return error.code !== "LLM_INVALID_OUTPUT";
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

// Errors raised before a request reaches the provider (missing CLI, nothing configured) spend no call.
const NOT_SENT_CODES = new Set(["LLM_NOT_CONFIGURED", "LLM_LIMIT_TOO_SMALL", "VISION_PROVIDER_REQUIRED", "FFMPEG_MISSING"]);

export function assertVisionCapable(provider: LlmProvider, images: LlmImageAttachment[] | undefined): void {
  if (!images?.length) return;
  if (!provider.capabilities?.vision) {
    throw new LlmError(
      `Provider "${provider.id}" cannot accept images. Chọn route vision ở Cài đặt → Mô hình AI (anthropic, gemini, claude-cli, copilot-cli, …).`,
      "VISION_PROVIDER_REQUIRED",
      false,
    );
  }
  if (images.length > provider.capabilities.maxImagesPerCall) {
    throw new LlmError(
      `Provider "${provider.id}" accepts at most ${provider.capabilities.maxImagesPerCall} images per call.`,
      "LLM_BAD_REQUEST",
      false,
    );
  }
}

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
    const balancedObject = firstBalancedJsonObject(withoutFence);
    if (balancedObject !== undefined) {
      try {
        return JSON.parse(balancedObject) as unknown;
      } catch {
        // The first balanced object is malformed; preserve the structured-output error.
      }
    }
    throw new SyntaxError("LLM response contained malformed JSON");
  }
}

function firstBalancedJsonObject(text: string): string | undefined {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === "\"") {
        inString = false;
      }
      continue;
    }
    if (character === "\"" && depth > 0) {
      inString = true;
    } else if (character === "{") {
      if (depth === 0) start = index;
      depth += 1;
    } else if (character === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return undefined;
}
