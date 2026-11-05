import {
  CreateCostEntryBodySchema,
  CreateRevenueEntryBodySchema,
  CostEntrySchema,
  EnableYoutubeRevenueBodySchema,
  FinanceAppCurrencyBodySchema,
  FinanceCsvCommitBodySchema,
  FinanceCsvCommitResponseSchema,
  FinanceCsvPreviewBodySchema,
  FinanceCsvPreviewResponseSchema,
  FinanceCurrencySettingsSchema,
  FinanceSummaryQuerySchema,
  FinanceSummaryResponseSchema,
  MonthlyReportDetailSchema,
  MonthlyReportListSchema,
  PayoutThresholdSchema,
  RevenueEntrySchema,
  UpdateCostEntryBodySchema,
  UpdateRevenueEntryBodySchema,
  UpsertCurrencyRateBodySchema,
  UpsertPayoutThresholdBodySchema,
  YoutubeRevenueAccountStatusSchema,
  ApiErrorSchema,
} from "@vg/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { FinanceService } from "../finance/financeService.js";

const ErrorResponses = {
  400: ApiErrorSchema,
  404: ApiErrorSchema,
  409: ApiErrorSchema,
  429: ApiErrorSchema,
  500: ApiErrorSchema,
};

const IdParams = z.object({ id: z.string().uuid() }).strict();
const MonthParams = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }).strict();
const AccountParams = z.object({ accountId: z.string().uuid() }).strict();

const RevenueListQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  profileId: z.string().uuid().optional(),
  accountId: z.string().uuid().optional(),
}).strict();

const CostListQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  profileId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
}).strict();

const OkSchema = z.object({ ok: z.literal(true) }).strict();

const YoutubeAccountsResponse = z.object({
  items: z.array(YoutubeRevenueAccountStatusSchema),
}).strict();

const YoutubeSyncResponse = z.object({
  accountId: z.string().uuid(),
  synced: z.boolean(),
  skipped: z.boolean(),
  reason: z.string().nullable(),
  inserted: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
}).strict();

const RevenueListResponse = z.object({ items: z.array(RevenueEntrySchema) }).strict();
const CostListResponse = z.object({ items: z.array(CostEntrySchema) }).strict();
const PayoutListResponse = z.object({ items: z.array(PayoutThresholdSchema) }).strict();

