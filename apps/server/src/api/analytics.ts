import {
  AnalyticsAccountsResponseSchema,
  AnalyticsOverviewQuerySchema,
  AnalyticsOverviewResponseSchema,
  AnalyticsPublicationSeriesResponseSchema,
  AnalyticsSyncResponseSchema,
  ApiErrorSchema,
} from "@vg/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "../lib/errors.js";
import type { AnalyticsSyncService } from "../analytics/syncService.js";

const ErrorResponses = {
  400: ApiErrorSchema,
  404: ApiErrorSchema,
  409: ApiErrorSchema,
  429: ApiErrorSchema,
  500: ApiErrorSchema,
};

const AccountParams = z.object({ id: z.string().uuid() }).strict();
const PublicationParams = z.object({ id: z.string().uuid() }).strict();

export function registerAnalyticsRoutes(
  app: FastifyInstance,
  deps: { analytics: AnalyticsSyncService },
): void {
  app.get("/api/analytics/overview", {
    schema: {
      querystring: AnalyticsOverviewQuerySchema,
      response: { 200: AnalyticsOverviewResponseSchema, ...ErrorResponses },
    },
  }, async (request) => {
    const query = AnalyticsOverviewQuerySchema.parse(request.query);
    return deps.analytics.getOverview(query);
  });

  app.get("/api/analytics/publications/:id", {
    schema: {
      params: PublicationParams,
      response: { 200: AnalyticsPublicationSeriesResponseSchema, ...ErrorResponses },
    },
  }, async (request) => {
    const { id } = PublicationParams.parse(request.params);
    return deps.analytics.getPublicationSeries(id);
  });

  app.get("/api/analytics/accounts", {
    schema: {
      response: { 200: AnalyticsAccountsResponseSchema, ...ErrorResponses },
    },
  }, async () => ({ items: deps.analytics.listAccountStatuses() }));

  app.post("/api/analytics/accounts/:id/sync", {
    schema: {
      params: AccountParams,
      response: { 200: AnalyticsSyncResponseSchema, ...ErrorResponses },
    },
  }, async (request) => {
    const { id } = AccountParams.parse(request.params);
    const result = await deps.analytics.syncAccount(id, AbortSignal.timeout(60_000), {
      force: false,
    });
    if (result.skipped && result.reason === "Chỉ được đồng bộ thủ công mỗi 5 phút") {
      throw new AppError(429, "ANALYTICS_SYNC_RATE_LIMIT", result.reason);
    }
    if (result.skipped && result.reason === "Không tìm thấy tài khoản") {
      throw new AppError(404, "ACCOUNT_NOT_FOUND", result.reason);
    }
    return result;
  });
}
