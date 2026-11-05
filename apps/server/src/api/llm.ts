import {
  ApiErrorSchema,
  LLM_TASKS,
  LlmGatewaySettingsSchema,
  LlmProviderIdSchema,
  LlmProviderInfoSchema,
  LlmQuotaModelRefSchema,
  LlmQuotaPolicyBodySchema,
  LlmQuotaRuleSchema,
  LlmQuotaStatusSchema,
  OmniRouteTokenBodySchema,
  LlmSettingsSchema,
  ModelAdvisorApplyBodySchema,
  ModelAdvisorApplyResultSchema,
  ModelAdvisorProposeBodySchema,
  ModelAdvisorProposalSchema,
  OmniRouteCatalogSchema,
  OmniRouteHealthSchema,
  type LlmTaskId,
} from "@vg/shared";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import type { LlmProviderRegistry } from "../providers/llm/registry.js";
import type { ProjectService } from "../services/projectService.js";
import type { ProfileService } from "../services/profileService.js";
import { getAppLlmSettings, saveAppLlmSettings } from "../providers/llm/settings.js";
import {
  clearLlmCooldown,
  readQuotaStatus,
  saveQuotaPolicy,
  saveUserQuotaRule,
  setQuotaRuleEnabled,
} from "../providers/llm/quota.js";
import type { OmniRouteQuotaSync } from "../services/omnirouteQuotaSync.js";
import { getLlmGatewaySettings, saveLlmGatewaySettings } from "../providers/llm/gatewaySettings.js";
import { applyModelRoutes, proposeModelRoutes } from "../services/modelAdvisor.js";
import { JobUsageSchema } from "@vg/shared";
import { AppError } from "../lib/errors.js";
import { LlmError } from "../providers/llm/types.js";

const TaskCatalogSchema = z.array(z.object({
  id: z.string(),
  label: z.string(),
  stage: z.string(),
  purpose: z.string(),
  tier: z.enum(["strong", "fast"]),
  qualityWeight: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  needsVision: z.boolean().optional(),
  needsLongContext: z.boolean().optional(),
  budgetFeature: z.string().optional(),
}).strict());
const ModelSuggestionsSchema = z.object({
  provider: LlmProviderIdSchema,
  models: z.array(z.string()),
}).strict();
const ProjectRoutesSchema = z.object({
  routes: z.record(z.string(), z.object({
    provider: z.string(),
    model: z.string(),
    maxOutputTokens: z.number().int().optional(),
    fallback: z.object({ provider: z.string(), model: z.string().optional() }).optional(),
    fallbacks: z.array(z.object({ provider: z.string(), model: z.string().optional() }).strict()).max(4).optional(),
    source: z.enum(["project-task", "project-default", "app-task", "app-default", "env-task", "env-default"]),
  }).strict().nullable()),
}).strict();
const ProjectParamsSchema = z.object({ id: z.string().uuid() }).strict();

function presentQuota(sqlite: Database.Database, quotaSync?: OmniRouteQuotaSync) {
  const status = readQuotaStatus(sqlite);
  if (!quotaSync) return status;
  const token = quotaSync.tokenMeta();
  return {
    ...status,
    omniroute: {
      ...status.omniroute,
      tokenSaved: token.saved,
      tokenLast4: token.last4,
    },
  };
}

