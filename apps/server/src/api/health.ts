import { z } from "zod";
import type { FastifyInstance } from "fastify";
import Database from "better-sqlite3";

const HealthResponseSchema = z.object({
  status: z.literal("ok"),
  version: z.string(),
  db: z.literal("ok"),
});

export function registerHealthRoutes(app: FastifyInstance, sqlite: InstanceType<typeof Database>): void {
  app.get("/api/health", {
    schema: {
      response: { 200: HealthResponseSchema },
    },
  }, async () => {
    sqlite.prepare("SELECT 1").get();
    return { status: "ok", version: "0.1.0", db: "ok" };
  });
}
