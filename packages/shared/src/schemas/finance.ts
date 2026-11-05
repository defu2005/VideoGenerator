import { z } from "zod";
import { PlatformIdSchema } from "./profile.js";

export const AppCurrencySchema = z.enum(["VND", "USD"]);
export type AppCurrency = z.infer<typeof AppCurrencySchema>;

export const DISPLAY_CURRENCIES = ["VND", "USD"] as const;

export const RevenueSourceSchema = z.enum(["youtube_api", "manual", "import_csv"]);
export type RevenueSource = z.infer<typeof RevenueSourceSchema>;

export const RevenueKindSchema = z.enum([
  "ads",
  "creator_fund",
  "sponsorship",
  "affiliate",
  "gift",
  "other",
  "payout",
]);
export type RevenueKind = z.infer<typeof RevenueKindSchema>;

export const CostKindSchema = z.enum([
  "llm",
  "tts",
  "stock_media",
  "tool_subscription",
  "ads_spend",
  "other",
]);
export type CostKind = z.infer<typeof CostKindSchema>;

export const CostSourceSchema = z.enum(["usage_auto", "manual"]);
export type CostSource = z.infer<typeof CostSourceSchema>;

export const RevenueStatusSchema = z.enum(["ok", "needs_reconnect", "not_monetized"]);
export type RevenueStatus = z.infer<typeof RevenueStatusSchema>;

export const CurrencyRateSchema = z.object({
  currency: z.string().min(1).max(8),
  rateToAppCurrency: z.number().positive(),
  updatedAt: z.string().datetime({ offset: true }),
}).strict();
export type CurrencyRate = z.infer<typeof CurrencyRateSchema>;

export const FinanceCurrencySettingsSchema = z.object({
  appCurrency: AppCurrencySchema.default("VND"),
  rates: z.array(CurrencyRateSchema).default([]),
}).strict();
export type FinanceCurrencySettings = z.infer<typeof FinanceCurrencySettingsSchema>;

export const RevenueEntrySchema = z.object({
  id: z.string().uuid(),
  accountId: z.string().uuid().nullable(),
  publicationId: z.string().uuid().nullable(),
  profileId: z.string().uuid().nullable(),
  source: RevenueSourceSchema,
  kind: RevenueKindSchema,
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number(),
  currency: z.string().min(1).max(8),
  note: z.string().nullable(),
  externalKey: z.string().nullable(),
  createdAt: z.string().datetime({ offset: true }),
  /** True when amount was allocated from channel-level revenue (not direct). */
  estimated: z.boolean().optional(),
}).strict();
export type RevenueEntry = z.infer<typeof RevenueEntrySchema>;

export const CreateRevenueEntryBodySchema = z.object({
  accountId: z.string().uuid().nullable().optional(),
  publicationId: z.string().uuid().nullable().optional(),
  profileId: z.string().uuid().nullable().optional(),
  kind: RevenueKindSchema,
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number(),
  currency: z.string().min(1).max(8).default("VND"),
  note: z.string().max(2000).nullable().optional(),
}).strict();
export type CreateRevenueEntryBody = z.infer<typeof CreateRevenueEntryBodySchema>;

export const UpdateRevenueEntryBodySchema = CreateRevenueEntryBodySchema.partial().strict();
export type UpdateRevenueEntryBody = z.infer<typeof UpdateRevenueEntryBodySchema>;

export const CostEntrySchema = z.object({
  id: z.string().uuid(),
  profileId: z.string().uuid().nullable(),
  projectId: z.string().uuid().nullable(),
  kind: CostKindSchema,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number(),
  currency: z.string().min(1).max(8),
  source: CostSourceSchema,
  note: z.string().nullable(),
  createdAt: z.string().datetime({ offset: true }),
}).strict();
export type CostEntry = z.infer<typeof CostEntrySchema>;

export const CreateCostEntryBodySchema = z.object({
  profileId: z.string().uuid().nullable().optional(),
  projectId: z.string().uuid().nullable().optional(),
  kind: CostKindSchema,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number(),
  currency: z.string().min(1).max(8).default("VND"),
  note: z.string().max(2000).nullable().optional(),
}).strict();
export type CreateCostEntryBody = z.infer<typeof CreateCostEntryBodySchema>;

export const UpdateCostEntryBodySchema = CreateCostEntryBodySchema.partial().strict();
export type UpdateCostEntryBody = z.infer<typeof UpdateCostEntryBodySchema>;

export const PayoutThresholdSchema = z.object({
  accountId: z.string().uuid(),
  thresholdAmount: z.number().nonnegative(),
  currency: z.string().min(1).max(8),
  currentBalance: z.number().nullable(),
  lastNotifiedAt: z.string().datetime({ offset: true }).nullable(),
  displayName: z.string().optional(),
  platform: PlatformIdSchema.optional(),
}).strict();
export type PayoutThreshold = z.infer<typeof PayoutThresholdSchema>;

