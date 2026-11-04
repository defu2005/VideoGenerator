import { AutoReportResponseSchema } from "@vg/shared";
import type { FastifyInstance } from "fastify";
import type { Project } from "@vg/shared";
import { z } from "zod";
import { AppError } from "../lib/errors.js";
import type { AutoReportService } from "../services/autoReportService.js";

const ProjectParams = z.object({ id: z.string().uuid() }).strict();

export function registerAutoReportRoutes(
  app: FastifyInstance,
  autoReport: AutoReportService,
  projectService: { getProject: (id: string) => Promise<Project | undefined> },
): void {
  app.get("/api/projects/:id/auto-report", {
    schema: {
      params: ProjectParams,
      response: { 200: AutoReportResponseSchema },
    },
  }, async (request) => {
    const { id } = ProjectParams.parse(request.params);
    const project = await projectService.getProject(id);
    if (!project) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
    return autoReport.responseFor(id);
  });
}
