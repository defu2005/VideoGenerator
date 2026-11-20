import { z } from "zod";
import { PipelineStageSchema } from "../enums.js";

export const ProjectRunStatusSchema = z.enum(["GRANTED", "RUNNING", "PAUSED_AT_GATE", "DONE", "LOST", "CANCELLED", "FAILED"]);
export const ProjectRunSchema = z.object({
  id: z.string().uuid(), projectId: z.string().uuid(), workspaceId: z.string().min(1), nodeId: z.string().uuid(),
  leaseId: z.string().uuid(), leaseUntil: z.string().datetime({ offset: true }), heartbeatAt: z.string().datetime({ offset: true }),
  status: ProjectRunStatusSchema, fromStage: PipelineStageSchema, stopBefore: z.array(PipelineStageSchema),
  baseVersion: z.string().regex(/^[a-f0-9]{64}$/), lastSeq: z.number().int().nonnegative(),
  budgetCapUsd: z.number().finite().nonnegative(), createdAt: z.string().datetime({ offset: true }),
  endedAt: z.string().datetime({ offset: true }).nullable(), endReason: z.string().nullable(),
}).strict();
export type ProjectRun = z.infer<typeof ProjectRunSchema>;

export const ProjectRunHeartbeatSchema = z.object({ runId: z.string().uuid(), leaseId: z.string().uuid() }).strict();
