import {
  VideoMetadataDraftSchema,
  VideoMetadataGenerateRequestSchema,
  VideoMetadataResponseSchema,
} from "@vg/shared";
import type { FastifyInstance } from "fastify";
import type { Project } from "@vg/shared";
import { z } from "zod";
import { AppError } from "../lib/errors.js";
import type { MetadataService } from "../services/metadataService.js";

const ProjectParams = z.object({ id: z.string().uuid() }).strict();

export function registerMetadataRoutes(
  app: FastifyInstance,
  metadata: MetadataService,
  projectService: { getProject: (id: string) => Promise<Project | undefined> },
): void {
  app.get("/api/projects/:id/metadata", {
    schema: {
      params: ProjectParams,
      response: { 200: VideoMetadataResponseSchema },
    },
  }, async (request) => {
    const { id } = ProjectParams.parse(request.params);
    const project = await projectService.getProject(id);
    if (!project) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
    return metadata.get(project);
  });

  app.put("/api/projects/:id/metadata", {
    schema: {
      params: ProjectParams,
      body: VideoMetadataDraftSchema,
    },
  }, async (request) => {
    const { id } = ProjectParams.parse(request.params);
    const project = await projectService.getProject(id);
    if (!project) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
    const body = VideoMetadataDraftSchema.parse(request.body);
    return metadata.saveEdits(project, body);
  });

  app.post("/api/projects/:id/metadata/generate", {
    schema: {
      params: ProjectParams,
      body: VideoMetadataGenerateRequestSchema,
    },
  }, async (request) => {
    const { id } = ProjectParams.parse(request.params);
    const project = await projectService.getProject(id);
    if (!project) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
    const body = VideoMetadataGenerateRequestSchema.parse(request.body ?? {});
    const result = await metadata.generate(project, {
      overwriteEdits: body.overwriteEdits,
      warn: (message, extra) => request.log.warn(extra ?? {}, message),
      logger: request.log,
    });
    const current = metadata.get(project);
    return { metadata: result.metadata, stale: result.stale, source: result.source, extras: current.extras };
  });
}
