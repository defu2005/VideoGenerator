import { sql } from "drizzle-orm";
import { blob, integer, index, primaryKey, real, sqliteTable, text, uniqueIndex, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import type {
  AccountConnection,
  AccountFormat,
  AutomationLogLevel,
  GuidelineSettings,
  PlatformId,
  ProfileAutomation,
  ProfileDefaultBrief,
  ProfileLlmSettings,
  ProfileTranslationTarget,
  ProfileTrendSettings,
  ProjectSettings,
  ThumbnailMeta,
  ClipProposal,
  ReframeMode,
  PublishSettings,
  StylePack,
  StyleTokensPatch,
  TopicSource,
  TopicStatus,
  VideoLook,
} from "@vg/shared";

export const profiles = sqliteTable("profiles", {
  workspaceId: text("workspace_id"),
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description").notNull().default(""),
  direction: text("direction").notNull().default(""),
  language: text("language").notNull().default("vi"),
  market: text("market"),
  defaultBrief: text("default_brief", { mode: "json" }).$type<ProfileDefaultBrief>().notNull(),
  voice: text("voice", { mode: "json" }).$type<{ voice?: string; rate?: string; provider?: string; model?: string; style?: string } | null>(),
  guidelines: text("guidelines", { mode: "json" }).$type<GuidelineSettings>().notNull(),
  llm: text("llm", { mode: "json" }).$type<ProfileLlmSettings | null>(),
  automation: text("automation", { mode: "json" }).$type<ProfileAutomation>(),
  /** off | suggest | auto. Default suggest (TASK-035). */
  learningMode: text("learning_mode").notNull().default("suggest"),
  learnedNotes: text("learned_notes").notNull().default(""),
  learnedHints: text("learned_hints", { mode: "json" }).$type<{ topicAngles?: string[]; avoid?: string[] } | null>(),
  titleAbTest: integer("title_ab_test", { mode: "boolean" }).notNull().default(false),
  learningUndo: text("learning_undo", { mode: "json" }).$type<Record<string, unknown> | null>(),
  /** Trend sources for this profile (TASK-039). */
  trendSettings: text("trend_settings", { mode: "json" }).$type<ProfileTrendSettings | null>(),
  /** Other-language dubs / subtitle versions (TASK-039). */
  translations: text("translations", { mode: "json" }).$type<ProfileTranslationTarget[] | null>(),
  /** Inbox automation, reply style and spam phrases (TASK-038). */
  commentSettings: text("comment_settings", { mode: "json" }).$type<{
    mode: "off" | "hide_spam" | "auto_reply";
    repliesPerVideoPerDay: number;
    repliesPerAccountPerDay: number;
    tone: string;
    emoji: boolean;
    signature: string;
    spamPhrases: string[];
  } | null>(),
  avatarPath: text("avatar_path"),
  color: text("color").notNull().default("#3B82F6"),
  /** Pack id, not a version. The version used for a video is stored on that video. */
  stylePackId: text("style_pack_id"),
  archivedAt: text("archived_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("profiles_workspace_idx").on(table.workspaceId),
  index("profiles_archived_at_idx").on(table.archivedAt),
  index("profiles_updated_at_idx").on(table.updatedAt),
]);

export type ProfileRow = typeof profiles.$inferSelect;

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
  /** Opt-in YouTube comment management (force-ssl). Ignored for other platforms. */
  commentsEnabled: integer("comments_enabled", { mode: "boolean" }).notNull().default(false),
  /** ok | needs_reconnect | unsupported. */
  commentsStatus: text("comments_status"),
  commentsLastError: text("comments_last_error"),
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

/** Cached official/public trend responses. cache_key separates RSS feeds and YouTube categories. */
export const trendCache = sqliteTable("trend_cache", {
  source: text("source").notNull(),
  region: text("region").notNull(),
  language: text("language").notNull(),
  cacheKey: text("cache_key").notNull().default(""),
  fetchedAt: text("fetched_at").notNull(),
  json: text("json", { mode: "json" }).$type<unknown>().notNull(),
}, (table) => [
  primaryKey({ columns: [table.source, table.region, table.language, table.cacheKey] }),
]);

/** Last matched trend ideas per profile, for the dashboard widget. */
export const trendIdeas = sqliteTable("trend_ideas", {
  id: text("id").primaryKey(),
  profileId: text("profile_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  angle: text("angle").notNull(),
  whyNow: text("why_now").notNull(),
  sourceTitles: text("source_titles", { mode: "json" }).$type<string[]>().notNull(),
  urgency: text("urgency").notNull(),
  fitScore: integer("fit_score").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("trend_ideas_profile_created_idx").on(table.profileId, table.createdAt),
]);

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
  /** Last successful comment pull for this publication (TASK-038). */
  commentsSyncedAt: text("comments_synced_at"),
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

/** Comments on the user's own published videos (TASK-038). */
export const comments = sqliteTable("comments", {
  id: text("id").primaryKey(),
  publicationId: text("publication_id").notNull().references(() => publications.id, { onDelete: "cascade" }),
  platform: text("platform").$type<PlatformId>().notNull(),
  externalId: text("external_id").notNull(),
  parentExternalId: text("parent_external_id"),
  authorName: text("author_name").notNull().default(""),
  authorExternalId: text("author_external_id"),
  text: text("text").notNull().default(""),
  likeCount: integer("like_count").notNull().default(0),
  publishedAt: text("published_at").notNull(),
  fetchedAt: text("fetched_at").notNull(),
  status: text("status", {
    enum: ["new", "read", "replied", "hidden", "spam", "ignored"],
  }).notNull().default("new"),
  classification: text("classification"),
  priority: integer("priority").notNull().default(0),
  suggestedReply: text("suggested_reply"),
  replyExternalId: text("reply_external_id"),
  repliedAt: text("replied_at"),
  repliedBy: text("replied_by"),
  toxic: integer("toxic", { mode: "boolean" }).notNull().default(false),
  confidence: text("confidence"),
  attentionNotifiedAt: text("attention_notified_at"),
}, (table) => [
  uniqueIndex("comments_platform_external_uq").on(table.platform, table.externalId),
  index("comments_publication_idx").on(table.publicationId),
  index("comments_status_priority_idx").on(table.status, table.priority),
]);

export type CommentRow = typeof comments.$inferSelect;

export const projects = sqliteTable("projects", {
  workspaceId: text("workspace_id"),
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
  /** long | clip | translation. Clips and translations point at a parent when one exists. */
  kind: text("kind").notNull().default("long"),
  parentProjectId: text("parent_project_id").references((): AnySQLiteColumn => projects.id, { onDelete: "set null" }),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  archivedAt: text("archived_at"),
}, (table) => [
  index("projects_workspace_idx").on(table.workspaceId),
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
  /** Null for assistant-chat usage, which is not tied to one video. */
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
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
      characters?: number;
      costUsd?: number;
    }[];
  } | null>(),
  createdAt: text("created_at").notNull(),
  startedAt: text("started_at"),
  finishedAt: text("finished_at"),
  runAfter: text("run_after").notNull(),
  previousState: text("previous_state").notNull().default("PENDING"),
  /** TASK-118: the worker node that holds this job. Null means the main machine. */
  nodeId: text("node_id"),
  /** Fencing token of the current lease. A node that sends another id gets 409. */
  leaseId: text("lease_id"),
  leaseUntil: text("lease_until"),
  heartbeatAt: text("heartbeat_at"),
  /** TASK-125: set when the stage passes its limit. The job keeps running; nothing kills it by the clock. */
  overdueAt: text("overdue_at"),
  nextCheckAt: text("next_check_at"),
  /** checking | waiting_decision */
  overdueState: text("overdue_state"),
}, (table) => [
  index("jobs_status_run_after_idx").on(table.status, table.runAfter),
  index("jobs_project_created_idx").on(table.projectId, table.createdAt),
  index("jobs_node_lease_idx").on(table.nodeId, table.leaseUntil),
  index("jobs_stage_status_finished_idx").on(table.stage, table.status, table.finishedAt),
]);

/** TASK-125: one row per check of an overdue stage, and per decision by Hermes or the user. */
export const stageOverdueChecks = sqliteTable("stage_overdue_checks", {
  id: text("id").primaryKey(),
  jobId: text("job_id").notNull(),
  attempt: integer("attempt").notNull(),
  projectId: text("project_id").notNull(),
  workspaceId: text("workspace_id"),
  stage: text("stage").notNull(),
  checkNo: integer("check_no").notNull(),
  at: text("at").notNull(),
  facts: text("facts", { mode: "json" }),
  action: text("action").notNull(),
  extendMs: integer("extend_ms"),
  /** ladder | llm | override | hermes | user */
  source: text("source").notNull(),
  actor: text("actor"),
  reason: text("reason").notNull(),
  costUsd: real("cost_usd").notNull().default(0),
}, (table) => [
  index("stage_overdue_checks_job_idx").on(table.jobId, table.attempt),
  index("stage_overdue_checks_workspace_idx").on(table.workspaceId, table.at),
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
  qualityScore: real("quality_score"),
  blockingFacts: integer("blocking_facts").notNull().default(0),
  reviseRound: integer("revise_round").notNull().default(0),
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
  words: text("words", { mode: "json" }).$type<Array<{ startSec: number; endSec: number; text: string }>>().notNull().default([]),
  timingSource: text("timing_source").notNull().default("estimated"),
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

export const timelineSnapshots = sqliteTable("timeline_snapshots", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  revision: integer("revision").notNull(),
  snapshot: text("snapshot", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  source: text("source", { enum: ["chat", "assistant", "mcp", "manual"] }).notNull(),
  summary: text("summary").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("timeline_snapshots_project_idx").on(table.projectId, table.createdAt),
]);

export const timelines = sqliteTable("timelines", {
  projectId: text("project_id").primaryKey().references(() => projects.id, { onDelete: "cascade" }),
  data: text("data", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  inputHash: text("input_hash").notNull(),
  totalDurationSec: real("total_duration_sec").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/** Latest evidence per project. Dismissal history is retained inside manifest JSON. */
export const sourceManifests = sqliteTable("source_manifests", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  renderId: text("render_id"),
  manifest: text("manifest", { mode: "json" }).$type<import("@vg/shared").SourceManifest>().notNull(),
  scores: text("scores", { mode: "json" }).$type<import("@vg/shared").OriginalityScores>().notNull(),
  verdict: text("verdict", { enum: ["OK", "REVIEW"] }).notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [uniqueIndex("source_manifests_project_uq").on(table.projectId)]);

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
  workspaceId: text("workspace_id"),
  id: text("id").primaryKey(),
  channel: text("channel", { enum: ["web", "telegram"] }).notNull(),
  title: text("title").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("assistant_conversations_workspace_idx").on(table.workspaceId),
]);

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
  workspaceId: text("workspace_id"),
  actorUserId: text("actor_user_id"),
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
  index("assistant_pending_actions_workspace_idx").on(table.workspaceId),
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
  workspaceId: text("workspace_id"),
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
  index("revenue_entries_workspace_idx").on(table.workspaceId),
  uniqueIndex("revenue_entries_source_external_uidx").on(table.source, table.externalKey),
  index("revenue_entries_period_idx").on(table.periodStart, table.periodEnd),
  index("revenue_entries_account_idx").on(table.accountId),
  index("revenue_entries_profile_idx").on(table.profileId),
  index("revenue_entries_publication_idx").on(table.publicationId),
]);

export type RevenueEntryRow = typeof revenueEntries.$inferSelect;

/** Manual cost entries (LLM/TTS usage is read live from jobs, not copied here). */
export const costEntries = sqliteTable("cost_entries", {
  workspaceId: text("workspace_id"),
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
  index("cost_entries_workspace_idx").on(table.workspaceId),
  index("cost_entries_date_idx").on(table.date),
  index("cost_entries_profile_idx").on(table.profileId),
  index("cost_entries_project_idx").on(table.projectId),
]);

export type CostEntryRow = typeof costEntries.$inferSelect;

/** Per-account payout threshold + manual balance (TASK-034). */
export const payoutThresholds = sqliteTable("payout_thresholds", {
  workspaceId: text("workspace_id"),
  accountId: text("account_id").primaryKey().references(() => platformAccounts.id, { onDelete: "cascade" }),
  thresholdAmount: real("threshold_amount").notNull(),
  currency: text("currency").notNull(),
  currentBalance: real("current_balance"),
  lastNotifiedAt: text("last_notified_at"),
}, (table) => [
  index("payout_thresholds_workspace_idx").on(table.workspaceId),
]);

export type PayoutThresholdRow = typeof payoutThresholds.$inferSelect;

/** Generated monthly finance report (YYYY-MM). */
export const monthlyReports = sqliteTable("monthly_reports", {
  workspaceId: text("workspace_id").notNull(),
  month: text("month").notNull(),
  json: text("json", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.month] }),
]);

