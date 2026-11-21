// TASK-085: tables for the publishing domain. Re-exported by ./index.ts; import from "db/schema.js" as before.
import { integer, index, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { AutomationLogLevel, PlatformId } from "@vg/shared";
import { account } from "./auth.js";
import { projects, renders } from "./pipeline.js";
import { platformAccounts, profiles } from "./profiles.js";

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

export const publications = sqliteTable("publications", {
  id: text("id").primaryKey(),
  /** TASK-129c slice 2b: set when a mission schedules this publication; null for ordinary publications. */
  missionId: text("mission_id"),
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
  index("publications_mission_idx").on(table.missionId),
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
