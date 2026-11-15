import { z } from "zod";
import { KnowledgeKindSchema } from "../knowledge/schema.js";

const limit = z.number().int().min(0).max(10_000);
export const SelfImprovementBudgetSchema = z.object({
  researchRuns: limit.default(3), llmCalls: limit.default(40), webFetches: limit.default(60),
  skillDrafts: limit.default(3), behaviourEvals: limit.default(10), improvementRequests: limit.default(10),
}).strict();
export type SelfImprovementBudget = z.infer<typeof SelfImprovementBudgetSchema>;
export type SelfImprovementCounter = keyof SelfImprovementBudget;
export const SELF_IMPROVEMENT_DEFAULTS = SelfImprovementBudgetSchema.parse({});
export const ResearchSkillMetadataSchema = z.object({
  kind: z.literal("research"), question: z.string().trim().min(1).max(1000),
  outputKinds: z.array(KnowledgeKindSchema).min(1),
  sources: z.array(z.string().regex(/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/)).default([]),
  maxPages: z.number().int().min(1).max(30).default(15),
});
export type ResearchSkillMetadata = z.infer<typeof ResearchSkillMetadataSchema>;
export const ResearchTriggerSchema = z.enum(["stale", "change_event", "user", "schedule", "improvement"]);
export const SelfImprovementSettingsSchema = z.object({
  budget: SelfImprovementBudgetSchema.default(SELF_IMPROVEMENT_DEFAULTS),
  maxPages: z.number().int().min(1).max(100).default(30),
  automaticResearch: z.boolean().default(true), eco: z.boolean().default(false),
  runtime: z.string().regex(/^[a-z0-9-]{1,60}$/).default("model"),
}).strict();
export type SelfImprovementSettings = z.infer<typeof SelfImprovementSettingsSchema>;
