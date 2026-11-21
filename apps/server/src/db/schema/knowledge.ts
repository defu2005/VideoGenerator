// TASK-085: tables for the knowledge domain. Re-exported by ./index.ts; import from "db/schema.js" as before.
import { blob, integer, index, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { projects } from "./pipeline.js";
import { profiles } from "./profiles.js";

// TASK-057: FTS is a derived runtime cache; source rows are migrated normally.
export const retrievalChunks = sqliteTable("retrieval_chunks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  profileId: text("profile_id").references(() => profiles.id, { onDelete: "cascade" }),
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), sourceId: text("source_id").notNull(), sourceVersion: text("source_version").notNull(),
  contentHash: text("content_hash").notNull(), title: text("title").notNull(), text: text("text").notNull(),
  meta: text("meta", { mode: "json" }).notNull().default({}), embedding: blob("embedding", { mode: "buffer" }),
  embeddingModel: text("embedding_model"), createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
}, (t) => [index("retrieval_profile_kind_idx").on(t.profileId,t.kind), index("retrieval_project_idx").on(t.projectId), uniqueIndex("retrieval_source_hash_uq").on(t.kind,t.sourceId,t.contentHash)]);
export const retrievalUses = sqliteTable("retrieval_uses", {
  id: integer("id").primaryKey({ autoIncrement: true }), projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  stage: text("stage").notNull(), taskId: text("task_id").notNull(), chunkIds: text("chunk_ids", { mode: "json" }).notNull(),
  scores: text("scores", { mode: "json" }).notNull(), tokens: integer("tokens").notNull(), mode: text("mode").notNull(), createdAt: text("created_at").notNull(),
});
export const retrievalExclusions = sqliteTable("retrieval_exclusions", {
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  chunkId: integer("chunk_id").notNull().references(() => retrievalChunks.id, { onDelete: "cascade" }), createdAt: text("created_at").notNull(),
}, (t) => [primaryKey({ columns: [t.projectId,t.chunkId] })]);

export const knowledgeEntries = sqliteTable("knowledge_entries", {
  workspaceId: text("workspace_id"),
  id: text("id").primaryKey(),
  key: text("key"),
  kind: text("kind").notNull(),
  json: text("json"),
  revision: integer("revision").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("knowledge_entries_workspace_idx").on(table.workspaceId),
  uniqueIndex("knowledge_entries_workspace_kind_key_uidx").on(table.workspaceId, table.kind, table.key),
]);

export const knowledgeRevisions = sqliteTable("knowledge_revisions", {
  id: text("id").primaryKey(),
  entryId: text("entry_id").notNull(),
  revision: integer("revision").notNull(),
  before: text("before"),
  after: text("after"),
  patch: text("patch").notNull(),
  origin: text("origin").notNull(),
  actor: text("actor").notNull(),
  reason: text("reason").notNull(),
  changeEventId: text("change_event_id"),
  createdAt: text("created_at").notNull(),
}, (table) => [uniqueIndex("knowledge_revisions_entry_revision").on(table.entryId, table.revision)]);

export const knowledgeProposals = sqliteTable("knowledge_proposals", {
  id: text("id").primaryKey(),
  entryId: text("entry_id").notNull(),
  kind: text("kind").notNull(),
  proposed: text("proposed").notNull(),
  patch: text("patch").notNull(),
  origin: text("origin").notNull(),
  evidence: text("evidence").notNull(),
  risk: text("risk").notNull(),
  status: text("status").notNull(),
  changeEventId: text("change_event_id"),
  createdAt: text("created_at").notNull(),
  decidedAt: text("decided_at"),
  decidedBy: text("decided_by"),
  baseRevision: integer("base_revision").notNull(),
  reason: text("reason").notNull(),
}, (table) => [index("knowledge_proposals_entry_status").on(table.entryId, table.status)]);

export const changeEvents = sqliteTable("change_events", {
  id: text("id").primaryKey(),
  category: text("category").notNull(),
  detector: text("detector").notNull(),
  subject: text("subject").notNull(),
  summary: text("summary").notNull(),
  evidence: text("evidence").notNull(),
  severity: text("severity").notNull(),
  fingerprint: text("fingerprint").notNull(),
  consumers: text("consumers").notNull(),
  reaction: text("reaction").notNull(),
  status: text("status").notNull(),
  seenCount: integer("seen_count").notNull().default(1),
  lastSeenAt: text("last_seen_at").notNull(),
  inDigest: integer("in_digest").notNull().default(0),
  createdAt: text("created_at").notNull(),
  resolvedAt: text("resolved_at"),
}, (table) => [index("change_events_status_severity").on(table.status, table.severity)]);

export const changeHolds = sqliteTable("change_holds", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull(),
  consumer: text("consumer").notNull(),
  subjectType: text("subject_type").notNull(),
  subjectId: text("subject_id").notNull(),
  reason: text("reason").notNull(),
  active: integer("active").notNull().default(1),
  createdAt: text("created_at").notNull(),
}, (table) => [index("change_holds_active_subject").on(table.active, table.subjectType, table.subjectId)]);

export const changeSignalHits = sqliteTable("change_signal_hits", {
  id: text("id").primaryKey(),
  fingerprint: text("fingerprint").notNull(),
  seenAt: text("seen_at").notNull(),
}, (table) => [index("change_signal_hits_fingerprint").on(table.fingerprint, table.seenAt)]);
