import { z } from "zod";
import { AutonomyModeSchema, JobStatusSchema, PipelineStageSchema, ProjectStatusSchema } from "../enums.js";
import { StageStateSchema } from "../pipeline.js";
import { ProjectSchema } from "./project.js";

export const JobErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  retryable: z.boolean(),
});
export type JobError = z.infer<typeof JobErrorSchema>;

export const JobUsageSchema = z.object({
  llmCalls: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
  provider: z.string().optional(),
  model: z.string().optional(),
  tokensUnknown: z.boolean().optional(),
  features: z.record(z.string(), z.number().int().nonnegative()).optional(),
});
export type JobUsage = z.infer<typeof JobUsageSchema>;

export const StageRecordSchema = z.object({
  stage: PipelineStageSchema,
  state: StageStateSchema,
  progress: z.number().min(0).max(100),
  message: z.string().nullable(),
  jobId: z.string().uuid().nullable(),
  updatedAt: z.string().datetime({ offset: true }),
  error: JobErrorSchema.nullable(),
});
export type StageRecord = z.infer<typeof StageRecordSchema>;

export const JobSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  stage: PipelineStageSchema,
  scope: z.string().nullable(),
  status: JobStatusSchema,
  progress: z.number().min(0).max(100),
  message: z.string().nullable(),
  attempt: z.number().int().positive(),
  maxAttempts: z.number().int().positive(),
  error: JobErrorSchema.nullable(),
  usage: JobUsageSchema.nullable(),
  createdAt: z.string().datetime({ offset: true }),
  startedAt: z.string().datetime({ offset: true }).nullable(),
  finishedAt: z.string().datetime({ offset: true }).nullable(),
  runAfter: z.string().datetime({ offset: true }),
});
export type Job = z.infer<typeof JobSchema>;

export const PipelineStateSchema = z.object({
  projectId: z.string().uuid(),
  mode: AutonomyModeSchema,
  runMode: z.enum(["ALL", "SINGLE"]).nullable(),
  currentStage: PipelineStageSchema,
  status: ProjectStatusSchema,
  stages: z.array(StageRecordSchema),
  activeJob: JobSchema.nullable(),
});
export type PipelineState = z.infer<typeof PipelineStateSchema>;

export const JobErrorSummarySchema = z.object({
  jobId: z.string().uuid(),
  projectId: z.string().uuid(),
  projectTitle: z.string(),
  stage: PipelineStageSchema,
  code: z.string(),
  message: z.string(),
  at: z.string().datetime({ offset: true }),
});
export type JobErrorSummary = z.infer<typeof JobErrorSummarySchema>;

export const PipelineEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("job.updated"), projectId: z.string().uuid(), data: JobSchema, at: z.string().datetime({ offset: true }) }),
  z.object({ type: z.literal("stage.updated"), projectId: z.string().uuid(), data: StageRecordSchema, at: z.string().datetime({ offset: true }) }),
  z.object({ type: z.literal("project.updated"), projectId: z.string().uuid(), data: ProjectSchema, at: z.string().datetime({ offset: true }) }),
  z.object({ type: z.literal("heartbeat"), projectId: z.string().uuid(), data: z.null(), at: z.string().datetime({ offset: true }) }),
]);
export type PipelineEvent = z.infer<typeof PipelineEventSchema>;

export const PipelineSnapshotEventSchema = z.object({
  type: z.literal("pipeline.snapshot"),
  projectId: z.string().uuid(),
  data: PipelineStateSchema,
  at: z.string().datetime({ offset: true }),
});
export type PipelineSnapshotEvent = z.infer<typeof PipelineSnapshotEventSchema>;
