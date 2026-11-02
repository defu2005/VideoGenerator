import { ApiErrorSchema, BudgetEstimateSchema, estimateBudget } from "@vg/shared";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../lib/config.js";
import type { JobRepository } from "../jobs/jobRepository.js";
import type { ProjectService } from "../services/projectService.js";
import { requireProject } from "../services/projectService.js";

const ParamsSchema = z.object({ id: z.string().uuid() }).strict();

export function registerBudgetRoutes(
  app: FastifyInstance,
  projects: ProjectService,
  repository: JobRepository,
  config: AppConfig,
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
    const providers = ["research", "script"].map((stage) => {
      const selected = stage === "research"
        ? project.settings.llm?.research?.provider
          ?? project.settings.llm?.default?.provider
          ?? config.LLM_RESEARCH_PROVIDER
          ?? config.LLM_DEFAULT_PROVIDER
        : project.settings.llm?.script?.provider
          ?? project.settings.llm?.default?.provider
          ?? config.LLM_SCRIPT_PROVIDER
          ?? config.LLM_DEFAULT_PROVIDER;
      return selected;
    }).filter((provider): provider is string => provider !== undefined);
    return estimateBudget(project, providers, stageStates);
  });
}