export type MonthlyReportRow = typeof monthlyReports.$inferSelect;

/** User-confirmed context that stays scoped to a profile (TASK-052). */
export const profileMemories = sqliteTable("profile_memories", {
  id: text("id").primaryKey(),
  profileId: text("profile_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  version: integer("version").notNull().default(1),
}, (table) => [
  index("profile_memories_profile_idx").on(table.profileId, table.updatedAt),
]);

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

/** Cursor operator chats (TASK-047). Separate from the built-in assistant. */
export const operatorConversations = sqliteTable("operator_conversations", {
  workspaceId: text("workspace_id"),
  id: text("id").primaryKey(),
  channel: text("channel", { enum: ["web", "telegram"] }).notNull(),
  title: text("title").notNull(),
  cursorChatId: text("cursor_chat_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("operator_conversations_workspace_idx").on(table.workspaceId),
]);

export const operatorRuns = sqliteTable("operator_runs", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull().references(() => operatorConversations.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  status: text("status").notNull(),
  prompt: text("prompt").notNull(),
  result: text("result"),
  partialText: text("partial_text").notNull().default(""),
  toolChips: text("tool_chips", { mode: "json" }).$type<string[]>().notNull(),
  model: text("model"),
  runtimeId: text("runtime_id"),
  workflowId: text("workflow_id"),
  error: text("error"),
  outcome: text("outcome"),
  origin: text("origin").notNull(),
  dayKey: text("day_key").notNull(),
  pendingActionIds: text("pending_action_ids", { mode: "json" }).$type<string[]>().notNull(),
  startedAt: text("started_at"),
  finishedAt: text("finished_at"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("operator_runs_conversation_idx").on(table.conversationId, table.createdAt),
  index("operator_runs_day_idx").on(table.dayKey),
  index("operator_runs_workflow_idx").on(table.workflowId),
]);

export const operatorCheckpoints = sqliteTable("operator_checkpoints", {
  workflowId: text("workflow_id").notNull().references(() => operatorRuns.id, { onDelete: "cascade" }),
  actionKey: text("action_key").notNull(),
  tool: text("tool").notNull(),
  receipt: text("receipt"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.workflowId, table.actionKey] }),
]);

export const operatorToolProposals = sqliteTable("operator_tool_proposals", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  details: text("details").notNull(),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("operator_tool_proposals_status_idx").on(table.status, table.createdAt),
]);

