// TASK-085: tables for the llm domain. Re-exported by ./index.ts; import from "db/schema.js" as before.
import { sql } from "drizzle-orm";
import { integer, index, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const llmCache = sqliteTable("llm_cache", {
  key: text("key").primaryKey(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  responseText: text("response_text").notNull(),
  createdAt: text("created_at").notNull(),
});

/** Aggregated LLM calls per quota window (TASK-044). Rolling windows store one row per call. */
export const llmQuotaUsage = sqliteTable("llm_quota_usage", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  windowStart: text("window_start").notNull(),
  window: text("window").notNull(),
  requests: integer("requests").notNull().default(0),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  /** Estimated USD spent against a credits_usd rule. Lifetime rows keep the running total. */
  creditsUsd: real("credits_usd").notNull().default(0),
}, (table) => [
  uniqueIndex("llm_quota_usage_bucket_uq").on(table.provider, table.model, table.window, table.windowStart),
  index("llm_quota_usage_window_start_idx").on(table.windowStart),
]);

export type LlmQuotaUsageRow = typeof llmQuotaUsage.$inferSelect;

/** Provider+model pause after a quota or rate-limit error (TASK-044). */
export const llmCooldowns = sqliteTable("llm_cooldowns", {
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  until: text("until").notNull(),
  reason: text("reason").notNull(),
  setAt: text("set_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.provider, table.model] }),
]);

export type LlmCooldownRow = typeof llmCooldowns.$inferSelect;

/** Latest OmniRoute provider-quota snapshot (TASK-045). Emails are stored masked. */
export const llmProviderQuotaSnapshots = sqliteTable("llm_provider_quota_snapshots", {
  id: text("id").primaryKey(),
  connectionId: text("connection_id").notNull(),
  omnirouteProvider: text("omniroute_provider").notNull(),
  label: text("label").notNull(),
  maskedAccount: text("masked_account"),
  quotaKey: text("quota_key").notNull(),
  used: real("used"),
  total: real("total"),
  remaining: real("remaining"),
  remainingPct: real("remaining_pct"),
  resetAt: text("reset_at"),
  unlimited: integer("unlimited", { mode: "boolean" }).notNull().default(false),
  fractionReported: integer("fraction_reported", { mode: "boolean" }),
  unit: text("unit").notNull().default("requests"),
  expiresAt: text("expires_at"),
  fetchedAt: text("fetched_at").notNull(),
  error: text("error"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  rateLimitNote: text("rate_limit_note"),
}, (table) => [
  uniqueIndex("llm_provider_quota_snapshots_uq").on(table.connectionId, table.quotaKey),
  index("llm_provider_quota_snapshots_provider_idx").on(table.omnirouteProvider),
]);

export type LlmProviderQuotaSnapshotRow = typeof llmProviderQuotaSnapshots.$inferSelect;

/** Append-only provider intelligence documents. Old versions stay, with superseded_at set. */
export const providerIntelRecords = sqliteTable("provider_intel_records", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  recordKey: text("key").notNull(),
  body: text("json").notNull(),
  version: integer("version").notNull(),
  createdAt: text("created_at").notNull(),
  supersededAt: text("superseded_at"),
}, (table) => [
  index("provider_intel_records_current_idx").on(table.kind, table.recordKey, table.supersededAt),
]);

/** Last fetch of an official provider page. */
export const providerIntelPages = sqliteTable("provider_intel_pages", {
  id: text("id").primaryKey(),
  url: text("url").notNull(),
  providerId: text("provider_id").notNull(),
  pageKind: text("page_kind").notNull(),
  contentHash: text("content_hash").notNull(),
  bodyText: text("body_text").notNull(),
  lastFetchedAt: text("last_fetched_at").notNull(),
  lastChangedAt: text("last_changed_at").notNull(),
  status: text("status").notNull(),
}, (table) => [
  index("provider_intel_pages_url_idx").on(table.url),
  index("provider_intel_pages_provider_idx").on(table.providerId),
]);

export const providerIntelProbes = sqliteTable("provider_intel_probes", {
  id: text("id").primaryKey(),
  providerId: text("provider_id").notNull(),
  model: text("model").notNull(),
  at: text("at").notNull(),
  ok: integer("ok", { mode: "boolean" }).notNull(),
  latencyMs: integer("latency_ms").notNull(),
  errorKind: text("error_kind"),
}, (table) => [
  index("provider_intel_probes_model_idx").on(table.providerId, table.model, table.at),
]);

export const providerIntelChanges = sqliteTable("provider_intel_changes", {
  id: text("id").primaryKey(),
  providerId: text("provider_id").notNull(),
  what: text("what").notNull(),
  oldSummary: text("old_summary").notNull(),
  newSummary: text("new_summary").notNull(),
  needsReview: integer("needs_review", { mode: "boolean" }).notNull(),
  reviewedAt: text("reviewed_at"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("provider_intel_changes_review_idx").on(table.needsReview, table.createdAt),
]);

export const providerIntelResearchQueue = sqliteTable("provider_intel_research_queue", {
  providerId: text("provider_id").primaryKey(),
  status: text("status").notNull(),
  attempts: integer("attempts").notNull().default(0),
  lastRunAt: text("last_run_at"),
  note: text("note"),
});

export const modelTaskStats = sqliteTable("model_task_stats", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  taskId: text("task_id").notNull(),
  day: text("day").notNull(),
  calls: integer("calls").notNull(),
  successRate: text("success_rate").notNull(),
  schemaValidRate: text("schema_valid_rate").notNull(),
  retries: integer("retries").notNull(),
  fallbackRate: text("fallback_rate").notNull(),
  fallbackReasons: text("fallback_reasons").notNull(),
  p50LatencyMs: integer("p50_latency_ms"),
  p95LatencyMs: integer("p95_latency_ms"),
  p50Tokens: integer("p50_tokens"),
  p95Tokens: integer("p95_tokens"),
  p50CostUsd: text("p50_cost_usd"),
  p95CostUsd: text("p95_cost_usd"),
  quality: text("quality").notNull(),
  confidence: text("confidence").notNull(),
}, (table) => [
  index("model_task_stats_task_idx").on(table.taskId, table.day),
]);

export const modelEvalRuns = sqliteTable("model_eval_runs", {
  id: text("id").primaryKey(),
  suiteIds: text("suite_ids").notNull(),
  modelIds: text("model_ids").notNull(),
  status: text("status").notNull(),
  callsUsed: integer("calls_used").notNull(),
  maxCalls: integer("max_calls").notNull(),
  pendingActionId: text("pending_action_id"),
  summaryVi: text("summary_vi").notNull(),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
});

export const modelEvalResults = sqliteTable("model_eval_results", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull(),
  suiteId: text("suite_id").notNull(),
  caseId: text("case_id").notNull(),
  modelId: text("model_id").notNull(),
  outputJson: text("output_json").notNull(),
  gradesJson: text("grades_json").notNull(),
  judgeScore: text("judge_score"),
  cached: integer("cached", { mode: "boolean" }).notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("model_eval_results_run_idx").on(table.runId),
]);

/** TASK-136: per-caller policy for the LLM relay (LiteLLM-style virtual key policy). `*` is the default row. */
export const llmRelayGrants = sqliteTable("llm_relay_grants", {
  caller: text("caller").notNull(),
  workspaceId: text("workspace_id"),
  models: text("models", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
  rpm: integer("rpm").notNull().default(30),
  tpm: integer("tpm").notNull().default(200000),
  dailyUsdCap: real("daily_usd_cap").notNull().default(2),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("llm_relay_grants_workspace_caller_uq").on(table.workspaceId, table.caller),
  uniqueIndex("llm_relay_grants_legacy_caller_uq").on(table.caller).where(sql`${table.workspaceId} is null`),
]);

/** TASK-136: one row per relayed call. Never holds a key or a prompt. */
export const llmRelayUsage = sqliteTable("llm_relay_usage", {
  id: text("id").primaryKey(),
  caller: text("caller").notNull(),
  workspaceId: text("workspace_id"),
  model: text("model").notNull(),
  jobId: text("job_id"),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  costUsd: real("cost_usd"),
  estimated: integer("estimated", { mode: "boolean" }).notNull().default(false),
  /** ok | refused | error */
  status: text("status").notNull(),
  /** Stable refusal or error code, when status is not ok. */
  code: text("code"),
  latencyMs: integer("latency_ms").notNull().default(0),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("llm_relay_usage_caller_created_idx").on(table.caller, table.createdAt),
  index("llm_relay_usage_job_idx").on(table.jobId),
]);
