import {
  ApiErrorSchema,
  ApplyInsightBodySchema,
  DismissInsightBodySchema,
  InsightRunResultSchema,
  LearningSettingsBodySchema,
  LearningViewSchema,
  ProfileInsightSchema,
} from "@vg/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { LearningService } from "../learning/learningService.js";

const ErrorResponses = {
  400: ApiErrorSchema,
  404: ApiErrorSchema,
  409: ApiErrorSchema,
  429: ApiErrorSchema,
  500: ApiErrorSchema,
  502: ApiErrorSchema,
};

const ProfileParams = z.object({ id: z.string().uuid() }).strict();
const InsightParams = z.object({
  id: z.string().uuid(),
  insightId: z.string().uuid(),
}).strict();

export function registerLearningRoutes(app: FastifyInstance, learning: LearningService): void {
  app.get("/api/profiles/:id/learning", {
    schema: {
      params: ProfileParams,
      response: { 200: LearningViewSchema, ...ErrorResponses },
    },
  }, async (request) => {
    const { id } = ProfileParams.parse(request.params);
    return learning.getView(id);
  });

  app.put("/api/profiles/:id/learning/settings", {
    schema: {
      params: ProfileParams,
      body: LearningSettingsBodySchema,
      response: { 200: LearningViewSchema, ...ErrorResponses },
    },
  }, async (request) => {
    const { id } = ProfileParams.parse(request.params);
    return learning.saveSettings(id, LearningSettingsBodySchema.parse(request.body));
  });

  app.post("/api/profiles/:id/learning/run", {
    schema: {
      params: ProfileParams,
      response: { 200: InsightRunResultSchema, ...ErrorResponses },
    },
  }, async (request) => {
    const { id } = ProfileParams.parse(request.params);
    return learning.run(id, "manual");
  });

  app.post("/api/profiles/:id/learning/undo", {
    schema: {
      params: ProfileParams,
      response: { 200: LearningViewSchema, ...ErrorResponses },
    },
  }, async (request) => {
    const { id } = ProfileParams.parse(request.params);
    return learning.undo(id);
  });

  app.post("/api/profiles/:id/insights/:insightId/apply", {
    schema: {
      params: InsightParams,
      body: ApplyInsightBodySchema,
      response: { 200: ProfileInsightSchema, ...ErrorResponses },
    },
  }, async (request) => {
    const { id, insightId } = InsightParams.parse(request.params);
    const body = ApplyInsightBodySchema.parse(request.body);
    return learning.apply(id, insightId, body.fields);
  });

  app.post("/api/profiles/:id/insights/:insightId/dismiss", {
    schema: {
      params: InsightParams,
      body: DismissInsightBodySchema,
      response: { 200: ProfileInsightSchema, ...ErrorResponses },
    },
  }, async (request) => {
    const { id, insightId } = InsightParams.parse(request.params);
    const body = DismissInsightBodySchema.parse(request.body ?? {});
    return learning.dismiss(id, insightId, body.fields);
  });
}