export const UpsertPayoutThresholdBodySchema = z.object({
  thresholdAmount: z.number().nonnegative(),
  currency: z.string().min(1).max(8).default("VND"),
  currentBalance: z.number().nullable().optional(),
}).strict();
export type UpsertPayoutThresholdBody = z.infer<typeof UpsertPayoutThresholdBodySchema>;

export const UpsertCurrencyRateBodySchema = z.object({
  currency: z.string().min(1).max(8),
  rateToAppCurrency: z.number().positive(),
}).strict();
export type UpsertCurrencyRateBody = z.infer<typeof UpsertCurrencyRateBodySchema>;

export const FinanceAppCurrencyBodySchema = z.object({
  appCurrency: AppCurrencySchema,
}).strict();
export type FinanceAppCurrencyBody = z.infer<typeof FinanceAppCurrencyBodySchema>;

export const FinanceSummaryQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  profileId: z.string().uuid().optional(),
}).strict();
export type FinanceSummaryQuery = z.infer<typeof FinanceSummaryQuerySchema>;

export const FinanceKpiSchema = z.object({
  revenue: z.number(),
  cost: z.number(),
  profit: z.number(),
  margin: z.number().nullable(),
  currency: AppCurrencySchema,
}).strict();
export type FinanceKpi = z.infer<typeof FinanceKpiSchema>;

export const FinanceMonthBarSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  revenue: z.number(),
  cost: z.number(),
}).strict();
export type FinanceMonthBar = z.infer<typeof FinanceMonthBarSchema>;

export const FinanceProfileSplitSchema = z.object({
  profileId: z.string().uuid().nullable(),
  profileName: z.string(),
  revenue: z.number(),
  cost: z.number(),
  profit: z.number(),
}).strict();
export type FinanceProfileSplit = z.infer<typeof FinanceProfileSplitSchema>;

export const FinancePlatformSplitSchema = z.object({
  platform: PlatformIdSchema.nullable(),
  revenue: z.number(),
  cost: z.number(),
  profit: z.number(),
}).strict();
export type FinancePlatformSplit = z.infer<typeof FinancePlatformSplitSchema>;

export const FinanceVideoProfitSchema = z.object({
  publicationId: z.string().uuid().nullable(),
  projectId: z.string().uuid().nullable(),
  title: z.string(),
  platform: PlatformIdSchema.nullable(),
  views: z.number().nullable(),
  revenue: z.number(),
  revenueEstimated: z.boolean(),
  cost: z.number(),
  profit: z.number(),
}).strict();
export type FinanceVideoProfit = z.infer<typeof FinanceVideoProfitSchema>;

export const FinanceSummaryResponseSchema = z.object({
  from: z.string(),
  to: z.string(),
  currency: AppCurrencySchema,
  kpi: FinanceKpiSchema,
  byMonth: z.array(FinanceMonthBarSchema),
  byProfile: z.array(FinanceProfileSplitSchema),
  byPlatform: z.array(FinancePlatformSplitSchema),
  byVideo: z.array(FinanceVideoProfitSchema),
  revenueByKind: z.array(z.object({
    kind: RevenueKindSchema,
    amount: z.number(),
  }).strict()),
  costByKind: z.array(z.object({
    kind: CostKindSchema,
    amount: z.number(),
    source: CostSourceSchema.optional(),
  }).strict()),
}).strict();
export type FinanceSummaryResponse = z.infer<typeof FinanceSummaryResponseSchema>;

export const FinanceCsvColumnMapSchema = z.object({
  periodStart: z.string().min(1),
  periodEnd: z.string().min(1).optional(),
  amount: z.string().min(1),
  currency: z.string().min(1).optional(),
  kind: z.string().min(1).optional(),
  note: z.string().min(1).optional(),
  accountId: z.string().min(1).optional(),
  publicationId: z.string().min(1).optional(),
}).strict();
export type FinanceCsvColumnMap = z.infer<typeof FinanceCsvColumnMapSchema>;

export const FinanceCsvPreviewBodySchema = z.object({
  csv: z.string().min(1).max(500_000),
  mapping: FinanceCsvColumnMapSchema,
  defaults: z.object({
    accountId: z.string().uuid().nullable().optional(),
    profileId: z.string().uuid().nullable().optional(),
    currency: z.string().min(1).max(8).optional(),
    kind: RevenueKindSchema.optional(),
  }).strict().optional(),
}).strict();
export type FinanceCsvPreviewBody = z.infer<typeof FinanceCsvPreviewBodySchema>;

export const FinanceCsvPreviewRowSchema = z.object({
  rowNumber: z.number().int().positive(),
  periodStart: z.string(),
  periodEnd: z.string(),
  amount: z.number(),
  currency: z.string(),
  kind: RevenueKindSchema,
  note: z.string().nullable(),
  accountId: z.string().uuid().nullable(),
  publicationId: z.string().uuid().nullable(),
  profileId: z.string().uuid().nullable(),
}).strict();
export type FinanceCsvPreviewRow = z.infer<typeof FinanceCsvPreviewRowSchema>;

