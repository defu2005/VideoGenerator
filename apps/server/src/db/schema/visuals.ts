// TASK-085: tables for the visuals domain. Re-exported by ./index.ts; import from "db/schema.js" as before.
import { integer, index, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { projects, scenes } from "./pipeline.js";

export const visualCandidates = sqliteTable("visual_candidates", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  sceneId: text("scene_id").notNull().references(() => scenes.id, { onDelete: "cascade" }),
  origin: text("origin").notNull(),
  provider: text("provider").notNull(),
  providerItemId: text("provider_item_id").notNull(),
  sourceProvider: text("source_provider"),
  query: text("query").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  tags: text("tags", { mode: "json" }).$type<string[]>().notNull().default([]),
  previewUrl: text("preview_url").notNull(),
  imageUrl: text("image_url").notNull(),
  sourceUrl: text("source_url").notNull(),
  sourcePageUrl: text("source_page_url"),
  sourceSite: text("source_site").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  aspectRatio: real("aspect_ratio").notNull(),
  fileType: text("file_type").notNull(),
  watermark: text("watermark").notNull(),
  relevanceScore: real("relevance_score").notNull(),
  scoreBreakdown: text("score_breakdown", { mode: "json" }).notNull(),
  license: text("license", { mode: "json" }).notNull(),
  licenseVerified: integer("license_verified", { mode: "boolean" }).notNull().default(true),
  why: text("why"),
  rank: integer("rank").notNull(),
  discardedAt: text("discarded_at"),
  localPath: text("local_path"),
  sha256: text("sha256"),
  bytes: integer("bytes"),
  actualWidth: integer("actual_width"),
  actualHeight: integer("actual_height"),
  downloadedAt: text("downloaded_at"),
  downloadError: text("download_error"),
  visionCheck: text("vision_check", { mode: "json" }),
  phash: text("phash"),
  phashCenter: text("phash_center"),
  createdAt: text("created_at").notNull(),
  searchHash: text("search_hash").notNull(),
}, (table) => [
  index("visual_candidates_scene_rank_idx").on(table.sceneId, table.rank),
  index("visual_candidates_project_scene_idx").on(table.projectId, table.sceneId),
  uniqueIndex("visual_candidates_provider_item_uq").on(table.sceneId, table.provider, table.providerItemId),
]);

export const visualSelections = sqliteTable("visual_selections", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  sceneId: text("scene_id").notNull().references(() => scenes.id, { onDelete: "cascade" }),
  slot: integer("slot").notNull().default(0),
  candidateId: text("candidate_id").notNull().references(() => visualCandidates.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  selectedBy: text("selected_by").notNull(),
  motion: text("motion", { mode: "json" }),
  reviewedAt: text("reviewed_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("visual_selections_scene_slot_uq").on(table.sceneId, table.slot),
  index("visual_selections_project_scene_idx").on(table.projectId, table.sceneId),
]);

export const visualCrops = sqliteTable("visual_crops", {
  id: text("id").primaryKey(),
  candidateId: text("candidate_id").notNull().references(() => visualCandidates.id, { onDelete: "cascade" }),
  sceneId: text("scene_id").notNull().references(() => scenes.id, { onDelete: "cascade" }),
  aspect: text("aspect").notNull(),
  boxX: integer("box_x").notNull(),
  boxY: integer("box_y").notNull(),
  boxW: integer("box_w").notNull(),
  boxH: integer("box_h").notNull(),
  rule: text("rule").notNull(),
  focusSource: text("focus_source").notNull(),
  manual: integer("manual", { mode: "boolean" }).notNull().default(false),
  outputPath: text("output_path").notNull(),
  outputWidth: integer("output_width").notNull(),
  outputHeight: integer("output_height").notNull(),
  lowRes: integer("low_res", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("visual_crops_candidate_aspect_uq").on(table.candidateId, table.aspect),
]);

export const visualSearchState = sqliteTable("visual_search_state", {
  sceneId: text("scene_id").primaryKey().references(() => scenes.id, { onDelete: "cascade" }),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  searchHash: text("search_hash").notNull(),
  visionMeta: text("vision_meta", { mode: "json" }),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("visual_search_state_project_idx").on(table.projectId),
]);

/** Finished image searches kept across a VISUAL_SEARCH retry. Deleted after a successful stage. */
export const visualSearchCheckpoints = sqliteTable("visual_search_checkpoints", {
  sceneId: text("scene_id").primaryKey(),
  projectId: text("project_id").notNull(),
  searchHash: text("search_hash").notNull(),
  queries: text("queries").notNull(),
  candidates: text("candidates").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("visual_search_checkpoints_project_idx").on(table.projectId),
]);

export const imageSearchCache = sqliteTable("image_search_cache", {
  key: text("key").primaryKey(),
  provider: text("provider").notNull(),
  query: text("query").notNull(),
  response: text("response", { mode: "json" }).notNull(),
  createdAt: text("created_at").notNull(),
});

export const imageVerdicts = sqliteTable("image_verdicts", {
  workspaceId: text("workspace_id").notNull(),
  phash: text("phash").notNull(),
  subjectKey: text("subject_key").notNull(),
  verdict: text("verdict").notNull(),
  reason: text("reason").notNull(),
  checkedBy: text("checked_by").notNull(),
  model: text("model").notNull(),
  visionCheck: text("vision_check").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [primaryKey({ columns: [table.workspaceId, table.phash, table.subjectKey] })]);

/** TASK-148d: accept/reject counts per query shape and topic, for the visual scout hints. */
export const visualQueryPatterns = sqliteTable("visual_query_patterns", {
  workspaceId: text("workspace_id").notNull(),
  channel: text("channel").notNull().default(""),
  topicTag: text("topic_tag").notNull(),
  shape: text("shape").notNull(),
  accepted: integer("accepted").notNull().default(0),
  rejected: integer("rejected").notNull().default(0),
  exampleQuery: text("example_query").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [primaryKey({ columns: [table.workspaceId, table.channel, table.topicTag, table.shape, table.exampleQuery] })]);

export const searchQueryCache = sqliteTable("search_query_cache", {
  workspaceId: text("workspace_id").notNull(),
  source: text("source").notNull(),
  normalizedQuery: text("normalized_query").notNull(),
  results: text("results").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [primaryKey({ columns: [table.workspaceId, table.source, table.normalizedQuery] })]);
