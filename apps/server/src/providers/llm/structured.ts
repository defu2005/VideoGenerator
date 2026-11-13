import { buildKnowledgeBlock, saveKnowledgeUse, TASK_KINDS } from "../../retrieval/context.js";
import { autonomyBudgetStatus, currentAutonomyBudget, hasAutonomySpendLimit, holdAutonomyUsd, runWithAutonomyBudget } from "../../operator/autonomyBudget.js";
import { effectiveAutonomy } from "../../operator/autonomy.js";
import { gatewayBypassOn } from "../../operator/playbooks.js";
import { UsageService } from "../../services/usageService.js";
import type { Project } from "@vg/shared";
import type { FastifyBaseLogger } from "fastify";
import { join } from "node:path";
import { z } from "zod";
import {
  fallbackChainOf,
  formatHourMinute,
  orderChainForBudget,
  preferCheapestQualified,
  type LlmCallUsage,
  type LlmGatewaySettings,
  type LlmQuotaKind,
  type LlmTaskId,
  omnirouteModelSeesImages,
  visionImageBatchLimit,
} from "@vg/shared";
import type { LlmProviderRegistry, ResolvedLlmRoute } from "./registry.js";
import { LlmCache, createLlmCacheKey } from "./cache.js";
import type { LlmFunction, LlmImageAttachment, LlmProvider } from "./types.js";
import { LlmError } from "./types.js";
import { isFailoverError } from "./failover.js";
import { estimatePromptTokens } from "./tokenEstimate.js";
import { prepareVisionImages, visionCacheKeyExtra } from "./visionImages.js";
import {
  envOmnirouteVision,
  providerWithCapabilities,
  shouldGatewayFallback,
} from "./omnirouteCatalog.js";

