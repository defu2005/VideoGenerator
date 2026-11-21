// TASK-085: tables for the style domain. Re-exported by ./index.ts; import from "db/schema.js" as before.
import { integer, index, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { StylePack, StyleTokensPatch, VideoLook } from "@vg/shared";
import { projects, renders } from "./pipeline.js";
import { profiles } from "./profiles.js";

/** One row per pack version. Insert only: a new look is a new version (TASK-109). */
export const stylePacks = sqliteTable("style_packs", {
  workspaceId: text("workspace_id"),
  id: text("id").notNull(),
  version: integer("version").notNull(),
  name: text("name").notNull(),
  origin: text("origin", { mode: "json" }).$type<StylePack["origin"]>().notNull(),
  seed: text("seed"),
  tokens: text("tokens", { mode: "json" }).$type<StyleTokensPatch>().notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("style_packs_workspace_idx").on(table.workspaceId),
  primaryKey({ columns: [table.id, table.version] }),
]);

export type StylePackRow = typeof stylePacks.$inferSelect;

/** One finished render's look. The picker and a later sameness check both read `look`. */
export const videoLooks = sqliteTable("video_looks", {
  workspaceId: text("workspace_id"),
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  renderId: text("render_id").notNull().references(() => renders.id, { onDelete: "cascade" }),
  profileId: text("profile_id").references(() => profiles.id, { onDelete: "set null" }),
  packId: text("pack_id").notNull(),
  packVersion: integer("pack_version"),
  fingerprint: text("fingerprint").notNull(),
  look: text("look", { mode: "json" }).$type<VideoLook>().notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("video_looks_workspace_idx").on(table.workspaceId),
  index("video_looks_profile_created_idx").on(table.profileId, table.createdAt),
]);

export type VideoLookRow = typeof videoLooks.$inferSelect;
