import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { CreateTranslationBodySchema } from "@vg/shared";
import type { TranslationService } from "../translations/translationService.js";

const IdParams = z.object({ id: z.string().uuid() }).strict();
const ChildParams = z.object({
  id: z.string().uuid(),
  childId: z.string().uuid(),
}).strict();

export function registerTranslationRoutes(app: FastifyInstance, translations: TranslationService): void {
  app.get("/api/projects/:id/translations", async (request) => {
    const { id } = IdParams.parse(request.params);
    return translations.view(id);
  });

  app.post("/api/projects/:id/translations", async (request) => {
    const { id } = IdParams.parse(request.params);
    const body = CreateTranslationBodySchema.parse(request.body);
    return translations.start(id, body.language, request.signal);
  });

  app.post("/api/projects/:id/translations/:childId/approve", async (request) => {
    const { childId } = ChildParams.parse(request.params);
    return translations.approve(childId, request.signal);
  });
}
