// TASK-085: tables for the operator domain. Re-exported by ./index.ts; import from "db/schema.js" as before.
import { sql } from "drizzle-orm";
import { integer, index, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { apikey, user } from "./auth.js";
import { webhookEndpoints } from "./misc.js";
import { projects } from "./pipeline.js";
import { profiles } from "./profiles.js";

export const assistantConversations = sqliteTable("assistant_conversations", {
  workspaceId: text("workspace_id"),
  id: text("id").primaryKey(),
  channel: text("channel", { enum: ["web", "telegram"] }).notNull(),
  title: text("title").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("assistant_conversations_workspace_idx").on(table.workspaceId),
]);

export const assistantMessages = sqliteTable("assistant_messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull().references(() => assistantConversations.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["user", "assistant", "tool"] }).notNull(),
  content: text("content", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("assistant_messages_conversation_idx").on(table.conversationId),
]);

export const assistantPendingActions = sqliteTable("assistant_pending_actions", {
  workspaceId: text("workspace_id"),
  actorUserId: text("actor_user_id"),
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull().references(() => assistantConversations.id, { onDelete: "cascade" }),
  tool: text("tool").notNull(),
  args: text("args", { mode: "json" }).$type<unknown>().notNull(),
  summary: text("summary").notNull(),
  status: text("status", {
    enum: ["pending", "confirmed", "rejected", "expired", "failed"],
  }).notNull(),
  result: text("result", { mode: "json" }).$type<unknown | null>(),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
}, (table) => [
  index("assistant_pending_actions_workspace_idx").on(table.workspaceId),
  index("assistant_pending_actions_conversation_idx").on(table.conversationId),
]);

/** Cursor operator chats (TASK-047). Separate from the built-in assistant. */
export const operatorConversations = sqliteTable("operator_conversations", {
  workspaceId: text("workspace_id"),
  id: text("id").primaryKey(),
  channel: text("channel", { enum: ["web", "telegram"] }).notNull(),
  title: text("title").notNull(),
  cursorChatId: text("cursor_chat_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("operator_conversations_workspace_idx").on(table.workspaceId),
]);

export const operatorRuns = sqliteTable("operator_runs", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull().references(() => operatorConversations.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  status: text("status").notNull(),
  prompt: text("prompt").notNull(),
  result: text("result"),
  partialText: text("partial_text").notNull().default(""),
  toolChips: text("tool_chips", { mode: "json" }).$type<string[]>().notNull(),
  model: text("model"),
  runtimeId: text("runtime_id"),
  workflowId: text("workflow_id"),
  error: text("error"),
  outcome: text("outcome"),
  origin: text("origin").notNull(),
  dayKey: text("day_key").notNull(),
  pendingActionIds: text("pending_action_ids", { mode: "json" }).$type<string[]>().notNull(),
  startedAt: text("started_at"),
  finishedAt: text("finished_at"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("operator_runs_conversation_idx").on(table.conversationId, table.createdAt),
  index("operator_runs_day_idx").on(table.dayKey),
  index("operator_runs_workflow_idx").on(table.workflowId),
]);

export const operatorCheckpoints = sqliteTable("operator_checkpoints", {
  workflowId: text("workflow_id").notNull().references(() => operatorRuns.id, { onDelete: "cascade" }),
  actionKey: text("action_key").notNull(),
  tool: text("tool").notNull(),
  receipt: text("receipt"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.workflowId, table.actionKey] }),
]);

export const operatorToolProposals = sqliteTable("operator_tool_proposals", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  details: text("details").notNull(),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("operator_tool_proposals_status_idx").on(table.status, table.createdAt),
]);