export function registerFinanceRoutes(
  app: FastifyInstance,
  deps: { finance: FinanceService },
): void {
  app.get("/api/finance/currency", {
    schema: {
      response: { 200: FinanceCurrencySettingsSchema, ...ErrorResponses },
    },
  }, async () => deps.finance.getCurrencySettings());

  app.put("/api/finance/currency", {
    schema: {
      body: FinanceAppCurrencyBodySchema,
      response: { 200: FinanceCurrencySettingsSchema, ...ErrorResponses },
    },
  }, async (request) => {
    const body = FinanceAppCurrencyBodySchema.parse(request.body);
    deps.finance.setAppCurrency(body.appCurrency);
    return deps.finance.getCurrencySettings();
  });

  app.put("/api/finance/rates", {
    schema: {
      body: UpsertCurrencyRateBodySchema,
      response: { 200: FinanceCurrencySettingsSchema, ...ErrorResponses },
    },
  }, async (request) => {
    const body = UpsertCurrencyRateBodySchema.parse(request.body);
    deps.finance.upsertRate(body.currency, body.rateToAppCurrency);
    return deps.finance.getCurrencySettings();
  });

  app.delete("/api/finance/rates/:currency", {
    schema: {
      params: z.object({ currency: z.string().min(1).max(8) }).strict(),
      response: { 200: OkSchema, ...ErrorResponses },
    },
  }, async (request) => {
    const { currency } = z.object({ currency: z.string() }).parse(request.params);
    return deps.finance.removeRate(currency);
  });

  app.get("/api/finance/summary", {
    schema: {
      querystring: FinanceSummaryQuerySchema,
      response: { 200: FinanceSummaryResponseSchema, ...ErrorResponses },
    },
  }, async (request) => {
    const query = FinanceSummaryQuerySchema.parse(request.query);
    return deps.finance.getSummary(query);
  });

  app.get("/api/finance/revenue", {
    schema: {
      querystring: RevenueListQuery,
      response: { 200: RevenueListResponse, ...ErrorResponses },
    },
  }, async (request) => {
    const query = RevenueListQuery.parse(request.query);
    return { items: deps.finance.listRevenue(query) };
  });

  app.post("/api/finance/revenue", {
    schema: {
      body: CreateRevenueEntryBodySchema,
      response: { 200: RevenueEntrySchema, ...ErrorResponses },
    },
  }, async (request) => {
    const body = CreateRevenueEntryBodySchema.parse(request.body);
    return deps.finance.createRevenue(body);
  });

  app.patch("/api/finance/revenue/:id", {
    schema: {
      params: IdParams,
      body: UpdateRevenueEntryBodySchema,
      response: { 200: RevenueEntrySchema, ...ErrorResponses },
    },
  }, async (request) => {
    const { id } = IdParams.parse(request.params);
    const body = UpdateRevenueEntryBodySchema.parse(request.body);
    return deps.finance.updateRevenue(id, body);
  });

  app.delete("/api/finance/revenue/:id", {
    schema: {
      params: IdParams,
      response: { 200: OkSchema, ...ErrorResponses },
    },
  }, async (request) => {
    const { id } = IdParams.parse(request.params);
    deps.finance.deleteRevenue(id);
    return { ok: true as const };
  });

  app.get("/api/finance/costs", {
    schema: {
      querystring: CostListQuery,
      response: { 200: CostListResponse, ...ErrorResponses },
    },
  }, async (request) => {
    const query = CostListQuery.parse(request.query);
    return { items: deps.finance.listCosts(query) };
  });

  app.post("/api/finance/costs", {
    schema: {
      body: CreateCostEntryBodySchema,
      response: { 200: CostEntrySchema, ...ErrorResponses },
    },
  }, async (request) => {
    const body = CreateCostEntryBodySchema.parse(request.body);
    return deps.finance.createCost(body);
  });

  app.patch("/api/finance/costs/:id", {
    schema: {
      params: IdParams,
      body: UpdateCostEntryBodySchema,
      response: { 200: CostEntrySchema, ...ErrorResponses },
    },
  }, async (request) => {
    const { id } = IdParams.parse(request.params);
    const body = UpdateCostEntryBodySchema.parse(request.body);
    return deps.finance.updateCost(id, body);
  });

  app.delete("/api/finance/costs/:id", {
    schema: {
      params: IdParams,
      response: { 200: OkSchema, ...ErrorResponses },
    },
  }, async (request) => {
    const { id } = IdParams.parse(request.params);
    deps.finance.deleteCost(id);
    return { ok: true as const };
  });

  app.post("/api/finance/import/preview", {
    schema: {
      body: FinanceCsvPreviewBodySchema,
      response: { 200: FinanceCsvPreviewResponseSchema, ...ErrorResponses },
    },
  }, async (request) => {
    const body = FinanceCsvPreviewBodySchema.parse(request.body);
    return deps.finance.previewCsv(body);
  });

  app.post("/api/finance/import/commit", {
    schema: {
      body: FinanceCsvCommitBodySchema,
      response: { 200: FinanceCsvCommitResponseSchema, ...ErrorResponses },
    },
  }, async (request) => {
    const body = FinanceCsvCommitBodySchema.parse(request.body);
    return deps.finance.commitCsv(body);
  });

  app.get("/api/finance/payout-thresholds", {
    schema: {
      response: { 200: PayoutListResponse, ...ErrorResponses },
    },
  }, async () => ({ items: deps.finance.listPayoutThresholds() }));

  app.put("/api/finance/payout-thresholds/:accountId", {
    schema: {
      params: AccountParams,
      body: UpsertPayoutThresholdBodySchema,
      response: { 200: PayoutThresholdSchema, ...ErrorResponses },
    },
  }, async (request) => {
    const { accountId } = AccountParams.parse(request.params);
    const body = UpsertPayoutThresholdBodySchema.parse(request.body);
    return deps.finance.upsertPayoutThreshold(accountId, body);
  });

  app.delete("/api/finance/payout-thresholds/:accountId", {
    schema: {
      params: AccountParams,
      response: { 200: OkSchema, ...ErrorResponses },
    },
  }, async (request) => {
    const { accountId } = AccountParams.parse(request.params);
    deps.finance.deletePayoutThreshold(accountId);
    return { ok: true as const };
  });

  app.get("/api/finance/reports", {
    schema: {
      response: { 200: MonthlyReportListSchema, ...ErrorResponses },
    },
  }, async () => deps.finance.listReports());

  app.get("/api/finance/reports/:month", {
    schema: {
      params: MonthParams,
      response: { 200: MonthlyReportDetailSchema, ...ErrorResponses },
    },
  }, async (request) => {
    const { month } = MonthParams.parse(request.params);
    return deps.finance.getReport(month);
  });

  app.post("/api/finance/reports/:month/regenerate", {
    schema: {
      params: MonthParams,
      response: { 200: MonthlyReportDetailSchema, ...ErrorResponses },
    },
  }, async (request) => {
    const { month } = MonthParams.parse(request.params);
    return deps.finance.generateMonthlyReport(month, { force: true });
  });

  app.get("/api/finance/youtube-accounts", {
    schema: {
      response: { 200: YoutubeAccountsResponse, ...ErrorResponses },
    },
  }, async () => ({ items: deps.finance.listYoutubeRevenueAccounts() }));

  app.post("/api/finance/youtube-accounts/:id/enable", {
    schema: {
      params: IdParams,
      body: EnableYoutubeRevenueBodySchema,
      response: { 200: YoutubeRevenueAccountStatusSchema, ...ErrorResponses },
    },
  }, async (request) => {
    const { id } = IdParams.parse(request.params);
    const body = EnableYoutubeRevenueBodySchema.parse(request.body);
    return deps.finance.setYoutubeRevenueEnabled(id, body.enabled);
  });

  app.post("/api/finance/youtube-accounts/:id/sync", {
    schema: {
      params: IdParams,
      response: { 200: YoutubeSyncResponse, ...ErrorResponses },
    },
  }, async (request) => {
    const { id } = IdParams.parse(request.params);
    const result = await deps.finance.syncYoutubeRevenue(id);
    return { accountId: id, ...result };
  });
}
