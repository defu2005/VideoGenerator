// TASK-085: tables for the auth domain. Re-exported by ./index.ts; import from "db/schema.js" as before.
import { sql } from "drizzle-orm";
import { integer, index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
