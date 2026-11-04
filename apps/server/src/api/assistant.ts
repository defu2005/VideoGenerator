import {
  ApiErrorSchema,
  AssistantActionResultSchema,
  AssistantConversationListSchema,
  AssistantConversationSchema,
  AssistantMessagesResponseSchema,
  AssistantSendResponseSchema,
  AssistantSettingsSchema,
  AssistantSettingsUpdateSchema,
  CreateAssistantConversationBodySchema,
  SendAssistantMessageBodySchema,
} from "@vg/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "../lib/errors.js";
import type { AssistantService } from "../assistant/service.js";

const ConversationParamsSchema = z.object({ id: z.string().uuid() }).strict();
const ActionParamsSchema = z.object({ id: z.string().uuid() }).strict();

const ErrorResponses = {
  400: ApiErrorSchema,
  404: ApiErrorSchema,
  409: ApiErrorSchema,
  500: ApiErrorSchema,
  502: ApiErrorSchema,
};

export function registerAssistantRoutes(app: FastifyInstance, assistant: AssistantService): void {
  app.get("/api/assistant/conversations", {
    schema: {
      querystring: z.object({ channel: z.enum(["web", "telegram"]).optional() }).strict(),
      response: { 200: AssistantConversationListSchema, ...ErrorResponses },
    },
  }, async (request) => {
    const { channel } = z.object({ channel: z.enum(["web", "telegram"]).optional() }).strict().parse(request.query);
    return { items: assistant.listConversations(channel) };
  });

  app.post("/api/assistant/conversations", {
    schema: {
      body: CreateAssistantConversationBodySchema,
      response: { 201: AssistantConversationSchema, ...ErrorResponses },
    },
  }, async (request, reply) => {
    const body = CreateAssistantConversationBodySchema.parse(request.body);
    const conversation = assistant.createConversation(body);
    return reply.code(201).send(conversation);
  });

  app.get("/api/assistant/conversations/:id/messages", {
    schema: {
      params: ConversationParamsSchema,
      response: { 200: AssistantMessagesResponseSchema, ...ErrorResponses },
    },
  }, async (request) => {
    const { id } = ConversationParamsSchema.parse(request.params);
    return assistant.listMessages(id);
  });

  app.post("/api/assistant/conversations/:id/messages", {
    schema: {
      params: ConversationParamsSchema,
      body: SendAssistantMessageBodySchema,
      response: { 200: AssistantSendResponseSchema, ...ErrorResponses },
    },
  }, async (request) => {
    const { id } = ConversationParamsSchema.parse(request.params);
    const { text } = SendAssistantMessageBodySchema.parse(request.body);
    try {
      return await assistant.sendMessage(id, text, { logger: request.log });
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw error;
    }
  });

  app.post("/api/assistant/actions/:id/confirm", {
    schema: {
      params: ActionParamsSchema,
      response: { 200: AssistantActionResultSchema, ...ErrorResponses },
    },
  }, async (request) => {
    const { id } = ActionParamsSchema.parse(request.params);
    const action = await assistant.confirmAction(id);
    return { action };
  });

  app.post("/api/assistant/actions/:id/reject", {
    schema: {
      params: ActionParamsSchema,
      response: { 200: AssistantActionResultSchema, ...ErrorResponses },
    },
  }, async (request) => {
    const { id } = ActionParamsSchema.parse(request.params);
    const action = await assistant.rejectAction(id);
    return { action };
  });

  app.post("/api/assistant/conversations/:id/confirm-all", {
    schema: {
      params: ConversationParamsSchema,
      response: {
        200: z.object({ actions: z.array(AssistantActionResultSchema.shape.action) }).strict(),
        ...ErrorResponses,
      },
    },
  }, async (request) => {
    const { id } = ConversationParamsSchema.parse(request.params);
    const actions = await assistant.confirmAll(id);
    return { actions };
  });

  app.get("/api/assistant/settings", {
    schema: {
      response: { 200: AssistantSettingsSchema, ...ErrorResponses },
    },
  }, async () => assistant.getSettings());

  app.put("/api/assistant/settings", {
    schema: {
      body: AssistantSettingsUpdateSchema,
      response: { 200: AssistantSettingsSchema, ...ErrorResponses },
    },
  }, async (request) => assistant.saveSettings(request.body));
}
