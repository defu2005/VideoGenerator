import { integer, index, primaryKey, real, sqliteTable, text, uniqueIndex, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import type {
  AccountConnection,
  AccountFormat,
  AutomationLogLevel,
  GuidelineSettings,
  PlatformId,
  ProfileAutomation,
  ProfileDefaultBrief,
  ProfileLlmSettings,
  ProjectSettings,
  ThumbnailMeta,
  ClipProposal,
  ReframeMode,
  PublishSettings,
  TopicSource,
  TopicStatus,
} from "@vg/shared";

export const profiles = sqliteTable("profiles", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description").notNull().default(""),
  direction: text("direction").notNull().default(""),
  language: text("language").notNull().default("vi"),
  defaultBrief: text("default_brief", { mode: "json" }).$type<ProfileDefaultBrief>().notNull(),
  voice: text("voice", { mode: "json" }).$type<{ voice?: string; rate?: string } | null>(),
  guidelines: text("guidelines", { mode: "json" }).$type<GuidelineSettings>().notNull(),
  llm: text("llm", { mode: "json" }).$type<ProfileLlmSettings | null>(),
  automation: text("automation", { mode: "json" }).$type<ProfileAutomation>(),
  /** off | suggest | auto. Default suggest (TASK-035). */
  learningMode: text("learning_mode").notNull().default("suggest"),
  learnedNotes: text("learned_notes").notNull().default(""),
  learnedHints: text("learned_hints", { mode: "json" }).$type<{ topicAngles?: string[]; avoid?: string[] } | null>(),
  titleAbTest: integer("title_ab_test", { mode: "boolean" }).notNull().default(false),
  learningUndo: text("learning_undo", { mode: "json" }).$type<Record<string, unknown> | null>(),
  avatarPath: text("avatar_path"),
  color: text("color").notNull().default("#3B82F6"),
  archivedAt: text("archived_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("profiles_archived_at_idx").on(table.archivedAt),
  index("profiles_updated_at_idx").on(table.updatedAt),
]);

export type ProfileRow = typeof profiles.$inferSelect;

export const platformAccounts = sqliteTable("platform_accounts", {
  id: text("id").primaryKey(),
  profileId: text("profile_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  platform: text("platform").$type<PlatformId>().notNull(),
  displayName: text("display_name").notNull(),
  handle: text("handle"),
  externalId: text("external_id"),
  format: text("format").$type<AccountFormat>().notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  connection: text("connection").$type<AccountConnection>().notNull().default("NOT_CONNECTED"),
  connectionError: text("connection_error"),
  lastCheckedAt: text("last_checked_at"),
  /** Analytics OAuth readiness: ok | needs_reconnect (null = never checked). */
  analyticsStatus: text("analytics_status"),
  analyticsLastError: text("analytics_last_error"),
  analyticsSyncedAt: text("analytics_synced_at"),
  /** Opt-in YouTube monetary analytics (TASK-034). */
  revenueSyncEnabled: integer("revenue_sync_enabled", { mode: "boolean" }).notNull().default(false),
  /** Revenue sync readiness: ok | needs_reconnect | not_monetized. */
  revenueStatus: text("revenue_status"),
  revenueLastError: text("revenue_last_error"),
  revenueSyncedAt: text("revenue_synced_at"),
  publishSettings: text("publish_settings", { mode: "json" }).$type<PublishSettings>().notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("platform_accounts_profile_idx").on(table.profileId),
  index("platform_accounts_platform_idx").on(table.platform),
]);

export type PlatformAccountRow = typeof platformAccounts.$inferSelect;

export const profileTopics = sqliteTable("profile_topics", {
  id: text("id").primaryKey(),
  profileId: text("profile_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  topic: text("topic").notNull(),
  notes: text("notes"),
  source: text("source").$type<TopicSource>().notNull(),
  status: text("status").$type<TopicStatus>().notNull(),
  priority: integer("priority").notNull().default(0),
  projectId: text("project_id"),
  scheduledFor: text("scheduled_for"),
  error: text("error"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("profile_topics_profile_status_idx").on(table.profileId, table.status),
  index("profile_topics_profile_priority_idx").on(table.profileId, table.priority),
  index("profile_topics_scheduled_idx").on(table.scheduledFor),
]);

export type ProfileTopicRow = typeof profileTopics.$inferSelect;

export const automationLog = sqliteTable("automation_log", {
  id: text("id").primaryKey(),
  profileId: text("profile_id").references(() => profiles.id, { onDelete: "set null" }),
  at: text("at").notNull(),
  level: text("level").$type<AutomationLogLevel>().notNull(),
  message: text("message").notNull(),
  data: text("data", { mode: "json" }).$type<Record<string, unknown> | null>(),
}, (table) => [
  index("automation_log_at_idx").on(table.at),
  index("automation_log_profile_idx").on(table.profileId),
]);

export type AutomationLogRow = typeof automationLog.$inferSelect;

/** OAuth tokens — only TokenVault reads/writes this table. */
export const platformCredentials = sqliteTable("platform_credentials", {
  accountId: text("account_id").primaryKey().references(() => platformAccounts.id, { onDelete: "cascade" }),
  ciphertext: text("ciphertext").notNull(),
  iv: text("iv").notNull(),
  authTag: text("auth_tag").notNull(),
  scopes: text("scopes", { mode: "json" }).$type<string[]>().notNull().default([]),
  expiresAt: text("expires_at"),
  updatedAt: text("updated_at").notNull(),
});

export type PlatformCredentialRow = typeof platformCredentials.$inferSelect;

/**
 * Developer-app credentials (client id/secret) encrypted in the vault.
 * Either account_id (per channel) or profile_id+platform (shared by profile accounts).
 */
export const platformAppCredentials = sqliteTable("platform_app_credentials", {
  id: text("id").primaryKey(),
  accountId: text("account_id").references(() => platformAccounts.id, { onDelete: "cascade" }),
  profileId: text("profile_id").references(() => profiles.id, { onDelete: "cascade" }),
  platform: text("platform").$type<PlatformId>().notNull(),
  ciphertext: text("ciphertext").notNull(),
  iv: text("iv").notNull(),
  authTag: text("auth_tag").notNull(),
  /** Last 4 of public client/app id for UI (never the secret). */
  idHint: text("id_hint"),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("platform_app_credentials_account_uq").on(table.accountId),
  index("platform_app_credentials_profile_platform_idx").on(table.profileId, table.platform),
]);

export type PlatformAppCredentialRow = typeof platformAppCredentials.$inferSelect;

export const publications = sqliteTable("publications", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  renderId: text("render_id").notNull().references(() => renders.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull().references(() => platformAccounts.id, { onDelete: "cascade" }),
  status: text("status", {
    enum: ["QUEUED", "SCHEDULED", "UPLOADING", "PUBLISHED", "FAILED", "CANCELLED"],
  }).notNull(),
  visibilityRequested: text("visibility_requested").notNull(),
  visibilityUsed: text("visibility_used").notNull(),
  guardrailReason: text("guardrail_reason"),
  scheduledFor: text("scheduled_for"),
  externalId: text("external_id"),
  externalUrl: text("external_url"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  progress: integer("progress").notNull().default(0),
  warnings: text("warnings", { mode: "json" }).$type<string[]>().notNull().default([]),
  /** Denormalized latest metrics for fast lists (TASK-033). */
  latestMetrics: text("latest_metrics", { mode: "json" }).$type<Record<string, unknown> | null>(),
  metricsSyncedAt: text("metrics_synced_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  publishedAt: text("published_at"),
}, (table) => [
  index("publications_project_idx").on(table.projectId),
  index("publications_account_idx").on(table.accountId),
  index("publications_status_scheduled_idx").on(table.status, table.scheduledFor),
  index("publications_render_account_idx").on(table.renderId, table.accountId),
]);

export type PublicationRow = typeof publications.$inferSelect;

/** One metrics snapshot per publication per sync (TASK-033). */
export const publicationMetricsSnapshots = sqliteTable("publication_metrics_snapshots", {
  id: text("id").primaryKey(),
  publicationId: text("publication_id").notNull().references(() => publications.id, { onDelete: "cascade" }),
  fetchedAt: text("fetched_at").notNull(),
  views: integer("views"),
  likes: integer("likes"),
  comments: integer("comments"),
  shares: integer("shares"),
  saves: integer("saves"),
  watchTimeSec: real("watch_time_sec"),
  avgViewDurationSec: real("avg_view_duration_sec"),
  avgViewPct: real("avg_view_pct"),
  subscribersGained: integer("subscribers_gained"),
  reach: integer("reach"),
  raw: text("raw", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
}, (table) => [
  index("publication_metrics_snapshots_pub_fetched_idx").on(table.publicationId, table.fetchedAt),
]);

export type PublicationMetricsSnapshotRow = typeof publicationMetricsSnapshots.$inferSelect;

/** Daily channel-level metrics per platform account (TASK-033). */
export const channelMetricsDaily = sqliteTable("channel_metrics_daily", {
  accountId: text("account_id").notNull().references(() => platformAccounts.id, { onDelete: "cascade" }),
  date: text("date").notNull(),
  followers: integer("followers"),
  views: integer("views"),
  watchTimeSec: real("watch_time_sec"),
  fetchedAt: text("fetched_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.accountId, table.date] }),
]);

export type ChannelMetricsDailyRow = typeof channelMetricsDaily.$inferSelect;

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
  coverPath: text("cover_path"),
  thumbnailMeta: text("thumbnail_meta", { mode: "json" }).$type<ThumbnailMeta | null>(),
  durationSec: integer("duration_sec"),
  version: integer("version").notNull().default(1),
  profileId: text("profile_id").references(() => profiles.id, { onDelete: "set null" }),
  /** long | clip. Clips skip the draft pipeline and point at a parent when one exists. */
  kind: text("kind").notNull().default("long"),
  parentProjectId: text("parent_project_id").references((): AnySQLiteColumn => projects.id, { onDelete: "set null" }),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  archivedAt: text("archived_at"),
}, (table) => [
  index("projects_status_idx").on(table.status),
  index("projects_updated_at_idx").on(table.updatedAt),
  index("projects_archived_at_idx").on(table.archivedAt),
  index("projects_profile_id_idx").on(table.profileId),
  index("projects_parent_project_id_idx").on(table.parentProjectId),
]);

export type ProjectRow = typeof projects.$inferSelect;

/** One proposal batch for Shorts/Reels cut from a long render or an external file. */
export const clipSets = sqliteTable("clip_sets", {
  id: text("id").primaryKey(),
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
  source: text("source", { enum: ["project", "external"] }).notNull(),
  externalPath: text("external_path"),
  title: text("title").notNull().default(""),
  ownershipConfirmed: integer("ownership_confirmed", { mode: "boolean" }).notNull().default(false),
  options: text("options", { mode: "json" }).$type<{
    count: number;
    minSec: number;
    maxSec: number;
    reframe: ReframeMode;
    platform?: string;
  }>().notNull(),
  proposals: text("proposals", { mode: "json" }).$type<ClipProposal[]>().notNull(),
  status: text("status", { enum: ["proposed", "exporting", "done"] }).notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("clip_sets_project_idx").on(table.projectId),
]);

export type ClipSetRow = typeof clipSets.$inferSelect;

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

export const notificationLog = sqliteTable("notification_log", {
  id: text("id").primaryKey(),
  at: text("at").notNull(),
  kind: text("kind").notNull(),
  subjectKey: text("subject_key").notNull(),
  channel: text("channel").notNull(),
  status: text("status").notNull(),
  message: text("message").notNull(),
  error: text("error"),
}, (table) => [
  index("notification_log_at_idx").on(table.at),
  index("notification_log_subject_idx").on(table.subjectKey),
]);

export type NotificationLogRow = typeof notificationLog.$inferSelect;

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
  error: text("error", { mode: "json" }).$type<{ code: string; message: string; retryable: boolean; retryAt?: string } | null>(),
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
      fallbackReason?: "quota";
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
  error: text("error", { mode: "json" }).$type<{ code: string; message: string; retryable: boolean; retryAt?: string } | null>(),
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
  visionMeta: text("vision_meta", { mode: "json" }),
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
  assist: text("assist", { mode: "json" }).$type<Record<string, unknown> | null>(),
  updatedAt: text("updated_at").notNull(),
});

export const videoMetadata = sqliteTable("video_metadata", {
  projectId: text("project_id").primaryKey().references(() => projects.id, { onDelete: "cascade" }),
  inputHash: text("input_hash").notNull(),
  draft: text("draft", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  edited: text("edited", { mode: "json" }).$type<Record<string, unknown> | null>(),
  source: text("source", { enum: ["LLM", "CODE"] }).notNull(),
  createdAt: text("created_at").notNull(),
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

export const autoReportEntries = sqliteTable("auto_report_entries", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  stage: text("stage").notNull(),
  sceneId: text("scene_id"),
  code: text("code").notNull(),
  severity: text("severity", { enum: ["INFO", "WARN"] }).notNull(),
  message: text("message").notNull(),
  data: text("data", { mode: "json" }).$type<Record<string, unknown> | null>(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("auto_report_entries_project_idx").on(table.projectId),
  index("auto_report_entries_project_stage_idx").on(table.projectId, table.stage),
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
  version: integer("version").notNull().default(0),
  note: text("note"),
  pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
  deletedAt: text("deleted_at"),
  reviewThreadId: text("review_thread_id"),
  metadataSnapshot: text("metadata_snapshot", { mode: "json" }).$type<Record<string, unknown> | null>(),
  /** Null = project default aspect. */
  aspectRatio: text("aspect_ratio", { enum: ["16:9", "9:16", "1:1"] }),
  variantOf: text("variant_of"),
}, (table) => [
  index("renders_project_created_idx").on(table.projectId, table.createdAt),
]);

export const reviewThreads = sqliteTable("review_threads", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  contextHash: text("context_hash").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("review_threads_project_idx").on(table.projectId),
]);

export const reviewMessages = sqliteTable("review_messages", {
  id: text("id").primaryKey(),
  threadId: text("thread_id").notNull().references(() => reviewThreads.id, { onDelete: "cascade" }),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: text("content").notNull(),
  proposals: text("proposals", { mode: "json" }).$type<unknown[] | null>(),
  usage: text("usage", { mode: "json" }).$type<Record<string, unknown> | null>(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("review_messages_thread_idx").on(table.threadId),
  index("review_messages_project_idx").on(table.projectId),
]);

export const reviewProposalApplications = sqliteTable("review_proposal_applications", {
  id: text("id").primaryKey(),
  messageId: text("message_id").notNull().references(() => reviewMessages.id, { onDelete: "cascade" }),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  proposalIndex: integer("proposal_index").notNull(),
  result: text("result", { mode: "json" }).$type<Record<string, unknown> | null>(),
  appliedAt: text("applied_at").notNull(),
}, (table) => [
  index("review_proposal_applications_message_idx").on(table.messageId),
  uniqueIndex("review_proposal_applications_uq").on(table.messageId, table.proposalIndex),
]);

export const assistantConversations = sqliteTable("assistant_conversations", {
  id: text("id").primaryKey(),
  channel: text("channel", { enum: ["web", "telegram"] }).notNull(),
  title: text("title").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

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
  index("assistant_pending_actions_conversation_idx").on(table.conversationId),
]);

/** Manual FX rates → app currency (TASK-034). No external FX API. */
export const currencyRates = sqliteTable("currency_rates", {
  currency: text("currency").primaryKey(),
  rateToAppCurrency: real("rate_to_app_currency").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type CurrencyRateRow = typeof currencyRates.$inferSelect;

/** Revenue in (API sync + manual + CSV). */
export const revenueEntries = sqliteTable("revenue_entries", {
  id: text("id").primaryKey(),
  accountId: text("account_id").references(() => platformAccounts.id, { onDelete: "set null" }),
  publicationId: text("publication_id").references(() => publications.id, { onDelete: "set null" }),
  profileId: text("profile_id").references(() => profiles.id, { onDelete: "set null" }),
  source: text("source").notNull(),
  kind: text("kind").notNull(),
  periodStart: text("period_start").notNull(),
  periodEnd: text("period_end").notNull(),
  amount: real("amount").notNull(),
  currency: text("currency").notNull(),
  note: text("note"),
  externalKey: text("external_key"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("revenue_entries_source_external_uidx").on(table.source, table.externalKey),
  index("revenue_entries_period_idx").on(table.periodStart, table.periodEnd),
  index("revenue_entries_account_idx").on(table.accountId),
  index("revenue_entries_profile_idx").on(table.profileId),
  index("revenue_entries_publication_idx").on(table.publicationId),
]);

export type RevenueEntryRow = typeof revenueEntries.$inferSelect;

/** Manual cost entries (LLM/TTS usage is read live from jobs, not copied here). */
export const costEntries = sqliteTable("cost_entries", {
  id: text("id").primaryKey(),
  profileId: text("profile_id").references(() => profiles.id, { onDelete: "set null" }),
  projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
  kind: text("kind").notNull(),
  date: text("date").notNull(),
  amount: real("amount").notNull(),
  currency: text("currency").notNull(),
  source: text("source").notNull(),
  note: text("note"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("cost_entries_date_idx").on(table.date),
  index("cost_entries_profile_idx").on(table.profileId),
  index("cost_entries_project_idx").on(table.projectId),
]);

export type CostEntryRow = typeof costEntries.$inferSelect;

/** Per-account payout threshold + manual balance (TASK-034). */
export const payoutThresholds = sqliteTable("payout_thresholds", {
  accountId: text("account_id").primaryKey().references(() => platformAccounts.id, { onDelete: "cascade" }),
  thresholdAmount: real("threshold_amount").notNull(),
  currency: text("currency").notNull(),
  currentBalance: real("current_balance"),
  lastNotifiedAt: text("last_notified_at"),
});

export type PayoutThresholdRow = typeof payoutThresholds.$inferSelect;

/** Generated monthly finance report (YYYY-MM). */
export const monthlyReports = sqliteTable("monthly_reports", {
  month: text("month").primaryKey(),
  json: text("json", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  createdAt: text("created_at").notNull(),
});

export type MonthlyReportRow = typeof monthlyReports.$inferSelect;

/** Stored performance insights per profile (TASK-035). */
export const profileInsights = sqliteTable("profile_insights", {
  id: text("id").primaryKey(),
  profileId: text("profile_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  createdAt: text("created_at").notNull(),
  period: text("period").notNull(),
  json: text("json", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  status: text("status").notNull(),
}, (table) => [
  index("profile_insights_profile_created_idx").on(table.profileId, table.createdAt),
]);

export type ProfileInsightRow = typeof profileInsights.$inferSelect;

/** YouTube A/B title test, one row per publication (TASK-035). */
export const titleExperiments = sqliteTable("title_experiments", {
  id: text("id").primaryKey(),
  publicationId: text("publication_id").notNull().references(() => publications.id, { onDelete: "cascade" }),
  profileId: text("profile_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  externalId: text("external_id").notNull(),
  titleA: text("title_a").notNull(),
  titleB: text("title_b").notNull(),
  status: text("status").notNull(),
  winner: text("winner"),
  viewsPerHour: real("views_per_hour"),
  medianViewsPerHour: real("median_views_per_hour"),
  checkedAt: text("checked_at"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("title_experiments_publication_uq").on(table.publicationId),
  index("title_experiments_profile_idx").on(table.profileId),
]);

export type TitleExperimentRow = typeof titleExperiments.$inferSelect;

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
