import {
  ApiErrorSchema,
  CreateProjectInputSchema,
  ProjectListQuerySchema,
  ProjectListResponseSchema,
  ProjectSchema,
  UpdateProjectInputSchema,
} from "@vg/shared";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { ProjectService } from "../services/projectService.js";
import { AppError } from "../lib/errors.js";
import { requireProject } from "../services/projectService.js";

const ProjectParamsSchema = z.object({ id: z.string().uuid() }).strict();
const ErrorResponses = {
  400: ApiErrorSchema,
  404: ApiErrorSchema,
  409: ApiErrorSchema,
  500: ApiErrorSchema,
};

export function registerProjectRoutes(app: FastifyInstance, service: ProjectService): void {
  app.get("/api/projects", {
    schema: {
      querystring: ProjectListQuerySchema,
      response: { 200: ProjectListResponseSchema, ...ErrorResponses },
    },
  }, async (request) => service.listProjects(ProjectListQuerySchema.parse(request.query)));

  app.post("/api/projects", {
    schema: {
      body: CreateProjectInputSchema,
      response: { 201: ProjectSchema, ...ErrorResponses },
    },
  }, async (request, reply) => {
    const project = await service.createProject(CreateProjectInputSchema.parse(request.body));
    return reply.code(201).send(project);
  });

  app.get("/api/projects/:id", {
    schema: {
      params: ProjectParamsSchema,
      response: { 200: ProjectSchema, ...ErrorResponses },
    },
  }, async (request) => {
    const { id } = ProjectParamsSchema.parse(request.params);
    return requireProject(service, id);
  });

  app.patch("/api/projects/:id", {
    schema: {
      params: ProjectParamsSchema,
      body: UpdateProjectInputSchema,
      response: { 200: ProjectSchema, ...ErrorResponses },
    },
  }, async (request) => {
    const { id } = ProjectParamsSchema.parse(request.params);
    const updated = await service.updateProject(id, UpdateProjectInputSchema.parse(request.body));
    if (!updated) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
    return updated;
  });

  app.post("/api/projects/:id/duplicate", {
    schema: {
      params: ProjectParamsSchema,
      response: { 201: ProjectSchema, ...ErrorResponses },
    },
  }, async (request, reply) => {
    const { id } = ProjectParamsSchema.parse(request.params);
    const project = await service.duplicateProject(id);
    if (!project) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
    return reply.code(201).send(project);
  });

  app.post("/api/projects/:id/archive", {
    schema: {
      params: ProjectParamsSchema,
      response: { 200: ProjectSchema, ...ErrorResponses },
    },
  }, async (request) => {
    const { id } = ProjectParamsSchema.parse(request.params);
    const project = await service.setArchived(id, true);
    if (!project) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
    return project;
  });

  app.post("/api/projects/:id/unarchive", {
    schema: {
      params: ProjectParamsSchema,
      response: { 200: ProjectSchema, ...ErrorResponses },
    },
  }, async (request) => {
    const { id } = ProjectParamsSchema.parse(request.params);
    const project = await service.setArchived(id, false);
    if (!project) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
    return project;
  });

  app.delete("/api/projects/:id", {
    schema: {
      params: ProjectParamsSchema,
      response: { 204: z.null(), ...ErrorResponses },
    },
  }, async (request, reply) => {
    const { id } = ProjectParamsSchema.parse(request.params);
    const result = await service.deleteProject(id);
    if (result === "not_found") throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
    if (result === "busy") throw new AppError(409, "PROJECT_BUSY", "Project is currently running");
    return reply.code(204).send();
  });
}
