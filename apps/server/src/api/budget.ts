import { ApiErrorSchema, BudgetEstimateSchema, estimateBudget, LLM_TASKS, type LlmTaskId } from "@vg/shared";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../lib/config.js";
import type { JobRepository } from "../jobs/jobRepository.js";
import type { ProjectService } from "../services/projectService.js";
import { requireProject } from "../services/projectService.js";
import type { LlmProviderRegistry } from "../providers/llm/registry.js";
import { getAppLlmSettings } from "../providers/llm/settings.js";
import { LlmError } from "../providers/llm/types.js";

const ParamsSchema = z.object({ id: z.string().uuid() }).strict();

export function registerBudgetRoutes(
  app: FastifyInstance,
  projects: ProjectService,
  repository: JobRepository,
  config: AppConfig,
  registry?: LlmProviderRegistry,
): void {
  app.get("/api/projects/:id/budget-estimate", {
    schema: {
      params: ParamsSchema,
      response: { 200: BudgetEstimateSchema, 404: ApiErrorSchema },
    },
  }, async (request) => {
    const { id } = ParamsSchema.parse(request.params);
    const project = await requireProject(projects, id);
    const stageStates = repository.getStages(id);
    const appRouting = getAppLlmSettings(repository.sqlite);
    const routes: Partial<Record<LlmTaskId, { provider?: string; model?: string }>> = {};
    for (const task of LLM_TASKS) {
      try {
        routes[task.id] = registry?.resolveRoute(task.id, project, appRouting);
      } catch (error) {
        if (!(error instanceof LlmError) || error.code !== "LLM_NOT_CONFIGURED") throw error;
      }
    }
    return estimateBudget(project, routes, stageStates);
  });
}