export const operatorEvents = sqliteTable("operator_events", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  profileId: text("profile_id"),
  projectId: text("project_id"),
  jobId: text("job_id"),
  pendingId: text("pending_id"),
  runId: text("run_id"),
  wakeRunId: text("wake_run_id"),
  telegramSentAt: text("telegram_sent_at"),
  detail: text("detail"),
  occurredAt: text("occurred_at").notNull(),
}, (table) => [
  index("operator_events_time_idx").on(table.occurredAt),
]);

export const operatorSkillVersions = sqliteTable("operator_skill_versions", {
  name: text("name").notNull(),
  version: integer("version").notNull(),
  markdown: text("markdown").notNull(),
  evidence: text("evidence").notNull(),
  score: integer("score").notNull(),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.name, table.version] }),
]);

export const operatorMessages = sqliteTable("operator_messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull().references(() => operatorConversations.id, { onDelete: "cascade" }),
  runId: text("run_id"),
  role: text("role", { enum: ["user", "assistant", "system"] }).notNull(),
  content: text("content", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("operator_messages_conversation_idx").on(table.conversationId, table.createdAt),
]);

/** One row per find_skills / find_tools / run routing decision (TASK-047). */
export const operatorRoutingLog = sqliteTable("operator_routing_log", {
  id: text("id").primaryKey(),
  query: text("query").notNull(),
  candidates: text("candidates", { mode: "json" }).$type<unknown>().notNull(),
  picked: text("picked", { mode: "json" }).$type<unknown>().notNull(),
  runId: text("run_id"),
  outcome: text("outcome"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("operator_routing_log_created_idx").on(table.createdAt),
  index("operator_routing_log_run_idx").on(table.runId),
]);

export const operatorToolAudit = sqliteTable("operator_tool_audit", {
  id: text("id").primaryKey(),
  source: text("source").notNull(),
  tool: text("tool").notNull(),
  args: text("args", { mode: "json" }).$type<unknown>().notNull(),
  risk: text("risk").notNull(),
  decision: text("decision").notNull(),
  summary: text("summary").notNull(),
  pendingActionId: text("pending_action_id"),
  runId: text("run_id"),
  createdAt: text("created_at").notNull(),
  agentKind: text("agent_kind"),
  agentName: text("agent_name"),
  agentModel: text("agent_model"),
  agentEnvironment: text("agent_environment"),
  autonomyLevel: text("autonomy_level"),
  grant: text("grant"),
  origin: text("origin"),
  reason: text("reason"),
  undo: text("undo", { mode: "json" }).$type<unknown>(),
}, (table) => [
  index("operator_tool_audit_created_idx").on(table.createdAt),
]);

/** One row per quality repair action the agent or the default ladder ran (TASK-121). */
export const qualityRepairs = sqliteTable("quality_repairs", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  profileId: text("profile_id"),
  gate: text("gate").notNull(),
  issueKind: text("issue_kind").notNull(),
  sceneId: text("scene_id"),
  action: text("action").notNull(),
  chosenBy: text("chosen_by", { enum: ["agent", "ladder"] }).notNull(),
  attempt: integer("attempt").notNull(),
  costUsd: real("cost_usd").notNull().default(0),
  renderUsed: integer("render_used").notNull().default(0),
  /** pending until the next gate check; then passed, failed or error. */
  outcome: text("outcome").notNull().default("pending"),
  gateBefore: text("gate_before", { mode: "json" }).$type<unknown>(),
  gateAfter: text("gate_after", { mode: "json" }).$type<unknown>(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("quality_repairs_project_idx").on(table.projectId, table.createdAt),
  index("quality_repairs_profile_idx").on(table.profileId, table.issueKind),
]);

export const operatorGoals = sqliteTable("operator_goals", {
  workspaceId: text("workspace_id"),
  id: text("id").primaryKey(),
  profileId: text("profile_id"),
  text: text("text").notNull(),
  spec: text("spec", { mode: "json" }).$type<unknown>().notNull(),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  source: text("source").notNull(),
}, (table) => [
  index("operator_goals_workspace_idx").on(table.workspaceId),
  index("operator_goals_profile_idx").on(table.profileId, table.status),
]);

export const operatorPreferences = sqliteTable("operator_preferences", {
  workspaceId: text("workspace_id"),
  id: text("id").primaryKey(),
  profileId: text("profile_id"),
  rule: text("rule").notNull(),
  quote: text("quote").notNull(),
  scope: text("scope").notNull(),
  createdAt: text("created_at").notNull(),
  active: integer("active", { mode: "boolean" }).notNull(),
}, (table) => [
  index("operator_preferences_workspace_idx").on(table.workspaceId),
  index("operator_preferences_profile_idx").on(table.profileId, table.active),
]);

export const operatorRequests = sqliteTable("operator_requests", {
  id: text("id").primaryKey(),
  profileId: text("profile_id"),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  whyVi: text("why_vi").notNull(),
  actionUrl: text("action_url").notNull(),
  dedupeKey: text("dedupe_key").notNull(),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
  resolvedAt: text("resolved_at"),
  checkKind: text("check_kind").notNull(),
  checkArgs: text("check_args", { mode: "json" }).$type<unknown>().notNull(),
}, (table) => [
  index("operator_requests_status_idx").on(table.status, table.createdAt),
]);

export const operatorUserTouches = sqliteTable("operator_user_touches", {
  objectKey: text("object_key").primaryKey(),
  touchedAt: text("touched_at").notNull(),
});

export const routingCanaries = sqliteTable("routing_canaries", {
  id: text("id").primaryKey(),
  profileId: text("profile_id").notNull(),
  stage: text("stage").notNull(),
  before: text("before", { mode: "json" }).$type<unknown>().notNull(),
  after: text("after", { mode: "json" }).$type<unknown>().notNull(),
  reason: text("reason").notNull(),
  remaining: integer("remaining").notNull(),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
});

export const operatorActionAttempts = sqliteTable("operator_action_attempts", {
  id: integer("id").primaryKey(),
  actionKey: text("action_key").notNull(),
  runId: text("run_id").notNull(),
  attemptedAt: text("attempted_at").notNull(),
  failedAt: text("failed_at"),
}, (table) => [
  index("operator_attempt_action_idx").on(table.actionKey, table.runId, table.attemptedAt),
  index("operator_attempt_time_idx").on(table.attemptedAt),
]);

export const autonomyJobClaims = sqliteTable("autonomy_job_claims", {
  id: integer("id").primaryKey(),
  day: text("day").notNull(),
  stage: text("stage").notNull(),
  profileId: text("profile_id"),
  accountId: text("account_id"),
}, (table) => [
  index("autonomy_claim_day_stage_idx").on(table.day, table.stage, table.profileId),
  index("autonomy_claim_day_account_idx").on(table.day, table.accountId),
]);

export const supervisorFindings = sqliteTable("supervisor_findings", {
  id: text("id").primaryKey(),
  profileId: text("profile_id").references(() => profiles.id, { onDelete: "set null" }),
  kind: text("kind").notNull(),
  severity: text("severity").notNull(),
  dedupeKey: text("dedupe_key").notNull().unique(),
  detail: text("detail", { mode: "json" }).$type<unknown>().notNull(),
  firstSeenAt: text("first_seen_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
  status: text("status").notNull(),
  resolution: text("resolution"),
});

export const supervisorHeartbeats = sqliteTable("supervisor_heartbeats", {
  id: integer("id").primaryKey(),
  observedAt: text("observed_at").notNull(),
  runningJobs: integer("running_jobs").notNull(),
  queuedJobs: integer("queued_jobs").notNull(),
  findingCount: integer("finding_count").notNull(),
}, (table) => [
  index("supervisor_heartbeat_time_idx").on(table.observedAt),
]);

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

/** User and module standing orders. Seeded rows start disabled. */
export const standingOrders = sqliteTable("standing_orders", {
  workspaceId: text("workspace_id"),
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  prompt: text("prompt").notNull(),
  cron: text("cron"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  seeded: integer("seeded", { mode: "boolean" }).notNull().default(false),
  moduleId: text("module_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  lastFiredAt: text("last_fired_at"),
}, (table) => [
  index("standing_orders_workspace_idx").on(table.workspaceId),
]);

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

export const agents = sqliteTable("agents", {
  workspaceId: text("workspace_id"),
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  environment: text("environment").notNull(),
  model: text("model"),
  firstSeenAt: text("first_seen_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
  calls: integer("calls").notNull().default(1),
}, (table) => [
  index("agents_workspace_idx").on(table.workspaceId),
  uniqueIndex("agents_identity_uq").on(table.kind, table.name, table.environment),
]);

export const skillClaims = sqliteTable("skill_claims", {
  id: text("id").primaryKey(),
  skill: text("skill").notNull(),
  profileId: text("profile_id").references(() => profiles.id, { onDelete: "set null" }),
  agentKind: text("agent_kind").notNull(),
  agentName: text("agent_name").notNull(),
  agentEnvironment: text("agent_environment").notNull(),
  claimedAt: text("claimed_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  releasedAt: text("released_at"),
  reportId: text("report_id"),
}, (table) => [
  index("skill_claims_open_idx").on(table.skill, table.profileId, table.releasedAt),
]);

export const skillReports = sqliteTable("skill_reports", {
  id: text("id").primaryKey(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  skill: text("skill").notNull(),
  skillHash: text("skill_hash").notNull(),
  profileId: text("profile_id").references(() => profiles.id, { onDelete: "set null" }),
  profileName: text("profile_name"),
  subjects: text("subjects", { mode: "json" }).$type<{ projectIds?: string[]; publicationIds?: string[]; topicIds?: string[] }>().notNull(),
  agentKind: text("agent_kind").notNull(),
  agentName: text("agent_name").notNull(),
  agentModel: text("agent_model"),
  agentEnvironment: text("agent_environment").notNull(),
  appEnvironment: text("app_environment").notNull(),
  startedAt: text("started_at").notNull(),
  status: text("status").notNull(),
  inputs: text("inputs"),
  decision: text("decision"),
  hypothesis: text("hypothesis"),
  notes: text("notes"),
  lesson: text("lesson"),
  actions: text("actions", { mode: "json" }).$type<Array<{ tool: string; result: "pending_action" | "done" | "blocked"; ref?: string }>>().notNull(),
  metrics: text("metrics", { mode: "json" }).$type<Array<{ name: string; baseline: number | null; target: number | null; actual: number | null; direction: "up" | "down" }>>().notNull(),
  checkAt: text("check_at"),
  verdict: text("verdict"),
  verdictSource: text("verdict_source"),
  checkedAt: text("checked_at"),
  checkedByKind: text("checked_by_kind"),
  checkedByName: text("checked_by_name"),
  runId: text("run_id"),
  claimId: text("claim_id"),
  source: text("source").notNull(),
  importKey: text("import_key").notNull(),
  importedByKind: text("imported_by_kind"),
  importedByName: text("imported_by_name"),
}, (table) => [
  uniqueIndex("skill_reports_import_key_uq").on(table.importKey),
  index("skill_reports_profile_idx").on(table.profileId, table.skill, table.createdAt),
  index("skill_reports_due_idx").on(table.checkAt, table.verdict),
  index("skill_reports_agent_idx").on(table.agentKind, table.agentEnvironment),
]);

export const knowledgeEntries = sqliteTable("knowledge_entries", {
  workspaceId: text("workspace_id"),
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  json: text("json"),
  revision: integer("revision").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("knowledge_entries_workspace_idx").on(table.workspaceId),
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

const authTimestamp = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

/** Better Auth user. `role` is an extra column (not the admin plugin). */
export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).default(false).notNull(),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).default(authTimestamp).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).default(authTimestamp).$onUpdate(() => new Date()).notNull(),
  twoFactorEnabled: integer("two_factor_enabled", { mode: "boolean" }).default(false),
  role: text("role").default("member"),
});

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).default(authTimestamp).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).$onUpdate(() => new Date()).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  activeOrganizationId: text("active_organization_id"),
}, (table) => [index("session_userId_idx").on(table.userId)]);

