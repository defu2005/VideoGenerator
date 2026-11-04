import {
  ApiErrorSchema,
  ApproveTopicsBodySchema,
  AutomationPausedSchema,
  AutomationStatusSchema,
  ProfileAutomationViewSchema,
  ProfileTopicInputSchema,
  ProfileTopicSchema,
  ProfileTopicUpdateSchema,
  ReorderTopicsBodySchema,
  SuggestTopicsBodySchema,
  SuggestTopicsResponseSchema,
  TopicListQuerySchema,
  TopicListResponseSchema,
} from "@vg/shared";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { AutomationService } from "../services/automationService.js";
import type { TopicService } from "../services/topicService.js";
import { getAutomationPaused, setAutomationPaused } from "../services/automationSettings.js";
import type Database from "better-sqlite3";

const ProfileParamsSchema = z.object({ id: z.string().uuid() }).strict();
const TopicParamsSchema = z.object({
  id: z.string().uuid(),
  topicId: z.string().uuid(),
}).strict();

const ErrorResponses = {
  400: ApiErrorSchema,
  404: ApiErrorSchema,
  409: ApiErrorSchema,
  500: ApiErrorSchema,
};

export function registerAutomationRoutes(
  app: FastifyInstance,
  deps: {
    topics: TopicService;
    automation: AutomationService;
    sqlite: Database.Database;
  },
): void {
  app.get("/api/settings/automation", {
    schema: {
      response: { 200: AutomationPausedSchema, ...ErrorResponses },
    },
  }, async () => ({ paused: getAutomationPaused(deps.sqlite) }));

  app.put("/api/settings/automation", {
    schema: {
      body: AutomationPausedSchema,
      response: { 200: AutomationPausedSchema, ...ErrorResponses },
    },
  }, async (request) => {
    const body = AutomationPausedSchema.parse(request.body);
    return setAutomationPaused(deps.sqlite, body.paused);
  });

  app.get("/api/automation/status", {
    schema: {
      response: { 200: AutomationStatusSchema, ...ErrorResponses },
    },
  }, async () => deps.automation.getStatus());

  app.get("/api/profiles/:id/automation", {
    schema: {
      params: ProfileParamsSchema,
      response: { 200: ProfileAutomationViewSchema, ...ErrorResponses },
    },
  }, async (request) => {
    const { id } = ProfileParamsSchema.parse(request.params);
    return deps.automation.getProfileView(id);
  });

  app.get("/api/profiles/:id/topics", {
    schema: {
      params: ProfileParamsSchema,
      querystring: TopicListQuerySchema,
      response: { 200: TopicListResponseSchema, ...ErrorResponses },
    },
  }, async (request) => {
    const { id } = ProfileParamsSchema.parse(request.params);
    return deps.topics.listTopics(id, TopicListQuerySchema.parse(request.query));
  });

  app.post("/api/profiles/:id/topics", {
    schema: {
      params: ProfileParamsSchema,
      body: ProfileTopicInputSchema,
      response: { 201: ProfileTopicSchema, ...ErrorResponses },
    },
  }, async (request, reply) => {
    const { id } = ProfileParamsSchema.parse(request.params);
    const topic = await deps.topics.addTopic(id, ProfileTopicInputSchema.parse(request.body));
    return reply.code(201).send(topic);
  });

  app.patch("/api/profiles/:id/topics/:topicId", {
    schema: {
      params: TopicParamsSchema,
      body: ProfileTopicUpdateSchema,
      response: { 200: ProfileTopicSchema, ...ErrorResponses },
    },
  }, async (request) => {
    const { id, topicId } = TopicParamsSchema.parse(request.params);
    return deps.topics.updateTopic(id, topicId, ProfileTopicUpdateSchema.parse(request.body));
  });

  app.post("/api/profiles/:id/topics/approve", {
    schema: {
      params: ProfileParamsSchema,
      body: ApproveTopicsBodySchema,
      response: { 200: TopicListResponseSchema, ...ErrorResponses },
    },
  }, async (request) => {
    const { id } = ProfileParamsSchema.parse(request.params);
    return deps.topics.approveTopics(id, ApproveTopicsBodySchema.parse(request.body));
  });

  app.post("/api/profiles/:id/topics/reorder", {
    schema: {
      params: ProfileParamsSchema,
      body: ReorderTopicsBodySchema,
      response: { 200: TopicListResponseSchema, ...ErrorResponses },
    },
  }, async (request) => {
    const { id } = ProfileParamsSchema.parse(request.params);
    return deps.topics.reorderTopics(id, ReorderTopicsBodySchema.parse(request.body));
  });

  app.post("/api/profiles/:id/topics/suggest", {
    schema: {
      params: ProfileParamsSchema,
      body: SuggestTopicsBodySchema,
      response: { 200: SuggestTopicsResponseSchema, ...ErrorResponses },
    },
  }, async (request) => {
    const { id } = ProfileParamsSchema.parse(request.params);
    return deps.topics.suggestTopics(id, SuggestTopicsBodySchema.parse(request.body));
  });
}
