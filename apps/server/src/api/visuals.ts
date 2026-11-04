import {
  ApiErrorSchema,
  ProjectVisualsSchema,
  SceneVisualsSchema,
  VisualMotionSchema,
} from "@vg/shared";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { createReadStream } from "node:fs";
import { AppError } from "../lib/errors.js";
import type { JobRepository } from "../jobs/jobRepository.js";
import type { LlmProviderRegistry } from "../providers/llm/registry.js";
import type { VisualService } from "../services/visualService.js";

const ProjectParams = z.object({ id: z.string().uuid() }).strict();
const SceneParams = z.object({ id: z.string().uuid(), sceneId: z.string().uuid() }).strict();
const CandidateParams = SceneParams.extend({ candidateId: z.string().uuid() }).strict();
const SearchBody = z.object({
  query: z.string().trim().min(1).max(300),
  providers: z.array(z.enum(["wikimedia", "openverse", "pexels", "mock"])).optional(),
}).strict();
const CustomUrlBody = z.object({
  url: z.string().url(),
  title: z.string().trim().max(200).optional(),
  author: z.string().trim().max(200).optional(),
  license: z.string().trim().max(300).optional(),
}).strict();
const VisualQueryBody = z.object({
  visualQueries: z.object({ primary: z.string().trim().min(1).max(300), alternatives: z.array(z.string().trim().max(300)).max(3) }).strict().optional(),
  visualDescription: z.string().trim().max(500).optional(),
}).strict().refine((value) => Object.keys(value).length > 0);
const VisualMotionBody = z.object({
  slot: z.number().int().nonnegative().default(0),
  motion: VisualMotionSchema,
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
  413: ApiErrorSchema,
  415: ApiErrorSchema,
  422: ApiErrorSchema,
};

export function registerVisualRoutes(
  app: FastifyInstance,
  service: VisualService,
  repository: JobRepository,
  llmProviders?: LlmProviderRegistry,
): void {
  const ensureNoActiveJob = (projectId: string) => {
    if (repository.getActiveJob(projectId)) {
      throw new AppError(409, "JOB_ACTIVE", "Visuals cannot be changed while a project job is active.");
    }
  };
  const ensureSceneMutationAllowed = (projectId: string, sceneId: string) => {
    service.assertSceneExists(projectId, sceneId);
    ensureNoActiveJob(projectId);
  };

  app.get("/api/projects/:id/visual-files/:file", async (request, reply) => {
    const { id, file } = z.object({ id: z.string().uuid(), file: z.string() }).strict().parse(request.params);
    const localFile = service.getVisualFilePath(id, file);
    return reply.type(localFile.contentType)
      .header("Cache-Control", "private, max-age=86400")
      .send(createReadStream(localFile.path));
  });

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
    ensureSceneMutationAllowed(id, sceneId);
    return service.searchScene(id, sceneId, body.query, body.providers);
  });

  app.post("/api/projects/:id/scenes/:sceneId/visuals/web-search", {
    schema: {
      params: SceneParams,
      response: {
        200: SceneVisualsSchema.extend({
          usage: z.object({
            braveRequests: z.number().int().nonnegative(),
            groundingCalls: z.number().int().nonnegative(),
            groundingModel: z.string().optional(),
            features: z.record(z.string(), z.number()).optional(),
          }).strict(),
        }),
        ...Errors,
      },
    },
  }, async (request) => {
    const { id, sceneId } = SceneParams.parse(request.params);
    ensureSceneMutationAllowed(id, sceneId);
    return service.webSearch(id, sceneId);
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
    ensureSceneMutationAllowed(id, sceneId);
    return await service.selectCandidate(id, sceneId, candidateId);
  });

  app.post("/api/projects/:id/scenes/:sceneId/visuals/:candidateId/discard", {
    schema: {
      params: CandidateParams,
      response: { 200: SceneVisualsSchema, ...Errors },
    },
  }, async (request) => {
    const { id, sceneId, candidateId } = CandidateParams.parse(request.params);
    ensureSceneMutationAllowed(id, sceneId);
    return service.discardCandidate(id, sceneId, candidateId);
  });

  app.post("/api/projects/:id/scenes/:sceneId/visuals/approve", {
    schema: { params: SceneParams, response: { 200: SceneVisualsSchema, ...Errors } },
  }, async (request) => {
    const { id, sceneId } = SceneParams.parse(request.params);
    ensureSceneMutationAllowed(id, sceneId);
    return service.approveScene(id, sceneId);
  });

  app.post("/api/projects/:id/scenes/:sceneId/visuals/reject", {
    schema: { params: SceneParams, response: { 200: SceneVisualsSchema, ...Errors } },
  }, async (request) => {
    const { id, sceneId } = SceneParams.parse(request.params);
    ensureSceneMutationAllowed(id, sceneId);
    return service.rejectSceneVisual(id, sceneId);
  });

  app.post("/api/projects/:id/scenes/:sceneId/visuals/custom-url", {
    schema: {
      params: SceneParams,
      body: CustomUrlBody,
      response: { 200: SceneVisualsSchema, ...Errors },
    },
  }, async (request) => {
    const { id, sceneId } = SceneParams.parse(request.params);
    ensureSceneMutationAllowed(id, sceneId);
    return service.addCustomUrl(id, sceneId, CustomUrlBody.parse(request.body));
  });

  app.post("/api/projects/:id/scenes/:sceneId/visuals/upload", {
    schema: { params: SceneParams, response: { 200: SceneVisualsSchema, ...Errors } },
  }, async (request) => {
    const { id, sceneId } = SceneParams.parse(request.params);
    ensureSceneMutationAllowed(id, sceneId);
    if (!Buffer.isBuffer(request.body)) {
      throw new AppError(422, "IMAGE_UPLOAD_INVALID", "Upload body must contain raw image bytes.");
    }
    const fileName = request.headers["x-file-name"];
    const name = Array.isArray(fileName) ? fileName[0] : fileName;
    const contentType = request.headers["content-type"]?.split(";")[0]?.trim() ?? "";
    return service.addUpload(id, sceneId, request.body, name, contentType);
  });

  app.post("/api/projects/:id/scenes/:sceneId/visuals/remove", {
    schema: { params: SceneParams, response: { 200: SceneVisualsSchema, ...Errors } },
  }, async (request) => {
    const { id, sceneId } = SceneParams.parse(request.params);
    ensureSceneMutationAllowed(id, sceneId);
    return service.removeSceneVisual(id, sceneId);
  });

  app.post("/api/projects/:id/visuals/approve-all", {
    schema: {
      params: ProjectParams,
      response: { 200: z.object({
        approved: z.number().int().nonnegative(),
        failed: z.array(z.object({ sceneId: z.string().uuid(), reason: z.string(), retryable: z.boolean() }).strict()),
      }).strict(), ...Errors },
    },
  }, async (request) => {
    const { id } = ProjectParams.parse(request.params);
    ensureNoActiveJob(id);
    return service.approveAll(id);
  });

  app.patch("/api/projects/:id/scenes/:sceneId/visuals/query", {
    schema: { params: SceneParams, body: VisualQueryBody, response: { 200: SceneVisualsSchema, ...Errors } },
  }, async (request) => {
    const { id, sceneId } = SceneParams.parse(request.params);
    ensureSceneMutationAllowed(id, sceneId);
    return service.patchSceneVisualQuery(id, sceneId, VisualQueryBody.parse(request.body));
  });

  app.patch("/api/projects/:id/scenes/:sceneId/visuals/motion", {
    schema: { params: SceneParams, body: VisualMotionBody, response: { 200: SceneVisualsSchema, ...Errors } },
  }, async (request) => {
    const { id, sceneId } = SceneParams.parse(request.params);
    ensureSceneMutationAllowed(id, sceneId);
    const body = VisualMotionBody.parse(request.body);
    return service.setSelectionMotion(id, sceneId, body.slot, body.motion);
  });

  app.post("/api/projects/:id/scenes/:sceneId/visuals/:candidateId/vision-check", {
    schema: {
      params: CandidateParams,
      response: {
        200: z.object({
          candidate: z.unknown(),
          usage: z.unknown(),
          estimate: z.object({ calls: z.number(), images: z.number() }).strict(),
        }).strict(),
        ...Errors,
      },
    },
  }, async (request) => {
    if (!llmProviders) {
      throw new AppError(503, "LLM_NOT_CONFIGURED", "LLM providers are not available.");
    }
    const { id, sceneId, candidateId } = CandidateParams.parse(request.params);
    ensureSceneMutationAllowed(id, sceneId);
    return service.visionCheckCandidate(id, sceneId, candidateId, llmProviders);
  });
}
