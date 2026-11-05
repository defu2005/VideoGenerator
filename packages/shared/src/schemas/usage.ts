import { z } from "zod";
import { JobStatusSchema, PipelineStageSchema } from "../enums.js";

export const UsageTotalsSchema = z.object({
  llmCalls: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cachedCalls: z.number().int().nonnegative(),
  fallbackCalls: z.number().int().nonnegative(),
  failedCalls: z.number().int().nonnegative(),
  premiumRequests: z.number().int().nonnegative(),
  tokensUnknown: z.boolean(),
  costUsd: z.number().nonnegative(),
}).strict();
export type UsageTotals = z.infer<typeof UsageTotalsSchema>;

export const UsageBucketSchema = UsageTotalsSchema.extend({
  key: z.string(),
  label: z.string(),
});
export type UsageBucket = z.infer<typeof UsageBucketSchema>;

export const UsageCallSummarySchema = z.object({
  task: z.string(),
  provider: z.string(),
  model: z.string(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  premiumRequests: z.number().int().nonnegative(),
  callCount: z.number().int().nonnegative(),
  cached: z.boolean(),
  fallback: z.boolean(),
  fallbackReason: z.literal("quota").optional(),
  ok: z.boolean(),
  tokensUnknown: z.boolean(),
  costUsd: z.number().nonnegative(),
  characters: z.number().int().nonnegative().optional(),
}).strict();
export type UsageCallSummary = z.infer<typeof UsageCallSummarySchema>;

export const ProjectUsageRunSchema = z.object({
  jobId: z.string().uuid(),
  stage: PipelineStageSchema,
  scope: z.string().nullable(),
  attempt: z.number().int().positive(),
  status: JobStatusSchema,
  startedAt: z.string().datetime({ offset: true }).nullable(),
  finishedAt: z.string().datetime({ offset: true }).nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  tokens: z.object({
    input: z.number().int().nonnegative(),
    output: z.number().int().nonnegative(),
    unknown: z.boolean(),
  }).strict(),
  totals: UsageTotalsSchema,
  calls: z.array(UsageCallSummarySchema),
}).strict();
export type ProjectUsageRun = z.infer<typeof ProjectUsageRunSchema>;

export const ProjectUsageSchema = z.object({
  projectId: z.string().uuid(),
  usdVndRate: z.number().positive(),
  totals: UsageTotalsSchema,
  byStage: z.array(UsageBucketSchema),
  byTask: z.array(UsageBucketSchema),
  byModel: z.array(UsageBucketSchema),
  runs: z.array(ProjectUsageRunSchema),
}).strict();
export type ProjectUsage = z.infer<typeof ProjectUsageSchema>;

export const UsageGroupBySchema = z.enum(["day", "provider", "model", "project"]);
export type UsageGroupBy = z.infer<typeof UsageGroupBySchema>;

const DateQuerySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Expected a valid calendar date");

export const UsageQuerySchema = z.object({
  from: DateQuerySchema.optional(),
  to: DateQuerySchema.optional(),
  groupBy: UsageGroupBySchema.default("provider"),
}).strict().refine((value) => !value.from || !value.to || value.from <= value.to, {
  path: ["to"],
  message: "'to' must be on or after 'from'",
});
export type UsageQuery = z.infer<typeof UsageQuerySchema>;

export const UsageProjectSummarySchema = z.object({
  projectId: z.string().uuid(),
  projectTitle: z.string(),
  totals: UsageTotalsSchema,
}).strict();

export const AppUsageSchema = z.object({
  from: DateQuerySchema.nullable(),
  to: DateQuerySchema.nullable(),
  groupBy: UsageGroupBySchema,
  usdVndRate: z.number().positive(),
  totals: UsageTotalsSchema,
  byGroup: z.array(UsageBucketSchema),
  topProjects: z.array(UsageProjectSummarySchema),
}).strict();
export type AppUsage = z.infer<typeof AppUsageSchema>;
