import { ApiErrorSchema, DashboardStatsSchema } from "@vg/shared";
import type { FastifyInstance } from "fastify";
import type { ProjectService } from "../services/projectService.js";

export function registerDashboardRoutes(app: FastifyInstance, service: ProjectService): void {
  app.get("/api/dashboard/stats", {
    schema: {
      response: {
        200: DashboardStatsSchema,
        500: ApiErrorSchema,
      },
    },
  }, async () => service.dashboardStats());
}
