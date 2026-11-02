import { ApiErrorSchema, SaveScriptInputSchema, ScriptDataSchema } from "@vg/shared";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { ScriptService } from "../services/scriptService.js";

const ParamsSchema = z.object({ id: z.string().uuid() }).strict();

export function registerScriptRoutes(app: FastifyInstance, service: ScriptService): void {
  app.get("/api/projects/:id/script", {
    schema: {
      params: ParamsSchema,
      response: { 200: ScriptDataSchema, 404: ApiErrorSchema },
    },
  }, async (request) => {
    const { id } = ParamsSchema.parse(request.params);
    return service.get(id);
  });

  app.put("/api/projects/:id/script", {
    schema: {
      params: ParamsSchema,
      body: SaveScriptInputSchema,
      response: { 200: ScriptDataSchema, 400: ApiErrorSchema, 404: ApiErrorSchema, 409: ApiErrorSchema },
    },
  }, async (request) => {
    const { id } = ParamsSchema.parse(request.params);
    return service.save(id, SaveScriptInputSchema.parse(request.body));
  });
}
