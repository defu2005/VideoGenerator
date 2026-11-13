import { z } from "zod";
import type { FastifyInstance } from "fastify";
import Database from "better-sqlite3";

const HealthResponseSchema = z.object({
  status: z.literal("ok"),
  version: z.string(),
  db: z.literal("ok"),
  renderRunning: z.number().int().nonnegative(),
  renderConcurrency: z.number().int().positive(),
  render: z.string(),
});

export function renderActivityLabel(running: number, limit: number): string {
  return `render: ${running}/${limit} đang chạy`;
}

export function buildHealthReport(sqlite: InstanceType<typeof Database>, renderConcurrency: number) {
  sqlite.prepare("SELECT 1").get();
  const renderRunning = (sqlite.prepare(
    "SELECT COUNT(*) AS count FROM jobs WHERE stage = 'RENDER' AND status = 'RUNNING'",
  ).get() as { count: number }).count;
  return {
    status: "ok" as const,
    version: "0.1.0",
    db: "ok" as const,
    renderRunning,
    renderConcurrency,
    render: renderActivityLabel(renderRunning, renderConcurrency),
  };
}

export function registerHealthRoutes(app: FastifyInstance, sqlite: InstanceType<typeof Database>, renderConcurrency = 1): void {
  app.get("/api/health", {
    schema: {
      response: { 200: HealthResponseSchema },
    },
  }, async () => buildHealthReport(sqlite, renderConcurrency));
}