export function registerLlmRoutes(
  app: FastifyInstance,
  registry: LlmProviderRegistry,
  sqlite: Database.Database,
  projects?: ProjectService,
  profiles?: ProfileService,
  fetchImpl: typeof fetch = fetch,
  quotaSync?: OmniRouteQuotaSync,
): void {
  app.get("/api/llm/providers", {
    schema: {
      response: { 200: z.array(LlmProviderInfoSchema), 500: ApiErrorSchema },
    },
  }, async () => registry.list(getProviderMonthCalls(sqlite)));

  app.get("/api/llm/tasks", {
    schema: { response: { 200: TaskCatalogSchema } },
  }, async () => LLM_TASKS);

  app.get("/api/settings/llm-routing", {
    schema: { response: { 200: LlmSettingsSchema } },
  }, async () => getAppLlmSettings(sqlite) ?? {});

  app.put("/api/settings/llm-routing", {
    schema: {
      body: LlmSettingsSchema,
      response: { 200: LlmSettingsSchema, 400: ApiErrorSchema },
    },
  }, async (request) => {
    const settings = LlmSettingsSchema.parse(request.body);
    for (const route of [
      settings.default,
      ...Object.values(settings.tasks ?? {}),
    ]) {
      if (!route) continue;
      const chain = [...(route.fallback ? [route.fallback] : []), ...(route.fallbacks ?? [])];
      if (!registry.isSupportedProvider(route.provider) || chain.some((entry) => !registry.isSupportedProvider(entry.provider))) {
        throw new AppError(400, "INVALID_LLM_PROVIDER", "An LLM route references an unsupported provider.");
      }
    }
    saveAppLlmSettings(sqlite, settings);
    return settings;
  });

  app.get("/api/llm/quota", {
    schema: { response: { 200: LlmQuotaStatusSchema } },
  }, async () => {
    if (quotaSync && !process.env.VITEST) await quotaSync.refreshIfDue();
    return presentQuota(sqlite, quotaSync);
  });

  app.post("/api/llm/quota/omniroute/refresh", {
    schema: { response: { 200: LlmQuotaStatusSchema, 503: ApiErrorSchema } },
  }, async () => {
    if (!quotaSync) throw new AppError(503, "OMNIROUTE_QUOTA_UNAVAILABLE", "Đồng bộ quota OmniRoute chưa sẵn sàng.");
    await quotaSync.refresh(true);
    return presentQuota(sqlite, quotaSync);
  });

  app.put("/api/llm/quota/omniroute/token", {
    schema: {
      body: OmniRouteTokenBodySchema,
      response: { 200: LlmQuotaStatusSchema, 400: ApiErrorSchema, 503: ApiErrorSchema },
    },
  }, async (request) => {
    if (!quotaSync) throw new AppError(503, "OMNIROUTE_QUOTA_UNAVAILABLE", "Đồng bộ quota OmniRoute chưa sẵn sàng.");
    const body = OmniRouteTokenBodySchema.parse(request.body);
    quotaSync.saveToken(body.token);
    return presentQuota(sqlite, quotaSync);
  });

  app.delete("/api/llm/quota/omniroute/token", {
    schema: { response: { 200: LlmQuotaStatusSchema, 503: ApiErrorSchema } },
  }, async () => {
    if (!quotaSync) throw new AppError(503, "OMNIROUTE_QUOTA_UNAVAILABLE", "Đồng bộ quota OmniRoute chưa sẵn sàng.");
    quotaSync.removeToken();
    return presentQuota(sqlite, quotaSync);
  });

  app.put("/api/llm/quota/policy", {
    schema: {
      body: LlmQuotaPolicyBodySchema,
      response: { 200: LlmQuotaStatusSchema, 400: ApiErrorSchema },
    },
  }, async (request) => {
    const body = LlmQuotaPolicyBodySchema.parse(request.body);
    saveQuotaPolicy(sqlite, body);
    return presentQuota(sqlite, quotaSync);
  });

  app.put("/api/llm/quota/rules", {
    schema: {
      body: LlmQuotaRuleSchema,
      response: { 200: LlmQuotaStatusSchema, 400: ApiErrorSchema },
    },
  }, async (request) => {
    const rule = LlmQuotaRuleSchema.parse(request.body);
    if (!registry.isSupportedProvider(rule.provider)) {
      throw new AppError(400, "INVALID_LLM_PROVIDER", "A quota rule references an unsupported provider.");
    }
    saveUserQuotaRule(sqlite, rule);
    return presentQuota(sqlite, quotaSync);
  });

  app.post("/api/llm/quota/rules/enabled", {
    schema: {
      body: LlmQuotaModelRefSchema.extend({ enabled: z.boolean() }),
      response: { 200: LlmQuotaStatusSchema, 400: ApiErrorSchema },
    },
  }, async (request) => {
    const body = LlmQuotaModelRefSchema.extend({ enabled: z.boolean() }).parse(request.body);
    setQuotaRuleEnabled(sqlite, body.provider, body.model, body.enabled);
    return presentQuota(sqlite, quotaSync);
  });

  app.post("/api/llm/quota/cooldowns/clear", {
    schema: {
      body: LlmQuotaModelRefSchema,
      response: { 200: LlmQuotaStatusSchema, 400: ApiErrorSchema },
    },
  }, async (request) => {
    const body = LlmQuotaModelRefSchema.parse(request.body);
    clearLlmCooldown(sqlite, body.provider, body.model);
    return presentQuota(sqlite, quotaSync);
  });

  app.get("/api/settings/llm-gateway", {
    schema: { response: { 200: LlmGatewaySettingsSchema } },
  }, async () => getLlmGatewaySettings(sqlite));

  app.put("/api/settings/llm-gateway", {
    schema: {
      body: LlmGatewaySettingsSchema,
      response: { 200: LlmGatewaySettingsSchema, 400: ApiErrorSchema },
    },
  }, async (request) => {
    const settings = LlmGatewaySettingsSchema.parse(request.body);
    for (const mapping of settings.mappings) {
      if (!registry.isSupportedProvider(mapping.provider)) {
        throw new AppError(400, "INVALID_LLM_PROVIDER", "A gateway mapping references an unsupported provider.");
      }
    }
    return saveLlmGatewaySettings(sqlite, settings);
  });

  app.get("/api/llm/providers/omniroute/health", {
    schema: { response: { 200: OmniRouteHealthSchema } },
  }, async () => registry.omnirouteCatalog.health(fetchImpl));

  app.get("/api/llm/providers/omniroute/catalog", {
    schema: { response: { 200: OmniRouteCatalogSchema } },
  }, async () => {
    try {
      await registry.omnirouteCatalog.getModels({ fetchImpl });
    } catch {
      // Return the cached/empty snapshot when OmniRoute is down.
    }
    return registry.omnirouteCatalog.getCatalogSnapshot();
  });

  app.post("/api/llm/providers/omniroute/catalog/refresh", {
    schema: { response: { 200: OmniRouteCatalogSchema, 502: ApiErrorSchema } },
  }, async () => {
    registry.omnirouteCatalog.invalidate();
    try {
      await registry.omnirouteCatalog.getModels({ forceRefresh: true, fetchImpl });
    } catch (error) {
      throw new AppError(
        502,
        "OMNIROUTE_UNAVAILABLE",
        error instanceof Error ? error.message : "Không tải được danh sách model OmniRoute",
      );
    }
    return registry.omnirouteCatalog.getCatalogSnapshot();
  });

  app.get("/api/llm/providers/:id/models", {
    schema: {
      params: z.object({ id: LlmProviderIdSchema }).strict(),
      response: { 200: ModelSuggestionsSchema, 404: ApiErrorSchema },
    },
  }, async (request) => {
    const { id } = z.object({ id: LlmProviderIdSchema }).strict().parse(request.params);
    if (!registry.isSupportedProvider(id)) throw new AppError(404, "LLM_PROVIDER_NOT_FOUND", "LLM provider not found");
    const used = getProviderUsedModels(sqlite, id);
    const suggested = await registry.suggestModels(id, fetchImpl);
    return { provider: id, models: [...new Set([...used, ...suggested])] };
  });

  app.get("/api/projects/:id/llm-routes", {
    schema: {
      params: ProjectParamsSchema,
      response: { 200: ProjectRoutesSchema, 404: ApiErrorSchema },
    },
  }, async (request) => {
    const { id } = ProjectParamsSchema.parse(request.params);
    const project = await projects?.getProject(id);
    if (!project) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
    const appRouting = getAppLlmSettings(sqlite);
    const routes: Partial<Record<LlmTaskId, ReturnType<typeof registry.resolveRoute> | null>> = {};
    for (const task of LLM_TASKS) {
      try {
        routes[task.id] = registry.resolveRoute(task.id, project, appRouting);
      } catch (error) {
        if (!(error instanceof LlmError) || error.code !== "LLM_NOT_CONFIGURED") throw error;
        routes[task.id] = null;
      }
    }
    return { routes };
  });

  app.post("/api/llm/advisor/propose", {
    schema: {
      body: ModelAdvisorProposeBodySchema,
      response: {
        200: ModelAdvisorProposalSchema,
        400: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
  }, async (request) => {
    const body = ModelAdvisorProposeBodySchema.parse(request.body);
    try {
      return await proposeModelRoutes({
        registry,
        sqlite,
        projects,
        profiles,
        scope: body.scope,
        id: body.id,
        budgetMode: body.budgetMode,
        fetchImpl,
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (error instanceof LlmError) {
        throw new AppError(
          error.code === "LLM_NOT_CONFIGURED" ? 400 : 502,
          error.code,
          error.message,
        );
      }
      throw error;
    }
  });

  app.post("/api/llm/advisor/apply", {
    schema: {
      body: ModelAdvisorApplyBodySchema,
      response: {
        200: ModelAdvisorApplyResultSchema,
        400: ApiErrorSchema,
        404: ApiErrorSchema,
      },
    },
  }, async (request) => {
    const body = ModelAdvisorApplyBodySchema.parse(request.body);
    try {
      return await applyModelRoutes({
        registry,
        sqlite,
        projects,
        profiles,
        scope: body.scope,
        id: body.id,
        proposalId: body.proposalId,
        taskIds: body.taskIds,
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw error;
    }
  });
}

export function getProviderMonthCalls(sqlite: Database.Database, now = new Date()): Map<string, number> {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
  const rows = sqlite.prepare(
    "SELECT usage FROM jobs WHERE created_at >= ? AND created_at < ? AND usage IS NOT NULL",
  ).all(monthStart, nextMonth) as Array<{ usage: string }>;
  const calls = new Map<string, number>();
  for (const row of rows) {
    const usage = JobUsageSchema.parse(JSON.parse(row.usage) as unknown);
    if (usage.calls) {
      for (const call of usage.calls) {
        if (call.cached) continue;
        calls.set(call.provider, (calls.get(call.provider) ?? 0) + 1);
      }
      continue;
    }
    if (!usage.provider) continue;
    calls.set(usage.provider, (calls.get(usage.provider) ?? 0) + usage.llmCalls);
  }
  return calls;
}

/** Models that already answered successfully for this provider, most recent first. */
export function getProviderUsedModels(sqlite: Database.Database, providerId: string, limit = 8): string[] {
  let rows: Array<{ usage: string }> = [];
  try {
    rows = sqlite.prepare(
      "SELECT usage FROM jobs WHERE usage IS NOT NULL ORDER BY created_at DESC LIMIT 500",
    ).all() as Array<{ usage: string }>;
  } catch {
    return [];
  }
  const models: string[] = [];
  for (const row of rows) {
    let calls: Array<{ provider?: string; model?: string; ok?: boolean; cached?: boolean }> = [];
    try {
      calls = (JSON.parse(row.usage) as { calls?: typeof calls }).calls ?? [];
    } catch {
      continue;
    }
    for (const call of [...calls].reverse()) {
      if (call.provider !== providerId || call.ok !== true || call.cached || !call.model) continue;
      if (!models.includes(call.model)) models.push(call.model);
      if (models.length >= limit) return models;
    }
  }
  return models;
}