const gatewayFallbackLogged = new WeakSet<AbortSignal>();
const unmeteredProviders = new Set(["mock", "ollama", "claude-cli", "copilot-cli", "antigravity-cli"]);

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
  functions?: LlmFunction[];
  /** Project data dir used to cache resized vision JPEGs. */
  visionCacheDir?: string;
  /** Real provider attempts only. Cache hits and preflight errors do not call this. */
  onRealCall?: (call: { provider: string; model: string; inputTokens: number; outputTokens: number }) => void;
  beforeProviderCall?: () => void;
  /** Runs on the extracted JSON before schema.safeParse, at every parse point. */
  normalize?: (raw: unknown) => unknown;
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
    const parsed = applyNormalize(input.normalize, extractJson(cached.responseText));
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
  input.beforeProviderCall?.();
  try {
    response = await input.provider.generate({
      schemaName: input.schemaName,
      jsonSchema,
      model: input.model,
      system: input.system,
      messages: [{ role: "user", content: input.prompt }],
      maxOutputTokens,
      json: !input.functions?.length,
      ...(input.functions?.length ? { functions: input.functions } : {}),
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
    if (attemptedCalls(error) > 0) {
      input.onRealCall?.({
        provider: input.provider.id,
        model: input.model,
        inputTokens: errorUsage?.inputTokens ?? 0,
        outputTokens: errorUsage?.outputTokens ?? 0,
      });
    }
    throw withUsage(error, { ...usage(), llmCalls: calls + attemptedCalls(error) }, input.provider.id === "copilot-cli");
  }
  calls += 1;
  totalInputTokens += response.usage.inputTokens;
  totalOutputTokens += response.usage.outputTokens;
  tokensUnknown ||= response.usage.tokensUnknown === true;
  input.onRealCall?.({
    provider: input.provider.id,
    model: input.model,
    inputTokens: response.usage.inputTokens,
    outputTokens: response.usage.outputTokens,
  });
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
  let validation = validateOutput(input.schema, rawText, input.normalize);
  const repairAttempts = input.repairAttempts ?? 1;
  let repairs = 0;
  while (!validation.success && repairs < repairAttempts) {
    try {
      input.beforeProviderCall?.();
      response = await input.provider.generate({
        schemaName: input.schemaName,
        jsonSchema,
        model: input.model,
        system: input.system,
        messages: [
          { role: "user", content: input.prompt },
          { role: "assistant", content: rawText },
          { role: "user", content: input.functions?.length
            ? `Correct the tool call and use valid JSON arguments. Validation issues:\n${JSON.stringify(validation.issues)}`
            : `Correct the JSON to satisfy these validation issues. Return only corrected JSON:\n${JSON.stringify(validation.issues)}` },
        ],
        maxOutputTokens,
        json: !input.functions?.length,
        ...(input.functions?.length ? { functions: input.functions } : {}),
        ...(requestImages.length ? { images: requestImages } : {}),
      }, input.signal);
    } catch (error) {
      if (input.signal.aborted || isAbortError(error)) throw error;
      if (error instanceof LlmError && error.code === "AUTONOMY_BUDGET_WAIT") {
        throw withUsage(error, usage(), input.provider.id === "copilot-cli");
      }
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
      if (attemptedCalls(error) > 0) {
        input.onRealCall?.({
          provider: input.provider.id,
          model: input.model,
          inputTokens: errorUsage?.inputTokens ?? 0,
          outputTokens: errorUsage?.outputTokens ?? 0,
        });
      }
      throw withUsage(error, { ...usage(), llmCalls: calls + attemptedCalls(error) }, input.provider.id === "copilot-cli");
    }
    calls += 1;
    repairs += 1;
    input.onRealCall?.({
      provider: input.provider.id,
      model: input.model,
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
    });
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
    validation = validateOutput(input.schema, rawText, input.normalize);
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

type RoutedResult<T> = Awaited<ReturnType<typeof generateStructured<T>>>;
type UsageSlice = { llmCalls: number; inputTokens: number; outputTokens: number; tokensUnknown?: boolean };

export async function generateRoutedStructured<T>(input: {
  knowledgeQuery?: string;
  knowledgeProject?: Project;
  registry: LlmProviderRegistry;
  route: ResolvedLlmRoute;
  task: LlmTaskId;
  gatewaySettings?: LlmGatewaySettings;
} & Omit<Parameters<typeof generateStructured<T>>[0], "provider" | "model" | "task">): Promise<RoutedResult<T>> {
  if (currentAutonomyBudget() || !input.cache?.sqlite) return routeStructured(input);
  const sqlite = input.cache.sqlite;
  try {
    const profileId = input.route.profileId ?? undefined;
    if (!hasAutonomySpendLimit(sqlite, profileId)) return routeStructured(input);
    const level = effectiveAutonomy(sqlite, { profileId }).level;
    if (level !== "supervised" && level !== "autonomous") return routeStructured(input);
    const usage = new UsageService(sqlite, 26_000);
    return runWithAutonomyBudget(() => autonomyBudgetStatus(sqlite, usage, profileId), () => routeStructured(input));
  } catch {
    return routeStructured(input);
  }
}

async function routeStructured<T>(input: {
  knowledgeQuery?: string;
  knowledgeProject?: Project;
  registry: LlmProviderRegistry;
  route: ResolvedLlmRoute;
  task: LlmTaskId;
  gatewaySettings?: LlmGatewaySettings;
  swapCandidates?: import("@vg/shared").SwapCandidate[];
} & Omit<Parameters<typeof generateStructured<T>>[0], "provider" | "model" | "task">): Promise<RoutedResult<T>> {
  const { registry, route: originalRoute, task, gatewaySettings, knowledgeProject, knowledgeQuery, ...request } = input;
  if (knowledgeProject && input.cache && TASK_KINDS[task]) {
    const knowledge = await buildKnowledgeBlock(input.cache.sqlite, {project:knowledgeProject,stage:task,taskId:task,query:knowledgeQuery ?? [knowledgeProject.topic,knowledgeProject.description,request.prompt.slice(0,1000)].join(" ")});
    if (knowledge.block) {
      request.prompt += "\n\n"+knowledge.block;
      if(input.cache.sqlite.prepare("SELECT 1 FROM projects WHERE id=?").get(knowledgeProject.id)) saveKnowledgeUse(input.cache.sqlite,knowledgeProject.id,task==="research"?"RESEARCH":task==="metadata"?"TIMELINE":task==="reviewChat"?"FINAL_APPROVAL":"SCRIPT",task,knowledge.uses);
    }
  }
  await registry.quota?.refreshIfStale(originalRoute.provider.id, originalRoute.model);
  const settings = input.cache?.sqlite && gatewayBypassOn(input.cache.sqlite)
    ? { ...(gatewaySettings ?? registry.getGatewaySettings()), mode: "off" as const }
    : gatewaySettings ?? registry.getGatewaySettings();
  const applied = await applyOmnirouteGateway(registry, originalRoute, settings, task);
  const route = applied.route;
  const gatewayDirect = applied.directFallback;
  const quota = registry.quota;
  if (route.provider.id !== originalRoute.provider.id || route.model !== originalRoute.model) {
    await quota?.refreshIfStale(route.provider.id, route.model);
  }
  const gatewayOnly = settings.mode === "only" && route.provider.id === "omniroute";
  const onRealCall = quota
    ? (call: { provider: string; model: string; inputTokens: number; outputTokens: number }) => quota.recordCall(call)
    : undefined;

  const callModel = async (provider: ResolvedLlmRoute["provider"], model: string, maxOutputTokens?: number) => {
    const kind = quota?.kindOf(provider.id, model);
    const paid = kind === "paid" && !unmeteredProviders.has(provider.id);
    const release = paid ? holdAutonomyUsd(0.01) : () => undefined;
    try {
      return await generateStructured({
    ...request,
    provider,
    model,
    task,
    maxOutputTokens: maxOutputTokens ?? route.maxOutputTokens ?? request.maxOutputTokens,
    beforeProviderCall: () => {
      request.beforeProviderCall?.();
      const budget = currentAutonomyBudget();
      if (budget?.state !== "stop") return;
      const kind = quota?.kindOf(provider.id, model);
      if (unmeteredProviders.has(provider.id)
          || kind === "free_tier" || kind === "subscription") return;
      throw new LlmError("Đã chạm hạn mức chi. Chờ kỳ ngân sách mới hoặc dùng model miễn phí.", "AUTONOMY_BUDGET_WAIT", true,
        undefined, undefined, undefined, budget.retryAt ?? undefined);
    },
    ...(onRealCall ? { onRealCall } : {}),
  });
    } finally {
      release();
    }
  };

  const tagCalls = (calls: LlmCallUsage[], fallback: boolean, reason?: "quota" | "quota_swap") => calls.map((call) => (
    fallback ? { ...call, fallback: true, ...(reason ? { fallbackReason: reason } : {}) } : call
  ));

  const mergeUsage = (
    firstCalls: LlmCallUsage[],
    firstUsage: UsageSlice,
    generated: RoutedResult<T>,
    reason?: "quota" | "quota_swap",
  ): RoutedResult<T> => ({
    ...generated,
    usage: {
      ...generated.usage,
      llmCalls: firstUsage.llmCalls + generated.usage.llmCalls,
      inputTokens: firstUsage.inputTokens + generated.usage.inputTokens,
      outputTokens: firstUsage.outputTokens + generated.usage.outputTokens,
      ...((firstUsage.tokensUnknown || generated.usage.tokensUnknown) ? { tokensUnknown: true } : {}),
      calls: [...firstCalls, ...tagCalls(generated.usage.calls, true, reason)],
    },
  });

  const mergedError = (
    message: string,
    code: LlmError["code"],
    retryable: boolean,
    status: number | undefined,
    firstCalls: LlmCallUsage[],
    firstUsage: UsageSlice,
    extra: LlmCallUsage[],
    extraUsage?: UsageSlice,
    retryAfterMs?: number,
    retryAt?: string,
  ) => new LlmError(message, code, retryable, status, {
    llmCalls: firstUsage.llmCalls + (extraUsage?.llmCalls ?? 0),
    inputTokens: firstUsage.inputTokens + (extraUsage?.inputTokens ?? 0),
    outputTokens: firstUsage.outputTokens + (extraUsage?.outputTokens ?? 0),
    ...(firstUsage.tokensUnknown || extraUsage?.tokensUnknown ? { tokensUnknown: true } : {}),
    calls: [...firstCalls, ...extra],
  }, retryAfterMs, retryAt);

  if (route.failedRoute) {
    const firstCalls: LlmCallUsage[] = [{
      task,
      provider: route.failedRoute.provider,
      model: route.failedRoute.model,
      inputTokens: 0,
      outputTokens: 0,
      cached: false,
      fallback: false,
      ok: false,
    }];
    const firstUsage: UsageSlice = { llmCalls: 0, inputTokens: 0, outputTokens: 0 };
    if (!route.provider) throw new LlmError("No fallback route is configured.", "LLM_NOT_CONFIGURED", false);
    try {
      const generated = await callModel(route.provider, route.model, route.maxOutputTokens);
      return mergeUsage(firstCalls, firstUsage, generated);
    } catch (error) {
      if (!(error instanceof LlmError)) throw error;
      throw mergedError(
        error.message,
        error.code,
        error.retryable,
        error.status,
        firstCalls,
        firstUsage,
        tagCalls(error.usage?.calls ?? [], true),
        error.usage,
        error.retryAfterMs,
        error.retryAt,
      );
    }
  }

  type Step = {
    provider: ResolvedLlmRoute["provider"];
    model: string;
    maxOutputTokens?: number;
    originalPrimary: boolean;
    kind: LlmQuotaKind | null;
    quality: number | null;
    costUsd: number | null;
  };
  const statFor = (provider: string, model: string) => {
    const sqlite = input.cache?.sqlite;
    if (!sqlite) return { quality: null, costUsd: null };
    try {
      const row = sqlite.prepare(`SELECT quality, p50_cost_usd AS cost FROM model_task_stats
        WHERE provider = ? AND model = ? AND task_id = ? ORDER BY day DESC LIMIT 1`)
        .get(provider, model, task) as { quality: string; cost: string | null } | undefined;
      if (!row) return { quality: null, costUsd: null };
      const quality = Number(row.quality);
      const costUsd = row.cost == null ? null : Number(row.cost);
      return {
        quality: Number.isFinite(quality) ? quality : null,
        costUsd: costUsd != null && Number.isFinite(costUsd) ? costUsd : null,
      };
    } catch {
      return { quality: null, costUsd: null };
    }
  };

  const userChain = gatewayOnly ? [] : fallbackChainOf(originalRoute);
  const kindOf = (provider: string, model: string): LlmQuotaKind | null =>
    quota?.kindOf(provider, model) ?? (unmeteredProviders.has(provider) ? "subscription" : null);
  const steps: Step[] = [{
    provider: route.provider,
    model: route.model,
    maxOutputTokens: route.maxOutputTokens,
    originalPrimary: true,
    kind: kindOf(route.provider.id, route.model),
    ...statFor(route.provider.id, route.model),
  }];
  for (const entry of userChain) {
    if (entry.provider === route.provider.id && (entry.model ?? route.provider.defaultModel ?? "") === route.model) continue;
    try {
      const resolved = registry.resolveFallback(entry);
      steps.push({
        provider: resolved.provider,
        model: resolved.model,
        maxOutputTokens: route.maxOutputTokens,
        originalPrimary: false,
        kind: kindOf(resolved.provider.id, resolved.model),
        ...statFor(resolved.provider.id, resolved.model),
      });
    } catch (error) {
      if (!(error instanceof LlmError)) throw error;
    }
  }
  const budgetState = currentAutonomyBudget()?.state;
  const eco = budgetState === "warn" || budgetState === "stop";
  const ranked = orderChainForBudget(steps, eco ? "ECO" : route.budgetMode);
  const minQuality = ranked.some((step) => (step.quality ?? 0) > 1) ? 7 : 0.7;
  const ordered = eco ? preferCheapestQualified(ranked, minQuality) : ranked;
  const policy = quota?.policyFor(route.profileId) ?? {
    policy: "wait" as const,
    paidFallbackDailyUsd: 1,
    timeZone: "Asia/Ho_Chi_Minh",
  };

  let priorCalls: LlmCallUsage[] = [];
  let priorUsage: UsageSlice = { llmCalls: 0, inputTokens: 0, outputTokens: 0 };
  let quotaPressure = false;
  let lastError: LlmError | undefined;
  let budgetWait: LlmError | undefined;

  const quotaWait = () => {
    const retryAt = quota?.earliestRetryAt(ordered.map((step) => ({ provider: step.provider.id, model: step.model }))) ?? null;
    if (!retryAt) {
      return mergedError(
        "Hết credit, cần nạp hoặc tạo quy tắc mới",
        "LLM_QUOTA_EXHAUSTED",
        false,
        undefined,
        priorCalls,
        priorUsage,
        [],
      );
    }
    const when = formatHourMinute(new Date(retryAt), policy.timeZone);
    const message = route.autonomy === "AUTO"
      ? `Chờ quota reset lúc ${when}`
      : `Hết quota miễn phí. Chờ đến ${when}.`;
    return mergedError(message, "LLM_QUOTA_WAIT", true, undefined, priorCalls, priorUsage, [], undefined, undefined, retryAt);
  };

  // TASK-127: failover bookkeeping. `attempts` explains why each provider did not answer.
  const tracker = registry.failover;
  const chained = ordered.length > 1;
  const attempts: Array<{ label: string; outcome: "skipped" | "failed"; reason: string }> = [];
  let lastFailed: { label: string; reason: string } | undefined;
  const labelOf = (step: Step) => `${step.provider.id}/${step.model}`;
  const estimatedPrompt = estimatePromptTokens(`${request.system}\n${request.prompt}`, request.images?.length ?? 0, true);
  const capabilityGap = (step: Step): string | null => {
    const caps = step.provider.capabilities;
    if (request.images?.length) {
      if (!caps?.vision) return "không đọc được ảnh (vision)";
      if (request.images.length > caps.maxImagesPerCall) return `chỉ nhận tối đa ${caps.maxImagesPerCall} ảnh mỗi lần`;
    }
    if (!request.functions?.length && caps?.json === false) return "không hỗ trợ đầu ra JSON";
    const maxInput = step.provider.limits?.maxInputTokens;
    if (maxInput && estimatedPrompt > maxInput) return `prompt (~${estimatedPrompt} token) vượt giới hạn ${maxInput}`;
    return null;
  };
  const exhausted = () => {
    const detail = attempts.map((a) => `${a.label} (${a.outcome === "skipped" ? "bỏ qua" : "lỗi"}: ${a.reason})`).join("; ");
    const untils = ordered.map((s) => tracker.cooldownFor(s.provider.id, s.model)?.until ?? 0).filter((n) => n > 0);
    const until = untils.length ? Math.min(...untils) : 0;
    return mergedError(
      `Mọi nhà cung cấp LLM đều không dùng được: ${detail}`,
      "LLM_ALL_PROVIDERS_EXHAUSTED", true, undefined, priorCalls, priorUsage, [], undefined, undefined,
      until > Date.now() ? new Date(until).toISOString() : undefined,
    );
  };

  for (const step of ordered) {
    const paidFallback = step.kind === "paid" && !step.originalPrimary;
    if (paidFallback) {
      const underCap = policy.policy === "paid_fallback" && (quota?.todaySpendUsd() ?? 0) < policy.paidFallbackDailyUsd;
      if (!underCap) {
        attempts.push({ label: labelOf(step), outcome: "skipped", reason: "model trả phí, chính sách hiện tại không cho dùng thay thế" });
        continue;
      }
    }
    if (chained) {
      const cooling = tracker.cooldownFor(step.provider.id, step.model);
      if (cooling) {
        attempts.push({ label: labelOf(step), outcome: "skipped", reason: `đang nghỉ đến ${new Date(cooling.until).toISOString()} (${cooling.reason})` });
        continue;
      }
      const gap = step.originalPrimary ? null : capabilityGap(step);
      if (gap) {
        attempts.push({ label: labelOf(step), outcome: "skipped", reason: gap });
        request.logger?.info({ task, provider: step.provider.id, model: step.model, reason: gap }, "LLM failover skipped a fallback that cannot serve the call");
        continue;
      }
    }
    if (quota?.isUnavailable(step.provider.id, step.model)) {
      attempts.push({ label: labelOf(step), outcome: "skipped", reason: "hết quota" });
      quotaPressure = true;
      if (step.originalPrimary && gatewayDirect && !gatewayOnly) {
        try {
          const generated = await callModel(gatewayDirect.provider, gatewayDirect.model, gatewayDirect.maxOutputTokens);
          return mergeUsage(priorCalls, priorUsage, generated, "quota");
        } catch (error) {
          if (!(error instanceof LlmError)) throw error;
          if (isQuotaSignal(error)) quota.onQuotaFailure({ provider: gatewayDirect.provider.id, model: gatewayDirect.model, error });
          priorCalls = [...priorCalls, ...tagCalls(error.usage?.calls ?? [], true, "quota")];
          priorUsage = {
            llmCalls: priorUsage.llmCalls + (error.usage?.llmCalls ?? 0),
            inputTokens: priorUsage.inputTokens + (error.usage?.inputTokens ?? 0),
            outputTokens: priorUsage.outputTokens + (error.usage?.outputTokens ?? 0),
          };
          lastError = error;
          if (!shouldFallback(error)) throw error;
        }
      }
      continue;
    }
    try {
      const generated = await callModel(step.provider, step.model, step.maxOutputTokens);
      tracker.recordSuccess(step.provider.id, step.model);
      if (lastFailed) {
        tracker.recordFailover({ task, from: lastFailed.label, to: labelOf(step), reason: lastFailed.reason });
        request.logger?.warn({ task, from: lastFailed.label, to: labelOf(step), reason: lastFailed.reason }, "LLM failover: answered by the next provider in the chain");
      }
      const asFallback = priorCalls.length > 0 || !step.originalPrimary;
      if (paidFallback) {
        const fresh = generated.usage.calls.filter((call) => !call.cached).at(-1);
        quota?.notePaidFallback({
          task,
          provider: step.provider.id,
          model: step.model,
          inputTokens: fresh?.inputTokens ?? generated.usage.inputTokens,
          outputTokens: fresh?.outputTokens ?? generated.usage.outputTokens,
        });
      }
      if (!asFallback) return generated;
      return mergeUsage(priorCalls, priorUsage, generated, quotaPressure ? "quota" : undefined);
    } catch (error) {
      if (!(error instanceof LlmError)) throw error;
      if (error.code === "AUTONOMY_BUDGET_WAIT") budgetWait = error;
      if (step.originalPrimary && gatewayDirect && (shouldGatewayFallback(error) || error.code === "AUTONOMY_BUDGET_WAIT") && priorCalls.length === 0) {
        logGatewayFallbackOnce(request.signal, request.logger, {
          task,
          from: `${route.provider.id}/${route.model}`,
          to: `${gatewayDirect.provider.id}/${gatewayDirect.model}`,
          code: error.code,
          status: error.status,
        });
        try {
          const generated = await callModel(gatewayDirect.provider, gatewayDirect.model, gatewayDirect.maxOutputTokens);
          return mergeUsage(error.usage?.calls ?? [], error.usage ?? priorUsage, generated);
        } catch (fallbackError) {
          if (!(fallbackError instanceof LlmError)) throw fallbackError;
          const firstUsage = error.usage ?? priorUsage;
          throw mergedError(
            fallbackError.message,
            fallbackError.code,
            fallbackError.retryable,
            fallbackError.status,
            error.usage?.calls ?? [],
            firstUsage,
            tagCalls(fallbackError.usage?.calls ?? [], true),
            fallbackError.usage,
            fallbackError.retryAfterMs,
            fallbackError.retryAt,
          );
        }
      }
      if (isFailoverError(error)) tracker.recordFailure(step.provider.id, step.model, error);
      attempts.push({ label: labelOf(step), outcome: "failed", reason: error.code });
      lastFailed = { label: labelOf(step), reason: error.code };
      const reason = quota && isQuotaSignal(error) ? "quota" as const : undefined;
      if (reason && quota) {
        quota.onQuotaFailure({ provider: step.provider.id, model: step.model, error });
        quotaPressure = true;
      }
      const tagged = tagCalls(error.usage?.calls ?? [], priorCalls.length > 0 || !step.originalPrimary, reason);
      priorCalls = [...priorCalls, ...tagged];
      priorUsage = {
        llmCalls: priorUsage.llmCalls + (error.usage?.llmCalls ?? 0),
        inputTokens: priorUsage.inputTokens + (error.usage?.inputTokens ?? 0),
        outputTokens: priorUsage.outputTokens + (error.usage?.outputTokens ?? 0),
        ...(priorUsage.tokensUnknown || error.usage?.tokensUnknown ? { tokensUnknown: true } : {}),
      };
      lastError = mergedError(
        error.message,
        error.code,
        error.retryable,
        error.status,
        priorCalls.slice(0, priorCalls.length - tagged.length),
        {
          llmCalls: priorUsage.llmCalls - (error.usage?.llmCalls ?? 0),
          inputTokens: priorUsage.inputTokens - (error.usage?.inputTokens ?? 0),
          outputTokens: priorUsage.outputTokens - (error.usage?.outputTokens ?? 0),
          ...(priorUsage.tokensUnknown ? { tokensUnknown: true } : {}),
        },
        tagged,
        error.usage,
        error.retryAfterMs,
        error.retryAt,
      );
      if (!shouldFallback(error) || gatewayOnly) throw lastError;
    }
  }

  if (budgetWait) throw mergedError(budgetWait.message, budgetWait.code, true, undefined,
    priorCalls, priorUsage, [], undefined, undefined, budgetWait.retryAt);
  if (quota && quotaPressure) {
    const sqlite = input.cache?.sqlite;
    let allowSwap = false;
    if (sqlite) {
      const { effectiveAutonomy } = await import("../../operator/autonomy.js");
      const level = effectiveAutonomy(sqlite, { profileId: route.profileId ?? undefined }).level;
      const row = route.profileId
        ? sqlite.prepare("SELECT llm FROM profiles WHERE id = ?").get(route.profileId) as { llm: string | { autoSwapOnQuota?: boolean } } | undefined
        : undefined;
      let raw: { autoSwapOnQuota?: boolean } | undefined;
      try {
        if (row && typeof row.llm === "string") raw = JSON.parse(row.llm) as { autoSwapOnQuota?: boolean };
        else if (row && typeof row.llm === "object") raw = row.llm;
      } catch {
        raw = undefined;
      }
      allowSwap = raw?.autoSwapOnQuota ?? (level === "supervised" || level === "autonomous");
    }
    if (!allowSwap) throw quotaWait();
    const { findEquivalentModel } = await import("@vg/shared");
    const catalogCandidates = registry.omnirouteCatalog.peekModels().map((item) => ({
      provider: "omniroute",
      model: item.id,
      vision: item.vision === true,
      paid: (item.pricing?.inputPerMTok ?? 0) > 0 || (item.pricing?.outputPerMTok ?? 0) > 0,
      tier: 1,
      family: item.id.split("/")[0],
    }));
    const pick = findEquivalentModel({
      provider: route.provider.id,
      model: route.model,
      budgetMode: route.budgetMode === "ECO" || route.budgetMode === "QUALITY" ? route.budgetMode : "BALANCED",
      taskNeedsVision: task === "visionCheck",
    }, [...(input.swapCandidates ?? []), ...catalogCandidates]);
    if (pick) {
      try {
        const resolved = registry.resolveFallback({ provider: pick.provider, model: pick.model });
        const generated = await callModel(resolved.provider, resolved.model, route.maxOutputTokens);
        return mergeUsage(priorCalls, priorUsage, generated, "quota_swap");
      } catch (error) {
        if (!(error instanceof LlmError)) throw error;
      }
    }
    throw quotaWait();
  }
  if (chained && attempts.length >= 2 && attempts.some((a) => a.outcome === "failed" || a.reason.startsWith("đang nghỉ"))) {
    throw exhausted();
  }
  if (lastError) throw lastError;
  if (quota) throw quotaWait();
  throw new LlmError("No LLM provider is available for this task.", "LLM_NOT_CONFIGURED", false);
}

function isQuotaSignal(error: LlmError): boolean {
  return error.code === "LLM_QUOTA_EXHAUSTED" || error.code === "LLM_RATE_LIMIT" || error.code === "LLM_QUOTA_WAIT";
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
  const marked = omnirouteModelSeesImages(target.omnirouteModel)
    || registry.visionMarks().some((row) =>
    (row.provider === "omniroute" && row.model === target.omnirouteModel)
    || (row.provider === route.provider.id && row.model === route.model));
  let capabilities = catalogVision === undefined
    ? (omni.capabilities ?? envOmnirouteVision())
    : catalogVision
      ? { vision: true, maxImagesPerCall: visionImageBatchLimit(omni.capabilities?.maxImagesPerCall) }
      : { vision: false, maxImagesPerCall: 0 };
  if (marked && !capabilities.vision) {
    capabilities = { vision: true, maxImagesPerCall: visionImageBatchLimit(capabilities.maxImagesPerCall) };
  }
  const provider = providerWithCapabilities(omni, capabilities);

  const gatewayRoute: ResolvedLlmRoute = {
    provider,
    model: target.omnirouteModel,
    maxOutputTokens: route.maxOutputTokens,
    // prefer: the direct route is the fallback (directFallback below); only: no fallback at all.
    fallback: undefined,
    source: route.source,
    budgetMode: route.budgetMode,
    autonomy: route.autonomy,
    profileId: route.profileId,
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
const NOT_SENT_CODES = new Set(["LLM_NOT_CONFIGURED", "LLM_LIMIT_TOO_SMALL", "VISION_PROVIDER_REQUIRED", "FFMPEG_MISSING", "AUTONOMY_BUDGET_WAIT"]);

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
    }, error.retryAfterMs, error.retryAt);
  }
  return new LlmError(
    error instanceof Error ? error.message : String(error),
    "LLM_UNAVAILABLE",
    true,
    undefined,
    { ...usage, ...(tokensUnknown ? { tokensUnknown: true } : {}) },
  );
}

function applyNormalize(normalize: ((raw: unknown) => unknown) | undefined, value: unknown): unknown {
  return normalize ? normalize(value) : value;
}

function validateOutput<T>(schema: z.ZodType<T>, text: string, normalize?: (raw: unknown) => unknown):
  | { success: true; data: T }
  | { success: false; issues: { path: string; message: string }[] } {
  let value: unknown;
  try {
    value = applyNormalize(normalize, extractJson(text));
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