export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).default(authTimestamp).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).$onUpdate(() => new Date()).notNull(),
}, (table) => [index("account_userId_idx").on(table.userId)]);

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).default(authTimestamp).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).default(authTimestamp).$onUpdate(() => new Date()).notNull(),
}, (table) => [index("verification_identifier_idx").on(table.identifier)]);

export const twoFactor = sqliteTable("two_factor", {
  id: text("id").primaryKey(),
  secret: text("secret").notNull(),
  backupCodes: text("backup_codes").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  verified: integer("verified", { mode: "boolean" }).default(true),
  failedVerificationCount: integer("failed_verification_count").default(0),
  lockedUntil: integer("locked_until", { mode: "timestamp_ms" }),
}, (table) => [
  index("twoFactor_secret_idx").on(table.secret),
  index("twoFactor_userId_idx").on(table.userId),
]);

export const apikey = sqliteTable("apikey", {
  id: text("id").primaryKey(),
  configId: text("config_id").default("default").notNull(),
  name: text("name"),
  start: text("start"),
  referenceId: text("reference_id").notNull(),
  prefix: text("prefix"),
  key: text("key").notNull(),
  refillInterval: integer("refill_interval"),
  refillAmount: integer("refill_amount"),
  lastRefillAt: integer("last_refill_at", { mode: "timestamp_ms" }),
  enabled: integer("enabled", { mode: "boolean" }).default(true),
  rateLimitEnabled: integer("rate_limit_enabled", { mode: "boolean" }).default(true),
  rateLimitTimeWindow: integer("rate_limit_time_window").default(86400000),
  rateLimitMax: integer("rate_limit_max").default(10),
  requestCount: integer("request_count").default(0),
  remaining: integer("remaining"),
  lastRequest: integer("last_request", { mode: "timestamp_ms" }),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  permissions: text("permissions"),
  metadata: text("metadata"),
}, (table) => [
  index("apikey_configId_idx").on(table.configId),
  index("apikey_referenceId_idx").on(table.referenceId),
  index("apikey_key_idx").on(table.key),
]);

