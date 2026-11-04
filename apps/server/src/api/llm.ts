import {
  ApiErrorSchema,
  LLM_TASKS,
  LlmGatewaySettingsSchema,
  LlmProviderIdSchema,
  LlmProviderInfoSchema,
  LlmSettingsSchema,
  OmniRouteCatalogSchema,
  OmniRouteHealthSchema,
  type LlmTaskId,
} from "@vg/shared";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import type { LlmProviderRegistry } from "../providers/llm/registry.js";
import type { ProjectService } from "../services/projectService.js";
import { getAppLlmSettings, saveAppLlmSettings } from "../providers/llm/settings.js";
import { getLlmGatewaySettings, saveLlmGatewaySettings } from "../providers/llm/gatewaySettings.js";
import { JobUsageSchema } from "@vg/shared";
import { AppError } from "../lib/errors.js";
import { LlmError } from "../providers/llm/types.js";

const TaskCatalogSchema = z.array(z.object({
  id: z.string(),
  label: z.string(),
  stage: z.string(),
  purpose: z.string(),
  tier: z.enum(["strong", "fast"]),
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
    source: z.enum(["project-task", "project-default", "app-task", "app-default", "env-task", "env-default"]),
  }).strict().nullable()),
}).strict();
const ProjectParamsSchema = z.object({ id: z.string().uuid() }).strict();

export function registerLlmRoutes(
  app: FastifyInstance,
  registry: LlmProviderRegistry,
  sqlite: Database.Database,
  projects?: ProjectService,
  fetchImpl: typeof fetch = fetch,
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
      if (!registry.isSupportedProvider(route.provider)
        || (route.fallback && !registry.isSupportedProvider(route.fallback.provider))) {
        throw new AppError(400, "INVALID_LLM_PROVIDER", "An LLM route references an unsupported provider.");
      }
    }
    saveAppLlmSettings(sqlite, settings);
    return settings;
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
