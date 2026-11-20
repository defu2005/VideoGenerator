import { z } from "zod";
import { PipelineStageSchema } from "../enums.js";

export const AgentAssignmentInputSchema = z.object({
  instance: z.string().trim().regex(/^(?:\*|[a-z][a-z0-9_-]{0,19}\/[a-zA-Z0-9 ._-]{1,64})$/),
  role: z.string().trim().min(1).max(80),
  profileId: z.string().uuid().nullable().default(null),
  projectId: z.string().uuid().nullable().default(null),
  stage: PipelineStageSchema.nullable().default(null),
  maxConcurrent: z.number().int().min(1).max(100).default(1),
  active: z.boolean().default(true),
}).strict();

export const AgentAssignmentSchema = AgentAssignmentInputSchema.extend({
  id: z.string().uuid(),
  createdBy: z.string().min(1),
});

export type AgentAssignment = z.infer<typeof AgentAssignmentSchema>;
