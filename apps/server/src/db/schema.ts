import { integer, index, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
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

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).notNull(),
  updatedAt: text("updated_at").notNull(),
});

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
  usage: text("usage", { mode: "json" }).$type<{
    llmCalls: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    features?: Record<string, number>;
    calls?: {
      task: string;
      provider: string;
      model: string;
      inputTokens: number;
      outputTokens: number;
      premiumRequests?: number;
      cached: boolean;
      fallback: boolean;
      ok: boolean;
    }[];
  } | null>(),
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

export const researchNotes = sqliteTable("research_notes", {
  projectId: text("project_id").primaryKey().references(() => projects.id, { onDelete: "cascade" }),
  inputHash: text("input_hash").notNull(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  cached: integer("cached", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
  data: text("data", { mode: "json" }).notNull(),
});

export const scripts = sqliteTable("scripts", {
  projectId: text("project_id").primaryKey().references(() => projects.id, { onDelete: "cascade" }),
  data: text("data", { mode: "json" }).notNull(),
  origin: text("origin").notNull(),
  edited: integer("edited", { mode: "boolean" }).notNull().default(false),
  inputHash: text("input_hash").notNull(),
  version: integer("version").notNull().default(1),
  provider: text("provider"),
  model: text("model"),
  updatedAt: text("updated_at").notNull(),
  mergedCall: integer("merged_call", { mode: "boolean" }).notNull().default(false),
  reviewNotes: text("review_notes", { mode: "json" }).$type<string[] | null>(),
});

export const scenes = sqliteTable("scenes", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  order: integer("order").notNull(),
  kind: text("kind").notNull(),
  sectionId: text("section_id"),
  label: text("label").notNull(),
  narration: text("narration").notNull(),
  visualNotes: text("visual_notes").notNull(),
  visualDescription: text("visual_description").notNull().default(""),
  noVisual: integer("no_visual", { mode: "boolean" }).notNull().default(false),
  visualQueries: text("visual_queries", { mode: "json" }).$type<{ primary: string; alternatives: string[] }>().notNull(),
  musicMood: text("music_mood").notNull(),
  energy: text("energy").notNull(),
  estDurationSec: real("est_duration_sec").notNull(),
  durationOverrideSec: real("duration_override_sec"),
  startSec: real("start_sec").notNull(),
  transitionNote: text("transition_note").notNull(),
  origin: text("origin").notNull(),
  edited: integer("edited", { mode: "boolean" }).notNull().default(false),
  inputHash: text("input_hash").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("scenes_project_order_uq").on(table.projectId, table.order),
  index("scenes_project_idx").on(table.projectId),
]);

export const voiceTracks = sqliteTable("voice_tracks", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  sceneId: text("scene_id").notNull().references(() => scenes.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  voice: text("voice").notNull(),
  rate: text("rate").notNull(),
  origin: text("origin", { enum: ["AGENT", "USER"] }).notNull(),
  audioPath: text("audio_path").notNull(),
  durationSec: real("duration_sec").notNull(),
  cues: text("cues", { mode: "json" }).$type<Array<{ startSec: number; endSec: number; text: string }>>().notNull().default([]),
  inputHash: text("input_hash").notNull(),
  narrationHash: text("narration_hash").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("voice_tracks_scene_uq").on(table.sceneId),
  index("voice_tracks_project_idx").on(table.projectId),
]);

export const subtitleTracks = sqliteTable("subtitle_tracks", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  cues: text("cues", { mode: "json" }).$type<Array<{ index?: number; sceneId?: string; startSec: number; endSec: number; text: string; edited?: boolean }>>().notNull().default([]),
  srtPath: text("srt_path").notNull(),
  assPath: text("ass_path").notNull(),
  inputHash: text("input_hash").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("subtitle_tracks_project_uq").on(table.projectId),
]);

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
  sourceSite: text("source_site").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  aspectRatio: real("aspect_ratio").notNull(),
  fileType: text("file_type").notNull(),
  watermark: text("watermark").notNull(),
  relevanceScore: real("relevance_score").notNull(),
  scoreBreakdown: text("score_breakdown", { mode: "json" }).notNull(),
  license: text("license", { mode: "json" }).notNull(),
  rank: integer("rank").notNull(),
  discardedAt: text("discarded_at"),
  localPath: text("local_path"),
  sha256: text("sha256"),
  bytes: integer("bytes"),
  actualWidth: integer("actual_width"),
  actualHeight: integer("actual_height"),
  downloadedAt: text("downloaded_at"),
  downloadError: text("download_error"),
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

