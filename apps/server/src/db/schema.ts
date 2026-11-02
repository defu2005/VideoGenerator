import { integer, index, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { ProjectSettings } from "@vg/shared";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  topic: text("topic").notNull(),
  mode: text("mode").notNull(),
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
