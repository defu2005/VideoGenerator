// TASK-085: tables for the nodes domain. Re-exported by ./index.ts; import from "db/schema.js" as before.
import { integer, index, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { jobs } from "./pipeline.js";

/** TASK-118: a machine that joined to render. Only token hashes are stored. */
export const nodes = sqliteTable("nodes", {
  workspaceId: text("workspace_id"),
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  tokenHash: text("token_hash"),
  status: text("status", { enum: ["online", "offline", "draining", "revoked", "version_mismatch"] }).notNull().default("offline"),
  version: text("version"),
  capabilities: text("capabilities", { mode: "json" }).$type<Record<string, unknown> | null>(),
  resources: text("resources", { mode: "json" }).$type<Record<string, unknown> | null>(),
  desiredConfig: text("desired_config", { mode: "json" }).$type<{ concurrency: number; drain: boolean; capabilities: string[] } | null>(),
  lastSeenAt: text("last_seen_at"),
  createdAt: text("created_at").notNull(),
  revokedAt: text("revoked_at"),
  /** TASK-119: result of the node's real capability probe (JSON). */
  probe: text("probe"),
  /** TASK-120: version per declared capability (JSON object). */
  capabilityInfo: text("capability_info").notNull().default("{}"),
}, (table) => [
  uniqueIndex("nodes_token_hash_uq").on(table.tokenHash),
  index("nodes_status_idx").on(table.status),
]);

/**
 * TASK-120: audit and revocation record for a key sent to a node for one lease.
 * Only a hash of the key and metadata are stored, never the key itself.
 */
export const nodeLeaseSecrets = sqliteTable("node_lease_secrets", {
  id: text("id").primaryKey(),
  leaseId: text("lease_id").notNull(),
  jobId: text("job_id").notNull(),
  nodeId: text("node_id").notNull(),
  stage: text("stage").notNull(),
  scope: text("scope").notNull(),
  label: text("label").notNull(),
  secretHash: text("secret_hash").notNull(),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  revokedAt: text("revoked_at"),
  revokedReason: text("revoked_reason"),
}, (table) => [
  index("node_lease_secrets_lease_idx").on(table.leaseId),
  index("node_lease_secrets_node_idx").on(table.nodeId, table.createdAt),
]);

/** Durable upload progress and verified output descriptors, fenced to a particular node lease. */
export const nodeUploads = sqliteTable("node_uploads", {
  jobId: text("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  leaseId: text("lease_id").notNull(),
  name: text("name").notNull(),
  sha256: text("sha256").notNull(),
  size: integer("size").notNull(),
  path: text("path").notNull(),
  receivedBytes: integer("received_bytes").notNull().default(0),
  status: text("status", { enum: ["partial", "ready", "linked"] }).notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [primaryKey({ columns: [table.jobId, table.leaseId, table.name] })]);

/** TASK-118: one-time token that lets a machine join. Single use, one hour. */
export const nodeJoinTokens = sqliteTable("node_join_tokens", {
  workspaceId: text("workspace_id"),
  id: text("id").primaryKey(),
  tokenHash: text("token_hash").notNull(),
  createdBy: text("created_by"),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  usedAt: text("used_at"),
  usedByNodeId: text("used_by_node_id"),
}, (table) => [
  uniqueIndex("node_join_tokens_hash_uq").on(table.tokenHash),
]);
