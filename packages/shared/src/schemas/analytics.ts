import { z } from "zod";
import { PlatformIdSchema } from "./profile.js";

export const AnalyticsStatusSchema = z.enum(["ok", "needs_reconnect"]);
export type AnalyticsStatus = z.infer<typeof AnalyticsStatusSchema>;

/** Latest / snapshot metric fields (nullable ints & reals). */
export const MetricsFieldsSchema = z.object({
  views: z.number().int().nonnegative().nullable().optional(),
  likes: z.number().int().nonnegative().nullable().optional(),
  comments: z.number().int().nonnegative().nullable().optional(),
  shares: z.number().int().nonnegative().nullable().optional(),
  saves: z.number().int().nonnegative().nullable().optional(),
  watchTimeSec: z.number().nonnegative().nullable().optional(),
  avgViewDurationSec: z.number().nonnegative().nullable().optional(),
  avgViewPct: z.number().min(0).max(100).nullable().optional(),
  subscribersGained: z.number().int().nullable().optional(),
  reach: z.number().int().nonnegative().nullable().optional(),
}).strict();
export type MetricsFields = z.infer<typeof MetricsFieldsSchema>;

export const PublicationLatestMetricsSchema = MetricsFieldsSchema;
export type PublicationLatestMetrics = z.infer<typeof PublicationLatestMetricsSchema>;

export const MetricsSnapshotSchema = MetricsFieldsSchema.extend({
  id: z.string().uuid(),
  publicationId: z.string().uuid(),
  fetchedAt: z.string().datetime({ offset: true }),
}).strict();
export type MetricsSnapshot = z.infer<typeof MetricsSnapshotSchema>;

export const AnalyticsOverviewQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  profileId: z.string().uuid().optional(),
  platform: PlatformIdSchema.optional(),
}).strict();
export type AnalyticsOverviewQuery = z.infer<typeof AnalyticsOverviewQuerySchema>;

export const AnalyticsKpiTotalsSchema = z.object({
  views: z.number(),
  likes: z.number(),
  comments: z.number(),
  shares: z.number(),
  watchHours: z.number(),
  followersDelta: z.number(),
}).strict();
export type AnalyticsKpiTotals = z.infer<typeof AnalyticsKpiTotalsSchema>;

export const AnalyticsKpiWithDeltaSchema = AnalyticsKpiTotalsSchema.extend({
  previous: AnalyticsKpiTotalsSchema,
  delta: AnalyticsKpiTotalsSchema,
}).strict();
export type AnalyticsKpiWithDelta = z.infer<typeof AnalyticsKpiWithDeltaSchema>;

export const AnalyticsDayPointSchema = z.object({
  date: z.string(),
  platform: PlatformIdSchema,
  views: z.number(),
  likes: z.number(),
  comments: z.number(),
  shares: z.number(),
  watchHours: z.number(),
}).strict();
export type AnalyticsDayPoint = z.infer<typeof AnalyticsDayPointSchema>;

export const AnalyticsPlatformSplitSchema = z.object({
  platform: PlatformIdSchema,
  views: z.number(),
  likes: z.number(),
  comments: z.number(),
  shares: z.number(),
  watchHours: z.number(),
}).strict();
export type AnalyticsPlatformSplit = z.infer<typeof AnalyticsPlatformSplitSchema>;

export const AnalyticsVideoRankItemSchema = z.object({
  publicationId: z.string().uuid(),
  projectId: z.string().uuid().nullable(),
  title: z.string(),
  platform: PlatformIdSchema,
  publishedAt: z.string().datetime({ offset: true }).nullable(),
  externalUrl: z.string().nullable(),
  views: z.number().nullable(),
  avgViewPct: z.number().nullable(),
  likes: z.number().nullable(),
  comments: z.number().nullable(),
  shares: z.number().nullable(),
  /** Per-profile, per-platform learning score 0–100. Null when the profile has too few scored videos. */
  score: z.number().min(0).max(100).nullable().optional(),
}).strict();
export type AnalyticsVideoRankItem = z.infer<typeof AnalyticsVideoRankItemSchema>;

export const AnalyticsOverviewResponseSchema = z.object({
  from: z.string(),
  to: z.string(),
  totals: AnalyticsKpiWithDeltaSchema,
  series: z.array(AnalyticsDayPointSchema),
  byPlatform: z.array(AnalyticsPlatformSplitSchema),
  topByViews: z.array(AnalyticsVideoRankItemSchema),
  bottomByViews: z.array(AnalyticsVideoRankItemSchema),
  topByAvgViewPct: z.array(AnalyticsVideoRankItemSchema),
  bottomByAvgViewPct: z.array(AnalyticsVideoRankItemSchema),
  videos: z.array(AnalyticsVideoRankItemSchema),
}).strict();
export type AnalyticsOverviewResponse = z.infer<typeof AnalyticsOverviewResponseSchema>;

export const AnalyticsPublicationSeriesResponseSchema = z.object({
  publicationId: z.string().uuid(),
  snapshots: z.array(MetricsSnapshotSchema),
}).strict();
export type AnalyticsPublicationSeriesResponse = z.infer<typeof AnalyticsPublicationSeriesResponseSchema>;

export const AnalyticsAccountStatusSchema = z.object({
  accountId: z.string().uuid(),
  profileId: z.string().uuid(),
  platform: PlatformIdSchema,
  displayName: z.string(),
  analyticsStatus: AnalyticsStatusSchema.nullable(),
  lastSyncAt: z.string().datetime({ offset: true }).nullable(),
  lastError: z.string().nullable(),
  missingScopes: z.array(z.string()),
}).strict();
export type AnalyticsAccountStatus = z.infer<typeof AnalyticsAccountStatusSchema>;

export const AnalyticsAccountsResponseSchema = z.object({
  items: z.array(AnalyticsAccountStatusSchema),
}).strict();
export type AnalyticsAccountsResponse = z.infer<typeof AnalyticsAccountsResponseSchema>;

export const AnalyticsSyncResponseSchema = z.object({
  accountId: z.string().uuid(),
  synced: z.boolean(),
  skipped: z.boolean(),
  reason: z.string().nullable(),
  publicationsSynced: z.number().int().nonnegative(),
}).strict();
export type AnalyticsSyncResponse = z.infer<typeof AnalyticsSyncResponseSchema>;
