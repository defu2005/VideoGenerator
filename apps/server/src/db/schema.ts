import { integer, index, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { ProjectSettings } from "@vg/shared";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  topic: text("topic").notNull(),
  mode: text("mode").notNull(),
  runMode: text("run_mode"),
  settings: text("settings", { mode: "json" }).$type<ProjectSettings>().notNull(),
  status: text("status").notNull(),
  stage: text("stage").notNull(),
  thumbnailPath: text("thumbnail_path"),
  durationSec: integer("duration_sec"),
  version: integer("version").notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  archivedAt: text("archived_at"),
}, (table) => [
  index("projects_status_idx").on(table.status),
  index("projects_updated_at_idx").on(table.updatedAt),
  index("projects_archived_at_idx").on(table.archivedAt),
]);

export type ProjectRow = typeof projects.$inferSelect;

export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  stage: text("stage").notNull(),
  scope: text("scope"),
  status: text("status").notNull(),
  progress: integer("progress").notNull().default(0),
  message: text("message"),
  attempt: integer("attempt").notNull().default(1),
  maxAttempts: integer("max_attempts").notNull().default(3),
  error: text("error", { mode: "json" }).$type<{ code: string; message: string; retryable: boolean } | null>(),
  usage: text("usage", { mode: "json" }).$type<{ llmCalls: number; inputTokens: number; outputTokens: number; costUsd: number } | null>(),
  createdAt: text("created_at").notNull(),
  startedAt: text("started_at"),
  finishedAt: text("finished_at"),
  runAfter: text("run_after").notNull(),
  previousState: text("previous_state").notNull().default("PENDING"),
}, (table) => [
  index("jobs_status_run_after_idx").on(table.status, table.runAfter),
  index("jobs_project_created_idx").on(table.projectId, table.createdAt),
]);

export const projectStages = sqliteTable("project_stages", {
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  stage: text("stage").notNull(),
  state: text("state").notNull(),
  progress: integer("progress").notNull().default(0),
  message: text("message"),
  jobId: text("job_id"),
  updatedAt: text("updated_at").notNull(),
  error: text("error", { mode: "json" }).$type<{ code: string; message: string; retryable: boolean } | null>(),
}, (table) => [
  primaryKey({ columns: [table.projectId, table.stage] }),
  index("project_stages_state_idx").on(table.projectId, table.state),
]);