/** TASK-074c-1: one table for every improvement request. Tool requests are copied from operator_tool_proposals. */
export const improvementRequests = sqliteTable("improvement_requests", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  problem: text("problem").notNull(),
  proposal: text("proposal").notNull(),
  evidence: text("evidence").notNull(),
  acceptance: text("acceptance").notNull(),
  dataVsCode: text("data_vs_code"),
  expectedImpact: text("expected_impact"),
  effort: text("effort"),
  risk: text("risk"),
  openSource: text("open_source"),
  status: text("status").notNull(),
  weight: integer("weight").notNull().default(1),
  fingerprint: text("fingerprint").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  // TASK-074c-4b-3a: IMP number is assigned once to an accepted tool row; drafted_at stays null until a draft is written.
  impNumber: integer("imp_number"),
  draftedAt: text("drafted_at"),
  // TASK-074c-6e: the TASK-… name the user confirmed with a .done file. Set only together with status 'done'.
  taskRef: text("task_ref"),
  // TASK-074c-5e: when check-done moved the row to done (same UPDATE, same timestamp). NULL unless set by check-done.
  doneAt: text("done_at"),
  // TASK-074c-5e-2a-1: stored result of the acceptance check (JSON array of verdicts) and when it was written. NULL until recorded.
  acceptanceResult: text("acceptance_result"),
  acceptanceCheckedAt: text("acceptance_checked_at"),
}, (table) => [
  index("improvement_requests_status_idx").on(table.status, table.createdAt),
  index("improvement_requests_fingerprint_idx").on(table.fingerprint, table.status),
  uniqueIndex("improvement_requests_imp_number_idx").on(table.impNumber),
]);

export const operatorEvents = sqliteTable("operator_events", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  profileId: text("profile_id"),
  projectId: text("project_id"),
  jobId: text("job_id"),
  pendingId: text("pending_id"),
  runId: text("run_id"),
  wakeRunId: text("wake_run_id"),
  telegramSentAt: text("telegram_sent_at"),
  detail: text("detail"),
  occurredAt: text("occurred_at").notNull(),
}, (table) => [
  index("operator_events_time_idx").on(table.occurredAt),
]);

export const operatorSkillVersions = sqliteTable("operator_skill_versions", {
  name: text("name").notNull(),
  version: integer("version").notNull(),
  markdown: text("markdown").notNull(),
  evidence: text("evidence").notNull(),
  score: integer("score").notNull(),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.name, table.version] }),
]);

export const operatorMessages = sqliteTable("operator_messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull().references(() => operatorConversations.id, { onDelete: "cascade" }),
  runId: text("run_id"),
  role: text("role", { enum: ["user", "assistant", "system"] }).notNull(),
  content: text("content", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("operator_messages_conversation_idx").on(table.conversationId, table.createdAt),
]);

