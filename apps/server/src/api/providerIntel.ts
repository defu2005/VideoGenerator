import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ProviderIntelService } from "../providerIntel/service.js";
import type Database from "better-sqlite3";
import type { AppConfig } from "../lib/config.js";
import type { LlmProviderRegistry } from "../providers/llm/registry.js";
import { CompareModelsInput, compareModels } from "../providerIntel/compareModels.js";

const ChecklistSchema = z.object({
  path: z.string().min(1).max(120),
  value: z.union([z.boolean(), z.string().min(1).max(200)]),
}).strict();

const ApplySchema = z.object({ proposalId: z.string().min(1) }).strict();

const ComboSchema = z.object({
  profiles: z.array(z.object({ id: z.string(), models: z.array(z.string()) }).strict()),
  retestIds: z.array(z.string()).optional(),
}).strict();

const FeedsSchema = z.object({
  feeds: z.array(z.object({ url: z.string().url(), label: z.string().min(1).max(80) }).strict()).max(20),
}).strict();

const EvalSchema = z.object({
  suiteIds: z.array(z.string()).min(1),
  modelIds: z.array(z.string()).min(1),
  models: z.array(z.object({
    id: z.string(),
    paid: z.boolean(),
    cookie: z.boolean(),
    quotaLeft: z.union([z.number(), z.literal("UNKNOWN"), z.literal("exhausted")]),
  }).strict()).min(1),
  approved: z.boolean().optional(),
  remainingRatio: z.number().optional(),
}).strict();

export function registerProviderIntelRoutes(app: FastifyInstance, intel: ProviderIntelService, deps: {
  sqlite: Database.Database;
  registry: LlmProviderRegistry;
  config: AppConfig;
}): void {
  app.get("/api/provider-intel/page", async () => intel.page());
  app.get("/api/provider-intel/summary", async () => intel.summary());

  app.post("/api/provider-intel/providers/:id/checklist", async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = ChecklistSchema.parse(request.body);
    return intel.setChecklist(params.id, body.path, body.value);
  });

  app.post("/api/provider-intel/routing/apply", async (request) => {
    const body = ApplySchema.parse(request.body);
    return intel.applyProposal(body.proposalId);
  });

  app.post("/api/provider-intel/omniroute/update", async (request) => {
    const body = ComboSchema.parse(request.body);
    return intel.updateCombos(body.profiles, body.retestIds ?? []);
  });

  app.post("/api/provider-intel/changes/:id/reviewed", async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    return intel.markChangeReviewed(params.id);
  });

  app.put("/api/provider-intel/feeds", async (request) => {
    const body = FeedsSchema.parse(request.body);
    return { feeds: intel.saveFeeds(body.feeds) };
  });

  app.post("/api/provider-intel/audit", async () => intel.audit());

  app.post("/api/provider-intel/eval", async (request) => {
    const body = EvalSchema.parse(request.body);
    return intel.runEval(body);
  });

  app.post("/api/provider-intel/eval/compare", async (request) =>
    compareModels(deps.sqlite, deps.registry, deps.config, CompareModelsInput.parse(request.body)));

  app.get("/api/provider-intel/eval/:id", async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    return intel.getEvalRun(id);
  });
}
