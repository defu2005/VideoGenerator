import type {
  CostEntry,
  CreateCostEntryBody,
  CreateRevenueEntryBody,
  FinanceCsvCommitBody,
  FinanceCsvCommitResponse,
  FinanceCsvPreviewBody,
  FinanceCsvPreviewResponse,
  FinanceCurrencySettings,
  FinanceSummaryQuery,
  FinanceSummaryResponse,
  MonthlyReportDetail,
  MonthlyReportList,
  PayoutThreshold,
  RevenueEntry,
  UpsertCurrencyRateBody,
  UpsertPayoutThresholdBody,
  YoutubeRevenueAccountStatus,
} from "@vg/shared";
import { apiRequest } from "./apiClient";

export type FinanceSummaryParams = FinanceSummaryQuery;

export function getFinanceSummary(query: FinanceSummaryParams): Promise<FinanceSummaryResponse> {
  const params = new URLSearchParams();
  params.set("from", query.from);
  params.set("to", query.to);
  if (query.profileId) params.set("profileId", query.profileId);
  return apiRequest(`/finance/summary?${params.toString()}`);
}

export function getFinanceCurrency(): Promise<FinanceCurrencySettings> {
  return apiRequest("/finance/currency");
}

export function setFinanceAppCurrency(appCurrency: "VND" | "USD"): Promise<FinanceCurrencySettings> {
  return apiRequest("/finance/currency", { method: "PUT", body: JSON.stringify({ appCurrency }) });
}

export function upsertFinanceRate(body: UpsertCurrencyRateBody): Promise<FinanceCurrencySettings> {
  return apiRequest("/finance/rates", { method: "PUT", body: JSON.stringify(body) });
}

export function listRevenue(query: {
  from?: string;
  to?: string;
  profileId?: string;
}): Promise<{ items: RevenueEntry[] }> {
  const params = new URLSearchParams();
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  if (query.profileId) params.set("profileId", query.profileId);
  const qs = params.toString();
  return apiRequest(`/finance/revenue${qs ? `?${qs}` : ""}`);
}

export function createRevenue(body: CreateRevenueEntryBody): Promise<RevenueEntry> {
  return apiRequest("/finance/revenue", { method: "POST", body: JSON.stringify(body) });
}

export function deleteRevenue(id: string): Promise<{ ok: true }> {
  return apiRequest(`/finance/revenue/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function listCosts(query: {
  from?: string;
  to?: string;
  profileId?: string;
}): Promise<{ items: CostEntry[] }> {
  const params = new URLSearchParams();
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  if (query.profileId) params.set("profileId", query.profileId);
  const qs = params.toString();
  return apiRequest(`/finance/costs${qs ? `?${qs}` : ""}`);
}

export function createCost(body: CreateCostEntryBody): Promise<CostEntry> {
  return apiRequest("/finance/costs", { method: "POST", body: JSON.stringify(body) });
}

export function deleteCost(id: string): Promise<{ ok: true }> {
  return apiRequest(`/finance/costs/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function previewRevenueCsv(body: FinanceCsvPreviewBody): Promise<FinanceCsvPreviewResponse> {
  return apiRequest("/finance/import/preview", { method: "POST", body: JSON.stringify(body) });
}

export function commitRevenueCsv(body: FinanceCsvCommitBody): Promise<FinanceCsvCommitResponse> {
  return apiRequest("/finance/import/commit", { method: "POST", body: JSON.stringify(body) });
}

export function listPayoutThresholds(): Promise<{ items: PayoutThreshold[] }> {
  return apiRequest("/finance/payout-thresholds");
}

export function upsertPayoutThreshold(
  accountId: string,
  body: UpsertPayoutThresholdBody,
): Promise<PayoutThreshold> {
  return apiRequest(`/finance/payout-thresholds/${encodeURIComponent(accountId)}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function listMonthlyReports(): Promise<MonthlyReportList> {
  return apiRequest("/finance/reports");
}

export function getMonthlyReport(month: string): Promise<MonthlyReportDetail> {
  return apiRequest(`/finance/reports/${encodeURIComponent(month)}`);
}

export function regenerateMonthlyReport(month: string): Promise<MonthlyReportDetail> {
  return apiRequest(`/finance/reports/${encodeURIComponent(month)}/regenerate`, { method: "POST" });
}

export function listYoutubeRevenueAccounts(): Promise<{ items: YoutubeRevenueAccountStatus[] }> {
  return apiRequest("/finance/youtube-accounts");
}

export function enableYoutubeRevenue(
  accountId: string,
  enabled: boolean,
): Promise<YoutubeRevenueAccountStatus> {
  return apiRequest(`/finance/youtube-accounts/${encodeURIComponent(accountId)}/enable`, {
    method: "POST",
    body: JSON.stringify({ enabled }),
  });
}

export function syncYoutubeRevenue(accountId: string): Promise<{
  accountId: string;
  synced: boolean;
  skipped: boolean;
  reason: string | null;
}> {
  return apiRequest(`/finance/youtube-accounts/${encodeURIComponent(accountId)}/sync`, {
    method: "POST",
  });
}

export const financeKeys = {
  all: ["finance"] as const,
  summary: (query: FinanceSummaryParams) => ["finance", "summary", query] as const,
  currency: ["finance", "currency"] as const,
  revenue: (query: object) => ["finance", "revenue", query] as const,
  costs: (query: object) => ["finance", "costs", query] as const,
  payouts: ["finance", "payouts"] as const,
  reports: ["finance", "reports"] as const,
  report: (month: string) => ["finance", "report", month] as const,
  youtube: ["finance", "youtube"] as const,
};