export const visualSearchState = sqliteTable("visual_search_state", {
  sceneId: text("scene_id").primaryKey().references(() => scenes.id, { onDelete: "cascade" }),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  searchHash: text("search_hash").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("visual_search_state_project_idx").on(table.projectId),
]);

export const imageSearchCache = sqliteTable("image_search_cache", {
  key: text("key").primaryKey(),
  provider: text("provider").notNull(),
  query: text("query").notNull(),
  response: text("response", { mode: "json" }).notNull(),
  createdAt: text("created_at").notNull(),
});

export const llmCache = sqliteTable("llm_cache", {
  key: text("key").primaryKey(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  responseText: text("response_text").notNull(),
  createdAt: text("created_at").notNull(),
});

export const musicCandidates = sqliteTable("music_candidates", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  providerItemId: text("provider_item_id").notNull(),
  title: text("title").notNull(),
  artist: text("artist"),
  sourceUrl: text("source_url"),
  audioUrl: text("audio_url"),
  durationSec: real("duration_sec"),
  genres: text("genres", { mode: "json" }).$type<string[]>().notNull().default([]),
  tags: text("tags", { mode: "json" }).$type<string[]>().notNull().default([]),
  license: text("license", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  relevanceScore: real("relevance_score").notNull().default(0),
  scoreBreakdown: text("score_breakdown", { mode: "json" }).$type<Record<string, number>>().notNull().default({}),
  rank: integer("rank").notNull().default(0),
  localPath: text("local_path"),
  inputHash: text("input_hash").notNull().default(""),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("music_candidates_project_idx").on(table.projectId),
  uniqueIndex("music_candidates_item_uq").on(table.projectId, table.provider, table.providerItemId),
]);

export const musicSelections = sqliteTable("music_selections", {
  projectId: text("project_id").primaryKey().references(() => projects.id, { onDelete: "cascade" }),
  candidateId: text("candidate_id").references(() => musicCandidates.id, { onDelete: "set null" }),
  status: text("status", { enum: ["REVIEW_REQUIRED", "APPROVED", "NONE"] }).notNull(),
  selectedBy: text("selected_by", { enum: ["AGENT", "USER"] }).notNull(),
  volume: real("volume").notNull(),
  fadeInSec: real("fade_in_sec").notNull().default(2),
  fadeOutSec: real("fade_out_sec").notNull().default(3),
  duckingDb: real("ducking_db").notNull().default(-12),
  startOffsetSec: real("start_offset_sec").notNull().default(0),
  queryOverride: text("query_override"),
  searchHash: text("search_hash").notNull().default(""),
  updatedAt: text("updated_at").notNull(),
});

export const timelines = sqliteTable("timelines", {
  projectId: text("project_id").primaryKey().references(() => projects.id, { onDelete: "cascade" }),
  data: text("data", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  inputHash: text("input_hash").notNull(),
  totalDurationSec: real("total_duration_sec").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const guidelineFindings = sqliteTable("guideline_findings", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  stage: text("stage", { enum: ["SCRIPT", "TIMELINE"] }).notNull(),
  source: text("source", { enum: ["CODE", "LLM"] }).notNull(),
  ruleId: text("rule_id").notNull(),
  severity: text("severity", { enum: ["MUST", "SHOULD", "TIP"] }).notNull(),
  sceneId: text("scene_id"),
  text: text("text").notNull(),
  quote: text("quote"),
  suggestion: text("suggestion"),
  status: text("status", { enum: ["OPEN", "FIXED", "DISMISSED"] }).notNull().default("OPEN"),
  dismissedBy: text("dismissed_by"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("guideline_findings_project_idx").on(table.projectId),
]);

export const renders = sqliteTable("renders", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  inputHash: text("input_hash").notNull(),
  status: text("status", { enum: ["DONE", "FAILED"] }).notNull(),
  outputPath: text("output_path").notNull(),
  creditsPath: text("credits_path"),
  srtPath: text("srt_path"),
  durationSec: real("duration_sec").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  report: text("report", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("renders_project_created_idx").on(table.projectId, table.createdAt),
]);
