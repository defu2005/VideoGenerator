import { ApiErrorSchema, DashboardStatsSchema } from "@vg/shared";
import type { FastifyInstance } from "fastify";
import type { ProjectService } from "../services/projectService.js";
import type { AutomationService } from "../services/automationService.js";

export function registerDashboardRoutes(
  app: FastifyInstance,
  service: ProjectService,
  automation?: AutomationService,
  trends?: { listToday: () => Array<{
    profileId: string;
    profileName: string;
    title: string;
    angle: string;
    urgency: "today" | "this_week" | "evergreen";
    fitScore: number;
  }> },
): void {
  app.get("/api/dashboard/stats", {
    schema: {
      response: {
        200: DashboardStatsSchema,
        500: ApiErrorSchema,
      },
    },
  }, async () => {
    const stats = await service.dashboardStats();
    return DashboardStatsSchema.parse({
      ...stats,
      ...(automation ? { automation: automation.dashboardCard() } : {}),
      trendsToday: trends?.listToday() ?? [],
    });
  });
}
