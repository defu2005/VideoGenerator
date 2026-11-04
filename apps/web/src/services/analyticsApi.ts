import type {
  AnalyticsAccountsResponse,
  AnalyticsOverviewQuery,
  AnalyticsOverviewResponse,
  AnalyticsPublicationSeriesResponse,
  AnalyticsSyncResponse,
} from "@vg/shared";
import { apiRequest } from "./apiClient";

export type AnalyticsOverviewParams = AnalyticsOverviewQuery;

export function getAnalyticsOverview(query: AnalyticsOverviewParams): Promise<AnalyticsOverviewResponse> {
  const params = new URLSearchParams();
  params.set("from", query.from);
  params.set("to", query.to);
  if (query.profileId) params.set("profileId", query.profileId);
  if (query.platform) params.set("platform", query.platform);
  return apiRequest(`/analytics/overview?${params.toString()}`);
}

export function getPublicationMetrics(publicationId: string): Promise<AnalyticsPublicationSeriesResponse> {
  return apiRequest(`/analytics/publications/${encodeURIComponent(publicationId)}`);
}

export function listAnalyticsAccounts(): Promise<AnalyticsAccountsResponse> {
  return apiRequest("/analytics/accounts");
}

export function syncAnalyticsAccount(accountId: string): Promise<AnalyticsSyncResponse> {
  return apiRequest(`/analytics/accounts/${encodeURIComponent(accountId)}/sync`, {
    method: "POST",
  });
}

export const analyticsKeys = {
  all: ["analytics"] as const,
  overview: (query: AnalyticsOverviewParams) => ["analytics", "overview", query] as const,
  publication: (id: string) => ["analytics", "publication", id] as const,
  accounts: ["analytics", "accounts"] as const,
};
