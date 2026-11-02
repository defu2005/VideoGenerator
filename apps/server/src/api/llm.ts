import { LlmProviderInfoSchema } from "@vg/shared";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { LlmProviderRegistry } from "../providers/llm/registry.js";
import { ApiErrorSchema } from "@vg/shared";

export function registerLlmRoutes(app: FastifyInstance, registry: LlmProviderRegistry): void {
  app.get("/api/llm/providers", {
    schema: {
      response: { 200: z.array(LlmProviderInfoSchema), 500: ApiErrorSchema },
    },
  }, async () => registry.list());
}
