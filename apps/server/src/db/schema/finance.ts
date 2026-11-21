// TASK-085: tables for the finance domain. Re-exported by ./index.ts; import from "db/schema.js" as before.
import { index, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { account } from "./auth.js";
import { jobs, projects } from "./pipeline.js";
import { platformAccounts, profiles } from "./profiles.js";
import { publications } from "./publishing.js";

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
  uniqueIndex("revenue_entries_source_external_uidx").on(table.workspaceId, table.source, table.externalKey),
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
