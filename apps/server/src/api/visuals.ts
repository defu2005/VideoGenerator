import {
  ApiErrorSchema,
  ProjectVisualsSchema,
  SceneVisualsSchema,
} from "@vg/shared";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { AppError } from "../lib/errors.js";
import type { JobRepository } from "../jobs/jobRepository.js";
import type { VisualService } from "../services/visualService.js";

const ProjectParams = z.object({ id: z.string().uuid() }).strict();
const SceneParams = z.object({ id: z.string().uuid(), sceneId: z.string().uuid() }).strict();
const CandidateParams = SceneParams.extend({ candidateId: z.string().uuid() }).strict();
const SearchBody = z.object({
  query: z.string().trim().min(1).max(300),
  providers: z.array(z.enum(["wikimedia", "openverse", "pexels", "mock"])).optional(),
}).strict();
const SceneQuery = z.object({
  includeDiscarded: z.enum(["0", "1"]).optional(),
}).strict();
const SearchResponse = SceneVisualsSchema.extend({
  usage: z.object({
    providerRequests: z.number().int().nonnegative(),
    cacheHits: z.number().int().nonnegative(),
  }).strict(),
});
const Errors = {
  400: ApiErrorSchema,
  404: ApiErrorSchema,
  409: ApiErrorSchema,
  503: ApiErrorSchema,
};

export function registerVisualRoutes(
  app: FastifyInstance,
  service: VisualService,
  repository: JobRepository,
): void {
  app.get("/api/projects/:id/visuals", {
    schema: { params: ProjectParams, response: { 200: ProjectVisualsSchema, 404: ApiErrorSchema } },
  }, async (request) => {
    const { id } = ProjectParams.parse(request.params);
    return service.getProjectVisuals(id);
  });

  app.get("/api/projects/:id/scenes/:sceneId/visuals", {
    schema: {
      params: SceneParams,
      querystring: SceneQuery,
      response: { 200: SceneVisualsSchema, 404: ApiErrorSchema },
    },
  }, async (request) => {
    const { id, sceneId } = SceneParams.parse(request.params);
    const { includeDiscarded } = SceneQuery.parse(request.query);
    return service.getSceneVisuals(id, sceneId, includeDiscarded === "1");
  });

  app.post("/api/projects/:id/scenes/:sceneId/visuals/search", {
    schema: {
      params: SceneParams,
      body: SearchBody,
      response: { 200: SearchResponse, ...Errors },
    },
  }, async (request) => {
    const { id, sceneId } = SceneParams.parse(request.params);
    const body = SearchBody.parse(request.body);
    if (repository.getActiveJob(id)) {
      throw new AppError(409, "JOB_ACTIVE", "Visuals cannot be searched while a project job is active.");
    }
    return service.searchScene(id, sceneId, body.query, body.providers);
  });

  app.post("/api/projects/:id/scenes/:sceneId/visuals/select", {
    schema: {
      params: SceneParams,
      body: z.object({ candidateId: z.string().uuid() }).strict(),
      response: { 200: SceneVisualsSchema, ...Errors },
    },
  }, async (request) => {
    const { id, sceneId } = SceneParams.parse(request.params);
    const { candidateId } = z.object({ candidateId: z.string().uuid() }).strict().parse(request.body);
    return service.selectCandidate(id, sceneId, candidateId);
  });

  app.post("/api/projects/:id/scenes/:sceneId/visuals/:candidateId/discard", {
    schema: {
      params: CandidateParams,
      response: { 200: SceneVisualsSchema, ...Errors },
    },
  }, async (request) => {
    const { id, sceneId, candidateId } = CandidateParams.parse(request.params);
    return service.discardCandidate(id, sceneId, candidateId);
  });
}
