import { z } from "zod";

export const AGENT_EVENT_TYPES = [
  "stage_started",
  "stage_finished",
  "stage_failed",
  "waiting_approval",
  "quota_wait",
  "budget_wait",
  "render_finished",
  "published",
  "publish_failed",
  "needs_user",
  "supervisor_finding",
  "capacity_idle",
  "ping",
  "hermes.duty_lost",
  "hermes.duty_taken",
  "lease.preempted",
  "escalation.opened",
] as const;

export type AgentEventType = (typeof AGENT_EVENT_TYPES)[number];

export type AgentEvent = {
  id: string;
  type: AgentEventType;
  version: 1;
  at: string;
  projectId?: string;
  projectTitle?: string;
  stage?: string;
  gate?: string;
  retryAt?: string;
  link: string;
  summary: string;
};

export const AgentEventSchema = z.object({
  id: z.string().min(1),
  type: z.enum(AGENT_EVENT_TYPES),
  version: z.literal(1),
  at: z.string().min(1),
  projectId: z.string().optional(),
  projectTitle: z.string().optional(),
  stage: z.string().optional(),
  gate: z.string().optional(),
  retryAt: z.string().optional(),
  link: z.string(),
  summary: z.string(),
}).strict();
