import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { Project } from "@vg/shared";
import { AppError } from "../lib/errors.js";
import type { TimelineService } from "../services/timelineService.js";

const ProjectParams = z.object({ id: z.string().uuid() }).strict();

export function registerTimelineRoutes(
  app: FastifyInstance,
  timelines: TimelineService,
  projectService: { getProject: (id: string) => Promise<Project | undefined> },
): void {
  app.get("/api/projects/:id/timeline", async (request) => {
    const { id } = ProjectParams.parse(request.params);
    if (!await projectService.getProject(id)) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
    return timelines.get(id);
  });
}