/** One row per find_skills / find_tools / run routing decision (TASK-047). */
export const operatorRoutingLog = sqliteTable("operator_routing_log", {
  id: text("id").primaryKey(),
  query: text("query").notNull(),
  candidates: text("candidates", { mode: "json" }).$type<unknown>().notNull(),
  picked: text("picked", { mode: "json" }).$type<unknown>().notNull(),
  runId: text("run_id"),
  outcome: text("outcome"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("operator_routing_log_created_idx").on(table.createdAt),
  index("operator_routing_log_run_idx").on(table.runId),
]);

/** TASK-074b-3a: routing hits on a shadow skill version. Records only; the shadow version never runs. */
export const operatorSkillShadowRuns = sqliteTable("operator_skill_shadow_runs", {
  id: text("id").primaryKey(),
  skillName: text("skill_name").notNull(),
  shadowVersion: integer("shadow_version").notNull(),
  activeVersion: integer("active_version"),
  runId: text("run_id"),
  query: text("query").notNull(),
  rank: integer("rank"),
  planned: text("planned", { mode: "json" }).$type<string[]>().notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("operator_skill_shadow_runs_skill_idx").on(table.skillName, table.shadowVersion),
  index("operator_skill_shadow_runs_run_idx").on(table.runId),
]);

export const operatorToolAudit = sqliteTable("operator_tool_audit", {
  id: text("id").primaryKey(),
  source: text("source").notNull(),
  tool: text("tool").notNull(),
  args: text("args", { mode: "json" }).$type<unknown>().notNull(),
  risk: text("risk").notNull(),
  decision: text("decision").notNull(),
  summary: text("summary").notNull(),
  pendingActionId: text("pending_action_id"),
  runId: text("run_id"),
  createdAt: text("created_at").notNull(),
  agentKind: text("agent_kind"),
  agentName: text("agent_name"),
  agentModel: text("agent_model"),
  agentEnvironment: text("agent_environment"),
  autonomyLevel: text("autonomy_level"),
  grant: text("grant"),
  origin: text("origin"),
  reason: text("reason"),
  undo: text("undo", { mode: "json" }).$type<unknown>(),
}, (table) => [
  index("operator_tool_audit_created_idx").on(table.createdAt),
]);

export const operatorGoals = sqliteTable("operator_goals", {
  workspaceId: text("workspace_id"),
  id: text("id").primaryKey(),
  profileId: text("profile_id"),
  text: text("text").notNull(),
  spec: text("spec", { mode: "json" }).$type<unknown>().notNull(),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  source: text("source").notNull(),
}, (table) => [
  index("operator_goals_workspace_idx").on(table.workspaceId),
  index("operator_goals_profile_idx").on(table.profileId, table.status),
]);

export const operatorPreferences = sqliteTable("operator_preferences", {
  workspaceId: text("workspace_id"),
  id: text("id").primaryKey(),
  profileId: text("profile_id"),
  rule: text("rule").notNull(),
  quote: text("quote").notNull(),
  scope: text("scope").notNull(),
  createdAt: text("created_at").notNull(),
  active: integer("active", { mode: "boolean" }).notNull(),
}, (table) => [
  index("operator_preferences_workspace_idx").on(table.workspaceId),
  index("operator_preferences_profile_idx").on(table.profileId, table.active),
]);

export const operatorRequests = sqliteTable("operator_requests", {
  id: text("id").primaryKey(),
  profileId: text("profile_id"),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  whyVi: text("why_vi").notNull(),
  actionUrl: text("action_url").notNull(),
  dedupeKey: text("dedupe_key").notNull(),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
  resolvedAt: text("resolved_at"),
  checkKind: text("check_kind").notNull(),
  checkArgs: text("check_args", { mode: "json" }).$type<unknown>().notNull(),
}, (table) => [
  index("operator_requests_status_idx").on(table.status, table.createdAt),
]);

export const operatorUserTouches = sqliteTable("operator_user_touches", {
  objectKey: text("object_key").primaryKey(),
  touchedAt: text("touched_at").notNull(),
});

export const routingCanaries = sqliteTable("routing_canaries", {
  id: text("id").primaryKey(),
  profileId: text("profile_id").notNull(),
  stage: text("stage").notNull(),
  before: text("before", { mode: "json" }).$type<unknown>().notNull(),
  after: text("after", { mode: "json" }).$type<unknown>().notNull(),
  reason: text("reason").notNull(),
  remaining: integer("remaining").notNull(),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
});

export const operatorActionAttempts = sqliteTable("operator_action_attempts", {
  id: integer("id").primaryKey(),
  actionKey: text("action_key").notNull(),
  runId: text("run_id").notNull(),
  attemptedAt: text("attempted_at").notNull(),
  failedAt: text("failed_at"),
}, (table) => [
  index("operator_attempt_action_idx").on(table.actionKey, table.runId, table.attemptedAt),
  index("operator_attempt_time_idx").on(table.attemptedAt),
]);

export const autonomyJobClaims = sqliteTable("autonomy_job_claims", {
  id: integer("id").primaryKey(),
  day: text("day").notNull(),
  stage: text("stage").notNull(),
  profileId: text("profile_id"),
  accountId: text("account_id"),
}, (table) => [
  index("autonomy_claim_day_stage_idx").on(table.day, table.stage, table.profileId),
  index("autonomy_claim_day_account_idx").on(table.day, table.accountId),
]);

export const supervisorFindings = sqliteTable("supervisor_findings", {
  id: text("id").primaryKey(),
  profileId: text("profile_id").references(() => profiles.id, { onDelete: "set null" }),
  kind: text("kind").notNull(),
  severity: text("severity").notNull(),
  dedupeKey: text("dedupe_key").notNull().unique(),
  detail: text("detail", { mode: "json" }).$type<unknown>().notNull(),
  firstSeenAt: text("first_seen_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
  status: text("status").notNull(),
  resolution: text("resolution"),
});

export const supervisorHeartbeats = sqliteTable("supervisor_heartbeats", {
  id: integer("id").primaryKey(),
  observedAt: text("observed_at").notNull(),
  runningJobs: integer("running_jobs").notNull(),
  queuedJobs: integer("queued_jobs").notNull(),
  findingCount: integer("finding_count").notNull(),
}, (table) => [
  index("supervisor_heartbeat_time_idx").on(table.observedAt),
]);

/** User and module standing orders. Seeded rows start disabled. */
export const standingOrders = sqliteTable("standing_orders", {
  workspaceId: text("workspace_id"),
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  prompt: text("prompt").notNull(),
  cron: text("cron"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  seeded: integer("seeded", { mode: "boolean" }).notNull().default(false),
  moduleId: text("module_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  lastFiredAt: text("last_fired_at"),
}, (table) => [
  index("standing_orders_workspace_idx").on(table.workspaceId),
]);

export const agents = sqliteTable("agents", {
  workspaceId: text("workspace_id"),
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  environment: text("environment").notNull(),
  model: text("model"),
  firstSeenAt: text("first_seen_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
  calls: integer("calls").notNull().default(1),
}, (table) => [
  index("agents_workspace_idx").on(table.workspaceId),
  uniqueIndex("agents_identity_uq").on(table.workspaceId, table.kind, table.name, table.environment),
]);

export const skillClaims = sqliteTable("skill_claims", {
  id: text("id").primaryKey(),
  skill: text("skill").notNull(),
  profileId: text("profile_id").references(() => profiles.id, { onDelete: "set null" }),
  agentKind: text("agent_kind").notNull(),
  agentName: text("agent_name").notNull(),
  agentEnvironment: text("agent_environment").notNull(),
  claimedAt: text("claimed_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  releasedAt: text("released_at"),
  reportId: text("report_id"),
}, (table) => [
  index("skill_claims_open_idx").on(table.skill, table.profileId, table.releasedAt),
]);

export const skillReports = sqliteTable("skill_reports", {
  id: text("id").primaryKey(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  skill: text("skill").notNull(),
  skillHash: text("skill_hash").notNull(),
  profileId: text("profile_id").references(() => profiles.id, { onDelete: "set null" }),
  profileName: text("profile_name"),
  subjects: text("subjects", { mode: "json" }).$type<{ projectIds?: string[]; publicationIds?: string[]; topicIds?: string[] }>().notNull(),
  agentKind: text("agent_kind").notNull(),
  agentName: text("agent_name").notNull(),
  agentModel: text("agent_model"),
  agentEnvironment: text("agent_environment").notNull(),
  appEnvironment: text("app_environment").notNull(),
  startedAt: text("started_at").notNull(),
  status: text("status").notNull(),
  inputs: text("inputs"),
  decision: text("decision"),
  hypothesis: text("hypothesis"),
  notes: text("notes"),
  lesson: text("lesson"),
  actions: text("actions", { mode: "json" }).$type<Array<{ tool: string; result: "pending_action" | "done" | "blocked"; ref?: string }>>().notNull(),
  metrics: text("metrics", { mode: "json" }).$type<Array<{ name: string; baseline: number | null; target: number | null; actual: number | null; direction: "up" | "down" }>>().notNull(),
  checkAt: text("check_at"),
  verdict: text("verdict"),
  verdictSource: text("verdict_source"),
  checkedAt: text("checked_at"),
  checkedByKind: text("checked_by_kind"),
  checkedByName: text("checked_by_name"),
  runId: text("run_id"),
  claimId: text("claim_id"),
  source: text("source").notNull(),
  importKey: text("import_key").notNull(),
  importedByKind: text("imported_by_kind"),
  importedByName: text("imported_by_name"),
}, (table) => [
  uniqueIndex("skill_reports_import_key_uq").on(table.importKey),
  index("skill_reports_profile_idx").on(table.profileId, table.skill, table.createdAt),
  index("skill_reports_due_idx").on(table.checkAt, table.verdict),
  index("skill_reports_agent_idx").on(table.agentKind, table.agentEnvironment),
]);

/** TASK-122: who a machine key belongs to. Kept beside Better Auth's apikey table, which we do not alter. */
export const agentKeyProfiles = sqliteTable("agent_key_profiles", {
  keyId: text("key_id").primaryKey(),
  agentKind: text("agent_kind").notNull().default("other"),
  instanceName: text("instance_name").notNull().default("unknown"),
  canSupervise: integer("can_supervise", { mode: "boolean" }).notNull().default(false),
  updatedAt: text("updated_at").notNull(),
});

/** TASK-122: short lease on an object, so two agents never change the same thing at once. */
export const agentLeases = sqliteTable("agent_leases", {
  resourceKind: text("resource_kind").notNull(),
  resourceId: text("resource_id").notNull(),
  holderKind: text("holder_kind").notNull(),
  holderInstance: text("holder_instance").notNull(),
  rank: integer("rank").notNull(),
  fence: integer("fence").notNull().default(1),
  runId: text("run_id"),
  acquiredAt: text("acquired_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  preemptedBy: text("preempted_by"),
}, (table) => [
  uniqueIndex("agent_leases_resource_uq").on(table.resourceKind, table.resourceId),
  index("agent_leases_expires_idx").on(table.expiresAt),
]);

/** TASK-122: an agent's result for a repeated call with the same idempotencyKey (24 hours). */
export const agentIdempotency = sqliteTable("agent_idempotency", {
  instance: text("instance").notNull(),
  key: text("key").notNull(),
  tool: text("tool").notNull(),
  result: text("result").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("agent_idempotency_uq").on(table.instance, table.key),
]);

/** TASK-122: every agent process that called with a machine key, and who is on duty. */
export const agentInstances = sqliteTable("agent_instances", {
  instance: text("instance").primaryKey(),
  kind: text("kind").notNull(),
  environment: text("environment").notNull().default("unknown"),
  version: text("version"),
  lastSeenAt: text("last_seen_at").notNull(),
  lastToolAt: text("last_tool_at"),
  dutyHeartbeatAt: text("duty_heartbeat_at"),
  onDuty: integer("on_duty", { mode: "boolean" }).notNull().default(false),
  host: text("host"),
  hermesVersion: text("hermes_version"),
  bundleVersion: integer("bundle_version").notNull().default(0),
  skillsHash: text("skills_hash"),
  toolHash: text("tool_hash"),
  lastSyncAt: text("last_sync_at"),
  lastError: text("last_error"),
  pendingCron: text("pending_cron").notNull().default("[]"),
  bundleBehindSince: text("bundle_behind_since"),
});

/** TASK-123: evidence-backed shared lessons; "global" means within this workspace. */
export const agentLessons = sqliteTable("agent_lessons", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id"),
  scope: text("scope").notNull(),
  text: text("text").notNull(),
  normalizedText: text("normalized_text").notNull(),
  evidence: text("evidence").notNull(),
  sourceKind: text("source_kind").notNull(),
  sourceInstance: text("source_instance").notNull(),
  createdAt: text("created_at").notNull(),
  confirmedCount: integer("confirmed_count").notNull().default(1),
  status: text("status").notNull().default("active"),
  supersedes: text("supersedes"),
  retiredReason: text("retired_reason"),
}, (table) => [uniqueIndex("agent_lessons_workspace_scope_text_uidx").on(table.workspaceId, table.scope, table.normalizedText)]);

/** TASK-128b: user-configured scopes for external agents. */
export const agentAssignments = sqliteTable("agent_assignments", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  instance: text("instance").notNull(),
  role: text("role").notNull(),
  profileId: text("profile_id").references(() => profiles.id, { onDelete: "cascade" }),
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
  stage: text("stage"),
  maxConcurrent: integer("max_concurrent").notNull().default(1),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdBy: text("created_by").notNull(),
}, (table) => [index("agent_assignments_workspace_active_idx").on(table.workspaceId, table.active, table.instance)]);

/** TASK-074a: fixed research pipeline audit, scoped to the caller's workspace. */
export const researchRuns = sqliteTable("research_runs", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id"),
  skill: text("skill").notNull(), version: integer("version").notNull(),
  trigger: text("trigger").notNull(), subject: text("subject").notNull(),
  status: text("status").notNull(), budgetUsed: text("budget_used").notNull().default("{}"),
  report: text("report").notNull().default(""), proposalIds: text("proposal_ids").notNull().default("[]"),
  details: text("details").notNull().default("{}"), changeEventId: text("change_event_id"),
  createdAt: text("created_at").notNull(), finishedAt: text("finished_at"),
}, (table) => [index("research_runs_workspace_created_idx").on(table.workspaceId, table.createdAt)]);

/** TASK-122: hand-offs between the operator, Hermes and the user. */
export const agentEscalations = sqliteTable("agent_escalations", {
  id: text("id").primaryKey(),
  fromKind: text("from_kind").notNull(),
  fromInstance: text("from_instance").notNull(),
  toKind: text("to_kind").notNull(),
  kind: text("kind").notNull(),
  objectRef: text("object_ref").notNull().default(""),
  summary: text("summary").notNull(),
  evidence: text("evidence", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  status: text("status").notNull().default("open"),
  deadlineAt: text("deadline_at"),
  hops: integer("hops").notNull().default(0),
  claimedBy: text("claimed_by"),
  resolvedBy: text("resolved_by"),
  outcome: text("outcome"),
  note: text("note"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("agent_escalations_status_idx").on(table.status, table.toKind),
  index("agent_escalations_object_idx").on(table.kind, table.objectRef),
]);

/** TASK-129a: agent ↔ agent mailbox. `toKind` is instance | role | duty; role and duty resolve at read time, first ack wins. */
export const agentMessages = sqliteTable("agent_messages", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  threadId: text("thread_id").notNull(),
  fromInstance: text("from_instance").notNull(),
  toKind: text("to_kind").notNull(),
  toValue: text("to_value").notNull(),
  kind: text("kind").notNull(),
  missionId: text("mission_id"),
  projectId: text("project_id"),
  body: text("body").notNull(),
  attachments: text("attachments", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
  createdAt: text("created_at").notNull(),
  deliveredAt: text("delivered_at"),
  ackedAt: text("acked_at"),
  ackedBy: text("acked_by"),
  expiresAt: text("expires_at").notNull(),
  escalatedDutyAt: text("escalated_duty_at"),
  escalatedUserAt: text("escalated_user_at"),
}, (table) => [
  index("agent_messages_thread_idx").on(table.threadId, table.createdAt),
  index("agent_messages_to_idx").on(table.workspaceId, table.toKind, table.toValue, table.ackedAt),
  index("agent_messages_sender_idx").on(table.workspaceId, table.fromInstance, table.createdAt),
]);

/** TASK-129a: per-instance push subscription. `webhookEndpointId` reuses webhook_endpoints and webhook_deliveries for retry. */
export const agentSubscriptions = sqliteTable("agent_subscriptions", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  instance: text("instance").notNull(),
  kinds: text("kinds", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
  scope: text("scope", { mode: "json" }).$type<{ profileId?: string; projectId?: string; stage?: string }>().notNull().default(sql`'{}'`),
  delivery: text("delivery").notNull(),
  webhookEndpointId: text("webhook_endpoint_id").references(() => webhookEndpoints.id, { onDelete: "cascade" }),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [index("agent_subscriptions_instance_idx").on(table.workspaceId, table.instance, table.enabled)]);

/** TASK-129c: a mission turns one user command into planned stages, a publish and later analytics. Owner = duty instance. */
export const missions = sqliteTable("missions", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  createdBy: text("created_by").notNull(),
  command: text("command").notNull(),
  channelProfileId: text("channel_profile_id"),
  projectIds: text("project_ids", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
  plan: text("plan", { mode: "json" }).$type<Array<Record<string, unknown>>>().notNull().default(sql`'[]'`),
  state: text("state").notNull().default("planning"),
  owner: text("owner"),
  autonomyLevel: text("autonomy_level").notNull(),
  deadline: text("deadline"),
  budgetUsd: real("budget_usd"),
  report: text("report"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("missions_workspace_state_idx").on(table.workspaceId, table.state),
  index("missions_owner_idx").on(table.owner, table.state),
]);

/** TASK-129c slice 2: one row per checkpoint (`published`, `2h`, `24h`, `72h`, `7d`) and one `ping` row per mission. */
export const missionCheckpoints = sqliteTable("mission_checkpoints", {
  missionId: text("mission_id").notNull(),
  kind: text("kind").notNull(),
  at: text("at").notNull(),
  metrics: text("metrics", { mode: "json" }).$type<Record<string, unknown> | null>(),
  report: text("report"),
}, (table) => [
  primaryKey({ columns: [table.missionId, table.kind] }),
]);
