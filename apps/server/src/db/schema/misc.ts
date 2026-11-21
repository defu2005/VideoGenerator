// TASK-085: tables for the misc domain. Re-exported by ./index.ts; import from "db/schema.js" as before.
import { integer, index, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).notNull(),
  updatedAt: text("updated_at").notNull(),
});

/** Generic encrypted secrets (bot tokens, etc.) — only TokenVault reads/writes. */
export const appSecrets = sqliteTable("app_secrets", {
  key: text("key").primaryKey(),
  ciphertext: text("ciphertext").notNull(),
  iv: text("iv").notNull(),
  authTag: text("auth_tag").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type AppSecretRow = typeof appSecrets.$inferSelect;

export const webhookEndpoints = sqliteTable("webhook_endpoints", {
  workspaceId: text("workspace_id"),
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  eventTypes: text("event_types", { mode: "json" }).notNull().default([]),
  allowPrivate: integer("allow_private", { mode: "boolean" }).notNull().default(false),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  disabledReason: text("disabled_reason"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("webhook_endpoints_workspace_idx").on(table.workspaceId),
]);

export const webhookDeliveries = sqliteTable("webhook_deliveries", {
  id: text("id").primaryKey(),
  endpointId: text("endpoint_id").notNull().references(() => webhookEndpoints.id, { onDelete: "cascade" }),
  eventId: text("event_id").notNull(),
  payload: text("payload", { mode: "json" }).notNull(),
  attempt: integer("attempt").notNull().default(0),
  status: text("status").notNull().default("pending"),
  nextAttemptAt: text("next_attempt_at").notNull(),
  lastError: text("last_error"),
  createdAt: text("created_at").notNull(),
}, (t) => [index("webhook_deliveries_due_idx").on(t.status, t.nextAttemptAt)]);

/** TASK-115: who did what, kept 180 days. Payload is redacted and capped at 4 KB. */
export const auditLog = sqliteTable("audit_log", {
  id: text("id").primaryKey(),
  at: text("at").notNull(),
  workspaceId: text("workspace_id"),
  actorKind: text("actor_kind"),
  actorUserId: text("actor_user_id"),
  actorKeyId: text("actor_key_id"),
  action: text("action").notNull(),
  targetType: text("target_type"),
  targetId: text("target_id"),
  outcome: text("outcome", { enum: ["ok", "denied", "error"] }).notNull(),
  statusCode: integer("status_code"),
  source: text("source", { enum: ["api", "assistant", "mcp", "operator", "system"] }).notNull(),
  summary: text("summary"),
  payload: text("payload"),
  requestId: text("request_id"),
}, (table) => [
  index("audit_log_workspace_at_idx").on(table.workspaceId, table.at),
  index("audit_log_actor_at_idx").on(table.actorUserId, table.at),
]);

/** TASK-118: content-addressed files a node may pull, hashed once per path, mtime and size. */
export const artifacts = sqliteTable("artifacts", {
  sha256: text("sha256").primaryKey(),
  size: integer("size").notNull(),
  path: text("path").notNull(),
  mtimeMs: integer("mtime_ms").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("artifacts_path_idx").on(table.path),
]);

/** TASK-137: verified copies outside the local project tree. */
export const blobs = sqliteTable("blobs", {
  sha256: text("sha256").primaryKey(),
  size: integer("size").notNull(),
  provider: text("provider", { enum: ["local", "s3"] }).notNull(),
  key: text("key").notNull(),
  locationId: text("location_id").notNull(),
  storedAt: text("stored_at").notNull(),
  verifiedAt: text("verified_at").notNull(),
  orphanedAt: text("orphaned_at"),
  purgeAfter: text("purge_after"),
});

/** Local paths retain their grace period when the owning project row is removed. */
export const fileGcMarks = sqliteTable("file_gc_marks", {
  path: text("path").primaryKey(),
  projectOwnerId: text("project_owner_id").notNull(),
  kind: text("kind", { enum: ["project", "ephemeral"] }).notNull(),
  size: integer("size").notNull(),
  stamp: text("stamp").notNull(),
  orphanedAt: text("orphaned_at").notNull(),
  purgeAfter: text("purge_after").notNull(),
}, (table) => [index("file_gc_marks_purge_idx").on(table.purgeAfter)]);

export const fileGcRuns = sqliteTable("file_gc_runs", {
  id: text("id").primaryKey(),
  startedAt: text("started_at").notNull(),
  durationMs: integer("duration_ms").notNull(),
  dryRun: integer("dry_run", { mode: "boolean" }).notNull(),
  marked: integer("marked").notNull(),
  cleared: integer("cleared").notNull(),
  purged: integer("purged").notNull(),
  bytes: integer("bytes").notNull(),
  error: text("error"),
});
