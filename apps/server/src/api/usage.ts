import { ApiErrorSchema, ProjectUsageSchema, UsageQuerySchema, AppUsageSchema } from "@vg/shared";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { UsageService } from "../services/usageService.js";
import type { ProjectService } from "../services/projectService.js";
import { requireProject } from "../services/projectService.js";

const ProjectParamsSchema = z.object({ id: z.string().uuid() }).strict();

export function registerUsageRoutes(
  app: FastifyInstance,
  usage: UsageService,
  projects: ProjectService,
): void {
  app.get("/api/projects/:id/usage", {
    schema: {
      params: ProjectParamsSchema,
      response: { 200: ProjectUsageSchema, 404: ApiErrorSchema, 500: ApiErrorSchema },
    },
  }, async (request) => {
    const { id } = ProjectParamsSchema.parse(request.params);
    await requireProject(projects, id);
    return usage.getProjectUsage(id);
  });

  app.get("/api/usage", {
    schema: {
      querystring: UsageQuerySchema,
      response: { 200: AppUsageSchema, 400: ApiErrorSchema, 500: ApiErrorSchema },
    },
  }, async (request) => usage.getAppUsage(UsageQuerySchema.parse(request.query)));
}