export const organization = sqliteTable("organization", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logo: text("logo"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  metadata: text("metadata"),
}, (table) => [uniqueIndex("organization_slug_uidx").on(table.slug)]);

export const member = sqliteTable("member", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  role: text("role").default("member").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  index("member_organizationId_idx").on(table.organizationId),
  index("member_userId_idx").on(table.userId),
]);

export const invitation = sqliteTable("invitation", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role"),
  status: text("status").default("pending").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).default(authTimestamp).notNull(),
  inviterId: text("inviter_id").notNull().references(() => user.id, { onDelete: "cascade" }),
}, (table) => [
  index("invitation_organizationId_idx").on(table.organizationId),
  index("invitation_email_idx").on(table.email),
]);

/** TASK-115: narrows (never widens) a member's role to one channel. */
export const channelGrants = sqliteTable("channel_grants", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  userId: text("user_id").notNull(),
  profileId: text("profile_id").notNull(),
  role: text("role").notNull(),
  createdAt: text("created_at").notNull(),
  createdBy: text("created_by"),
}, (table) => [
  uniqueIndex("channel_grants_member_channel_uq").on(table.workspaceId, table.userId, table.profileId),
  index("channel_grants_user_idx").on(table.userId),
]);

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

/** TASK-118: a machine that joined to render. Only token hashes are stored. */
export const nodes = sqliteTable("nodes", {
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

/** TASK-118: one-time token that lets a machine join. Single use, one hour. */
export const nodeJoinTokens = sqliteTable("node_join_tokens", {
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

/** TASK-122: who a machine key belongs to. Kept beside Better Auth's apikey table, which we do not alter. */
export const agentKeyProfiles = sqliteTable("agent_key_profiles", {
  keyId: text("key_id").primaryKey(),
  agentKind: text("agent_kind").notNull().default("other"),
  instanceName: text("instance_name").notNull().default("unknown"),
  canSupervise: integer("can_supervise", { mode: "boolean" }).notNull().default(false),
  updatedAt: text("updated_at").notNull(),
});

/** TASK-122: short lease on an object, so two agents never change the same thing at once. */
export const agentLeases = sqliteTable("agent_leases", {
  resourceKind: text("resource_kind").notNull(),
  resourceId: text("resource_id").notNull(),
  holderKind: text("holder_kind").notNull(),
  holderInstance: text("holder_instance").notNull(),
  rank: integer("rank").notNull(),
  fence: integer("fence").notNull().default(1),
  runId: text("run_id"),
  acquiredAt: text("acquired_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  preemptedBy: text("preempted_by"),
}, (table) => [
  uniqueIndex("agent_leases_resource_uq").on(table.resourceKind, table.resourceId),
  index("agent_leases_expires_idx").on(table.expiresAt),
]);

/** TASK-122: an agent's result for a repeated call with the same idempotencyKey (24 hours). */
export const agentIdempotency = sqliteTable("agent_idempotency", {
  instance: text("instance").notNull(),
  key: text("key").notNull(),
  tool: text("tool").notNull(),
  result: text("result").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("agent_idempotency_uq").on(table.instance, table.key),
]);

/** TASK-122: every agent process that called with a machine key, and who is on duty. */
export const agentInstances = sqliteTable("agent_instances", {
  instance: text("instance").primaryKey(),
  kind: text("kind").notNull(),
  environment: text("environment").notNull().default("unknown"),
  version: text("version"),
  lastSeenAt: text("last_seen_at").notNull(),
  lastToolAt: text("last_tool_at"),
  dutyHeartbeatAt: text("duty_heartbeat_at"),
  onDuty: integer("on_duty", { mode: "boolean" }).notNull().default(false),
});

/** TASK-122: hand-offs between the operator, Hermes and the user. */
export const agentEscalations = sqliteTable("agent_escalations", {
  id: text("id").primaryKey(),
  fromKind: text("from_kind").notNull(),
  fromInstance: text("from_instance").notNull(),
  toKind: text("to_kind").notNull(),
  kind: text("kind").notNull(),
  objectRef: text("object_ref").notNull().default(""),
  summary: text("summary").notNull(),
  evidence: text("evidence", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  status: text("status").notNull().default("open"),
  deadlineAt: text("deadline_at"),
  hops: integer("hops").notNull().default(0),
  claimedBy: text("claimed_by"),
  resolvedBy: text("resolved_by"),
  outcome: text("outcome"),
  note: text("note"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("agent_escalations_status_idx").on(table.status, table.toKind),
  index("agent_escalations_object_idx").on(table.kind, table.objectRef),
]);
