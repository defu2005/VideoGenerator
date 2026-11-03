import {
  ApiErrorSchema,
  MergeScenesSchema,
  ReorderScenesSchema,
  ScenePatchSchema,
  ScenePlanSummarySchema,
  SplitSceneSchema,
} from "@vg/shared";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { SceneService } from "../services/sceneService.js";

const ParamsSchema = z.object({ id: z.string().uuid() }).strict();
const SceneParamsSchema = z.object({ id: z.string().uuid(), sceneId: z.string().uuid() }).strict();
const Errors = { 400: ApiErrorSchema, 404: ApiErrorSchema, 409: ApiErrorSchema };

export function registerSceneRoutes(app: FastifyInstance, service: SceneService): void {
  app.get("/api/projects/:id/scenes", {
    schema: { params: ParamsSchema, response: { 200: ScenePlanSummarySchema, 404: ApiErrorSchema } },
  }, async (request) => {
    const { id } = ParamsSchema.parse(request.params);
    return service.get(id);
  });

  app.patch("/api/projects/:id/scenes/:sceneId", {
    schema: {
      params: SceneParamsSchema,
      body: ScenePatchSchema,
      response: { 200: ScenePlanSummarySchema, ...Errors },
    },
  }, async (request) => {
    const { id, sceneId } = SceneParamsSchema.parse(request.params);
    return service.patch(id, sceneId, ScenePatchSchema.parse(request.body));
  });

  app.post("/api/projects/:id/scenes/reorder", {
    schema: {
      params: ParamsSchema,
      body: ReorderScenesSchema,
      response: { 200: ScenePlanSummarySchema, ...Errors },
    },
  }, async (request) => {
    const { id } = ParamsSchema.parse(request.params);
    const { sceneIds } = ReorderScenesSchema.parse(request.body);
    return service.reorder(id, sceneIds);
  });

  app.post("/api/projects/:id/scenes/:sceneId/split", {
    schema: {
      params: SceneParamsSchema,
      body: SplitSceneSchema,
      response: { 200: ScenePlanSummarySchema, ...Errors },
    },
  }, async (request) => {
    const { id, sceneId } = SceneParamsSchema.parse(request.params);
    const { sentenceIndex } = SplitSceneSchema.parse(request.body);
    return service.split(id, sceneId, sentenceIndex);
  });

  app.post("/api/projects/:id/scenes/merge", {
    schema: {
      params: ParamsSchema,
      body: MergeScenesSchema,
      response: { 200: ScenePlanSummarySchema, ...Errors },
    },
  }, async (request) => {
    const { id } = ParamsSchema.parse(request.params);
    const { sceneIds } = MergeScenesSchema.parse(request.body);
    return service.merge(id, sceneIds);
  });

  app.delete("/api/projects/:id/scenes/:sceneId", {
    schema: {
      params: SceneParamsSchema,
      response: { 200: ScenePlanSummarySchema, ...Errors },
    },
  }, async (request) => {
    const { id, sceneId } = SceneParamsSchema.parse(request.params);
    return service.delete(id, sceneId);
  });
}
