// TASK-085: tables for the profiles domain. Re-exported by ./index.ts; import from "db/schema.js" as before.
import { integer, index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { AccountConnection, AccountFormat, GuidelineSettings, PlatformId, ProfileAutomation, ProfileDefaultBrief, ProfileLlmSettings, ProfileTranslationTarget, ProfileTrendSettings, PublishSettings, TopicSource, TopicStatus } from "@vg/shared";

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