export const FinanceCsvPreviewResponseSchema = z.object({
  rows: z.array(FinanceCsvPreviewRowSchema),
  errors: z.array(z.object({
    rowNumber: z.number().int().positive(),
    message: z.string(),
  }).strict()),
}).strict();
export type FinanceCsvPreviewResponse = z.infer<typeof FinanceCsvPreviewResponseSchema>;

export const FinanceCsvCommitBodySchema = FinanceCsvPreviewBodySchema;
export type FinanceCsvCommitBody = z.infer<typeof FinanceCsvCommitBodySchema>;

export const FinanceCsvCommitResponseSchema = z.object({
  inserted: z.number().int().nonnegative(),
}).strict();
export type FinanceCsvCommitResponse = z.infer<typeof FinanceCsvCommitResponseSchema>;

export const MonthlyReportMetaSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  createdAt: z.string().datetime({ offset: true }),
  hasInsight: z.boolean(),
}).strict();
export type MonthlyReportMeta = z.infer<typeof MonthlyReportMetaSchema>;

export const MonthlyReportJsonSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  currency: AppCurrencySchema,
  revenueByPlatform: z.array(z.object({
    platform: PlatformIdSchema.nullable(),
    amount: z.number(),
  }).strict()),
  revenueByProfile: z.array(z.object({
    profileId: z.string().uuid().nullable(),
    profileName: z.string(),
    amount: z.number(),
  }).strict()),
  revenueByKind: z.array(z.object({
    kind: RevenueKindSchema,
    amount: z.number(),
  }).strict()),
  costByKind: z.array(z.object({
    kind: CostKindSchema,
    amount: z.number(),
  }).strict()),
  profit: z.number(),
  margin: z.number().nullable(),
  topVideosByProfit: z.array(FinanceVideoProfitSchema),
  topVideosByViews: z.array(FinanceVideoProfitSchema),
  videosPublished: z.number().int().nonnegative(),
  publishFailures: z.number().int().nonnegative(),
  previousMonth: z.object({
    revenue: z.number(),
    cost: z.number(),
    profit: z.number(),
  }).strict().nullable(),
  momChange: z.object({
    revenue: z.number(),
    cost: z.number(),
    profit: z.number(),
  }).strict().nullable(),
  insightBullets: z.array(z.string()).optional(),
}).strict();
export type MonthlyReportJson = z.infer<typeof MonthlyReportJsonSchema>;

export const MonthlyReportDetailSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  createdAt: z.string().datetime({ offset: true }),
  report: MonthlyReportJsonSchema,
}).strict();
export type MonthlyReportDetail = z.infer<typeof MonthlyReportDetailSchema>;

export const MonthlyReportListSchema = z.object({
  items: z.array(MonthlyReportMetaSchema),
}).strict();
export type MonthlyReportList = z.infer<typeof MonthlyReportListSchema>;

export const EnableYoutubeRevenueBodySchema = z.object({
  enabled: z.boolean(),
}).strict();
export type EnableYoutubeRevenueBody = z.infer<typeof EnableYoutubeRevenueBodySchema>;

export const YoutubeRevenueAccountStatusSchema = z.object({
  accountId: z.string().uuid(),
  profileId: z.string().uuid(),
  displayName: z.string(),
  platform: PlatformIdSchema,
  revenueSyncEnabled: z.boolean(),
  revenueStatus: RevenueStatusSchema.nullable(),
  lastSyncAt: z.string().datetime({ offset: true }).nullable(),
  lastError: z.string().nullable(),
  missingScopes: z.array(z.string()),
}).strict();
export type YoutubeRevenueAccountStatus = z.infer<typeof YoutubeRevenueAccountStatusSchema>;

export const FinanceInsightSchema = z.object({
  bullets: z.array(z.string().min(1)).min(3).max(5),
}).strict();
export type FinanceInsight = z.infer<typeof FinanceInsightSchema>;

/** Where to find revenue numbers in each platform's creator dashboard (Vietnamese). */
export const PLATFORM_REVENUE_HELP_VI: Record<string, string> = {
  youtube: "YouTube Studio → Kiếm tiền / Analytics → Doanh thu (cần YouTube Partner Program).",
  tiktok: "TikTok Creator Portal / TikTok Studio → Monetization / Balance → xuất số liệu theo tháng.",
  facebook_reels: "Meta Business Suite / Creator Studio → Kiếm tiền / Insights → doanh thu Reels (nếu đủ điều kiện).",
  instagram_reels: "Instagram Professional → Insights / Professional dashboard → monetization (nếu có).",
  mock: "Tài khoản mock: nhập tay hoặc CSV để kiểm thử.",
};
