import { LlmProviderInfoSchema } from "@vg/shared";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import type { LlmProviderRegistry } from "../providers/llm/registry.js";
import { ApiErrorSchema, JobUsageSchema } from "@vg/shared";

export function registerLlmRoutes(app: FastifyInstance, registry: LlmProviderRegistry, sqlite: Database.Database): void {
  app.get("/api/llm/providers", {
    schema: {
      response: { 200: z.array(LlmProviderInfoSchema), 500: ApiErrorSchema },
    },
  }, async () => registry.list(getProviderMonthCalls(sqlite)));
}

export function getProviderMonthCalls(sqlite: Database.Database, now = new Date()): Map<string, number> {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
  const rows = sqlite.prepare(
    "SELECT usage FROM jobs WHERE created_at >= ? AND created_at < ? AND usage IS NOT NULL",
  ).all(monthStart, nextMonth) as Array<{ usage: string }>;
  const calls = new Map<string, number>();
  for (const row of rows) {
    const usage = JobUsageSchema.parse(JSON.parse(row.usage) as unknown);
    if (!usage.provider) continue;
    calls.set(usage.provider, (calls.get(usage.provider) ?? 0) + usage.llmCalls);
  }
  return calls;
}
