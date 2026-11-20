import { z } from "zod";

export const AGENT_EVENT_TYPES = [
  "stage_started",
  "stage_handoff",
  "stage_claimed",
  "stage_completed_by_agent",
  "stage_released",
  "stage_finished",
  "stage_failed",
  "waiting_approval",
  "quota_wait",
  "budget_wait",
  "render_finished",
  "mission_created",
  "mission_state_changed",
  "mission_owner_changed",
  "published",
  "publish_failed",
  "needs_user",
  "supervisor_finding",
  "capacity_idle",
  "ping",
  "hermes.duty_lost",
  "hermes.duty_watchdog",
  "hermes.duty_taken",
  "lease.preempted",
  "escalation.opened",
  // Event coverage (TASK-129a §1): analytics sync finished for one account.
  "analytics_synced",
  // TASK-129a §1: an overdue check was recorded for a running stage; quality repair ran out of options.
  "stage_overdue",
  "repair_exhausted",
  "repair_started",
  "publish_scheduled",
  "quota_failover",
  "node_online",
  "node_offline",
  // TASK-129a step 3: mailbox. Summaries carry sender and kind only, never the body.
  "agent.message",
  "agent.question_escalated",
] as const;

export type AgentEventType = (typeof AGENT_EVENT_TYPES)[number];

/** Mailbox events reach webhooks only through per-subscription routing, never the generic bus fan-out. */
export const MAILBOX_EVENT_TYPES: readonly AgentEventType[] = ["agent.message", "agent.question_escalated"];

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
