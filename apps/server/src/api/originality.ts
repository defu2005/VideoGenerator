import { ApiErrorSchema, OriginalityReportSchema } from "@vg/shared";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { OriginalityService } from "../originality/service.js";

export function registerOriginalityRoutes(app: FastifyInstance, sqlite: Database.Database): void {
  const service = new OriginalityService(sqlite);
  const schema = { params: z.object({ id: z.string().uuid() }).strict(), response: { 200: OriginalityReportSchema, 404: ApiErrorSchema } };
  app.get("/api/projects/:id/originality", { schema }, async (request) => service.get(schema.params.parse(request.params).id));
  app.post("/api/projects/:id/originality/recheck", { schema }, async (request) => service.recheck(schema.params.parse(request.params).id));
}
