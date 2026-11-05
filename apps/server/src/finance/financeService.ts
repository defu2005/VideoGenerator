import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { FastifyBaseLogger } from "fastify";
import {
  CostEntrySchema,
  CreateCostEntryBodySchema,
  CreateRevenueEntryBodySchema,
  FinanceCsvCommitResponseSchema,
  FinanceCsvPreviewResponseSchema,
  FinanceInsightSchema,
  FinanceSummaryResponseSchema,
  MonthlyReportDetailSchema,
  MonthlyReportJsonSchema,
  MonthlyReportListSchema,
  PayoutThresholdSchema,
  RevenueEntrySchema,
  UpdateCostEntryBodySchema,
  UpdateRevenueEntryBodySchema,
  UpsertPayoutThresholdBodySchema,
  YoutubeRevenueAccountStatusSchema,
  YOUTUBE_ANALYTICS_MONETARY_READONLY_SCOPE,
  resolveBudget,
  type AppCurrency,
  type CreateCostEntryBody,
  type CreateRevenueEntryBody,
  type FinanceCsvPreviewBody,
  type FinanceSummaryQuery,
  type FinanceSummaryResponse,
  type MonthlyReportDetail,
  type MonthlyReportJson,
  type PayoutThreshold,
  type RevenueEntry,
  type CostEntry,
  type TokenSet,
  type UpdateCostEntryBody,
  type UpdateRevenueEntryBody,
  type UpsertPayoutThresholdBody,
  type YoutubeRevenueAccountStatus,
} from "@vg/shared";
import type { AppConfig } from "../lib/config.js";
import { AppError } from "../lib/errors.js";
import type { NotificationService } from "../notifications/notificationService.js";
import type { TokenVault } from "../publishing/tokenVault.js";
import type { PublisherRegistry } from "../publishing/registry.js";
import type { UsageService } from "../services/usageService.js";
import type { LlmProviderRegistry } from "../providers/llm/registry.js";
import { getAppLlmSettings } from "../providers/llm/settings.js";
import { previewRevenueCsv } from "./csvImport.js";
import {
  deleteCurrencyRate,
  getAppCurrency,
  listCurrencyRates,
  loadRateTable,
  saveAppCurrency,
  upsertCurrencyRate,
} from "./currencySettings.js";
import {
  allocateRevenue,
  computeVideoProfits,
  convertToAppCurrency,
  monthDateRange,
  monthKey,
  previousMonthKey,
  profitMargin,
  sumCostsInApp,
  sumRevenueInApp,
  type CostRowInput,
  type RevenueRowInput,
  type VideoViewsInput,
} from "./profit.js";
import { monetaryScopesMissing, syncAccountYoutubeRevenue } from "./youtubeRevenue.js";

const PAYOUT_DEDUP_MS = 7 * 24 * 60 * 60 * 1000;
const LAST_MONTHLY_REPORT_KEY = "finance.lastMonthlyReportMonth";

export type FinanceServiceDeps = {
  sqlite: Database.Database;
  vault: TokenVault;
  registry: PublisherRegistry;
  usage: UsageService;
  config: AppConfig;
  logger: FastifyBaseLogger;
  notifications?: NotificationService;
  llm?: LlmProviderRegistry;
  fetchImpl?: typeof fetch;
  now?: () => Date;
};

export class FinanceService {
  private readonly now: () => Date;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly deps: FinanceServiceDeps) {
    this.now = deps.now ?? (() => new Date());
    this.fetchImpl = deps.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  }

  setNotifications(notifications: NotificationService): void {
    this.deps.notifications = notifications;
  }

  setLlm(llm: LlmProviderRegistry): void {
    this.deps.llm = llm;
  }

  // ── Currency ──────────────────────────────────────────────

  getCurrencySettings() {
    return {
      appCurrency: getAppCurrency(this.deps.sqlite),
      rates: listCurrencyRates(this.deps.sqlite),
    };
  }

  setAppCurrency(currency: AppCurrency) {
    return { appCurrency: saveAppCurrency(this.deps.sqlite, currency) };
  }

  upsertRate(currency: string, rateToAppCurrency: number) {
    return upsertCurrencyRate(this.deps.sqlite, currency, rateToAppCurrency, this.now());
  }

  removeRate(currency: string) {
    deleteCurrencyRate(this.deps.sqlite, currency);
    return { ok: true as const };
  }

  // ── Revenue CRUD ──────────────────────────────────────────

  listRevenue(query: { from?: string; to?: string; profileId?: string; accountId?: string } = {}): RevenueEntry[] {
    const clauses: string[] = ["1=1"];
    const bindings: string[] = [];
    if (query.from) {
      clauses.push("period_end >= ?");
      bindings.push(query.from);
    }
    if (query.to) {
      clauses.push("period_start <= ?");
      bindings.push(query.to);
    }
    if (query.profileId) {
      clauses.push("profile_id = ?");
      bindings.push(query.profileId);
    }
    if (query.accountId) {
      clauses.push("account_id = ?");
      bindings.push(query.accountId);
    }
    const rows = this.deps.sqlite.prepare(
      `SELECT id, account_id AS accountId, publication_id AS publicationId, profile_id AS profileId,
        source, kind, period_start AS periodStart, period_end AS periodEnd,
        amount, currency, note, external_key AS externalKey, created_at AS createdAt
       FROM revenue_entries WHERE ${clauses.join(" AND ")}
       ORDER BY period_start DESC, created_at DESC`,
    ).all(...bindings) as Array<Record<string, unknown>>;
    return rows.map((r) => RevenueEntrySchema.parse(r));
  }

  createRevenue(body: CreateRevenueEntryBody): RevenueEntry {
    const parsed = CreateRevenueEntryBodySchema.parse(body);
    const id = randomUUID();
    const createdAt = this.now().toISOString();
    this.deps.sqlite.prepare(
      `INSERT INTO revenue_entries (
        id, account_id, publication_id, profile_id, source, kind,
        period_start, period_end, amount, currency, note, external_key, created_at
      ) VALUES (?, ?, ?, ?, 'manual', ?, ?, ?, ?, ?, ?, NULL, ?)`,
    ).run(
      id,
      parsed.accountId ?? null,
      parsed.publicationId ?? null,
      parsed.profileId ?? null,
      parsed.kind,
      parsed.periodStart,
      parsed.periodEnd,
      parsed.amount,
      parsed.currency,
      parsed.note ?? null,
      createdAt,
    );
    return this.getRevenue(id);
  }

  getRevenue(id: string): RevenueEntry {
    const row = this.deps.sqlite.prepare(
      `SELECT id, account_id AS accountId, publication_id AS publicationId, profile_id AS profileId,
        source, kind, period_start AS periodStart, period_end AS periodEnd,
        amount, currency, note, external_key AS externalKey, created_at AS createdAt
       FROM revenue_entries WHERE id = ?`,
    ).get(id) as Record<string, unknown> | undefined;
    if (!row) throw new AppError(404, "REVENUE_NOT_FOUND", "Không tìm thấy mục doanh thu");
    return RevenueEntrySchema.parse(row);
  }

  updateRevenue(id: string, body: UpdateRevenueEntryBody): RevenueEntry {
    const existing = this.getRevenue(id);
    if (existing.source === "youtube_api") {
      throw new AppError(409, "REVENUE_READONLY", "Không sửa được doanh thu đồng bộ từ YouTube");
    }
    const parsed = UpdateRevenueEntryBodySchema.parse(body);
    const next = { ...existing, ...parsed };
    this.deps.sqlite.prepare(
      `UPDATE revenue_entries SET account_id = ?, publication_id = ?, profile_id = ?, kind = ?,
        period_start = ?, period_end = ?, amount = ?, currency = ?, note = ?
       WHERE id = ?`,
    ).run(
      next.accountId,
      next.publicationId,
      next.profileId,
      next.kind,
      next.periodStart,
      next.periodEnd,
      next.amount,
      next.currency,
      next.note,
      id,
    );
    return this.getRevenue(id);
  }

  deleteRevenue(id: string): void {
    const existing = this.getRevenue(id);
    if (existing.source === "youtube_api") {
      throw new AppError(409, "REVENUE_READONLY", "Không xoá được doanh thu đồng bộ từ YouTube");
    }
    this.deps.sqlite.prepare("DELETE FROM revenue_entries WHERE id = ?").run(id);
  }

  // ── Cost CRUD ─────────────────────────────────────────────

  listCosts(query: { from?: string; to?: string; profileId?: string; projectId?: string } = {}): CostEntry[] {
    const clauses: string[] = ["source = 'manual'"];
    const bindings: string[] = [];
    if (query.from) {
      clauses.push("date >= ?");
      bindings.push(query.from);
    }
    if (query.to) {
      clauses.push("date <= ?");
      bindings.push(query.to);
    }
    if (query.profileId) {
      clauses.push("profile_id = ?");
      bindings.push(query.profileId);
    }
    if (query.projectId) {
      clauses.push("project_id = ?");
      bindings.push(query.projectId);
    }
    const rows = this.deps.sqlite.prepare(
      `SELECT id, profile_id AS profileId, project_id AS projectId, kind, date, amount, currency,
        source, note, created_at AS createdAt
       FROM cost_entries WHERE ${clauses.join(" AND ")}
       ORDER BY date DESC, created_at DESC`,
    ).all(...bindings) as Array<Record<string, unknown>>;
    return rows.map((r) => CostEntrySchema.parse(r));
  }

  createCost(body: CreateCostEntryBody): CostEntry {
    const parsed = CreateCostEntryBodySchema.parse(body);
    const id = randomUUID();
    const createdAt = this.now().toISOString();
    this.deps.sqlite.prepare(
      `INSERT INTO cost_entries (
        id, profile_id, project_id, kind, date, amount, currency, source, note, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?)`,
    ).run(
      id,
      parsed.profileId ?? null,
      parsed.projectId ?? null,
      parsed.kind,
      parsed.date,
      parsed.amount,
      parsed.currency,
      parsed.note ?? null,
      createdAt,
    );
    return this.getCost(id);
  }

  getCost(id: string): CostEntry {
    const row = this.deps.sqlite.prepare(
      `SELECT id, profile_id AS profileId, project_id AS projectId, kind, date, amount, currency,
        source, note, created_at AS createdAt
       FROM cost_entries WHERE id = ?`,
    ).get(id) as Record<string, unknown> | undefined;
    if (!row) throw new AppError(404, "COST_NOT_FOUND", "Không tìm thấy mục chi phí");
    return CostEntrySchema.parse(row);
  }

  updateCost(id: string, body: UpdateCostEntryBody): CostEntry {
    this.getCost(id);
    const parsed = UpdateCostEntryBodySchema.parse(body);
    const existing = this.getCost(id);
    const next = { ...existing, ...parsed };
    this.deps.sqlite.prepare(
      `UPDATE cost_entries SET profile_id = ?, project_id = ?, kind = ?, date = ?,
        amount = ?, currency = ?, note = ? WHERE id = ?`,
    ).run(
      next.profileId,
      next.projectId,
      next.kind,
      next.date,
      next.amount,
      next.currency,
      next.note,
      id,
    );
    return this.getCost(id);
  }

  deleteCost(id: string): void {
    this.getCost(id);
    this.deps.sqlite.prepare("DELETE FROM cost_entries WHERE id = ?").run(id);
  }

  // ── CSV ───────────────────────────────────────────────────

  previewCsv(body: FinanceCsvPreviewBody) {
    return FinanceCsvPreviewResponseSchema.parse(previewRevenueCsv(body));
  }

  commitCsv(body: FinanceCsvPreviewBody) {
    const preview = this.previewCsv(body);
    if (preview.errors.length > 0) {
      throw new AppError(
        400,
        "CSV_INVALID",
        `CSV có lỗi ở dòng: ${[...new Set(preview.errors.map((e) => e.rowNumber))].join(", ")}`,
      );
    }
    const createdAt = this.now().toISOString();
    const insert = this.deps.sqlite.prepare(
      `INSERT INTO revenue_entries (
        id, account_id, publication_id, profile_id, source, kind,
        period_start, period_end, amount, currency, note, external_key, created_at
      ) VALUES (?, ?, ?, ?, 'import_csv', ?, ?, ?, ?, ?, ?, NULL, ?)`,
    );
    const tx = this.deps.sqlite.transaction(() => {
      for (const row of preview.rows) {
        insert.run(
          randomUUID(),
          row.accountId,
          row.publicationId,
          row.profileId,
          row.kind,
          row.periodStart,
          row.periodEnd,
          row.amount,
          row.currency,
          row.note,
          createdAt,
        );
      }
    });
    tx();
    return FinanceCsvCommitResponseSchema.parse({ inserted: preview.rows.length });
  }

  // ── Payout thresholds ─────────────────────────────────────

  listPayoutThresholds(): PayoutThreshold[] {
    const rows = this.deps.sqlite.prepare(
      `SELECT t.account_id AS accountId, t.threshold_amount AS thresholdAmount, t.currency,
        t.current_balance AS currentBalance, t.last_notified_at AS lastNotifiedAt,
        a.display_name AS displayName, a.platform AS platform
       FROM payout_thresholds t
       JOIN platform_accounts a ON a.id = t.account_id
       ORDER BY a.display_name`,
    ).all() as Array<Record<string, unknown>>;
    return rows.map((r) => PayoutThresholdSchema.parse(r));
  }

  upsertPayoutThreshold(accountId: string, body: UpsertPayoutThresholdBody): PayoutThreshold {
    const account = this.deps.sqlite.prepare(
      "SELECT id, display_name AS displayName, platform FROM platform_accounts WHERE id = ?",
    ).get(accountId) as { id: string; displayName: string; platform: string } | undefined;
    if (!account) throw new AppError(404, "ACCOUNT_NOT_FOUND", "Không tìm thấy tài khoản");
    const parsed = UpsertPayoutThresholdBodySchema.parse(body);
    this.deps.sqlite.prepare(
      `INSERT INTO payout_thresholds (account_id, threshold_amount, currency, current_balance, last_notified_at)
       VALUES (?, ?, ?, ?, NULL)
       ON CONFLICT(account_id) DO UPDATE SET
         threshold_amount = excluded.threshold_amount,
         currency = excluded.currency,
         current_balance = excluded.current_balance`,
    ).run(accountId, parsed.thresholdAmount, parsed.currency, parsed.currentBalance ?? null);
    return this.listPayoutThresholds().find((t) => t.accountId === accountId)!;
  }

  deletePayoutThreshold(accountId: string): void {
    this.deps.sqlite.prepare("DELETE FROM payout_thresholds WHERE account_id = ?").run(accountId);
  }

  /** Effective balance: manual currentBalance, else sum of non-payout revenue − payouts since last payout. */
  effectiveBalance(accountId: string, currency: string): number {
    const row = this.deps.sqlite.prepare(
      "SELECT current_balance AS currentBalance FROM payout_thresholds WHERE account_id = ?",
    ).get(accountId) as { currentBalance: number | null } | undefined;
    if (row?.currentBalance != null) return row.currentBalance;

    const lastPayout = this.deps.sqlite.prepare(
      `SELECT period_end FROM revenue_entries
       WHERE account_id = ? AND kind = 'payout' AND currency = ?
       ORDER BY period_end DESC LIMIT 1`,
    ).get(accountId, currency) as { period_end: string } | undefined;

    const clauses = ["account_id = ?", "currency = ?", "kind != 'payout'"];
    const bindings: string[] = [accountId, currency];
    if (lastPayout) {
      clauses.push("period_start > ?");
      bindings.push(lastPayout.period_end);
    }
    const sum = this.deps.sqlite.prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM revenue_entries WHERE ${clauses.join(" AND ")}`,
    ).get(...bindings) as { total: number };
    return sum.total;
  }

  async checkPayoutReminders(): Promise<void> {
    const thresholds = this.listPayoutThresholds();
    const nowMs = this.now().getTime();
    for (const t of thresholds) {
      const balance = this.effectiveBalance(t.accountId, t.currency);
      if (balance < t.thresholdAmount) continue;
      if (t.lastNotifiedAt) {
        const last = Date.parse(t.lastNotifiedAt);
        if (Number.isFinite(last) && nowMs - last < PAYOUT_DEDUP_MS) continue;
      }
      const message =
        `Số dư ${formatMoney(balance, t.currency)} đã đủ để rút (ngưỡng ${formatMoney(t.thresholdAmount, t.currency)}), hãy rút trong app ${t.platform ?? ""} (${t.displayName ?? t.accountId}).`;
      if (this.deps.notifications) {
        await this.deps.notifications.notify({
          kind: "account_error",
          accountId: t.accountId,
          account: t.displayName ?? t.accountId,
          error: message,
        });
      }
      this.deps.sqlite.prepare(
        "UPDATE payout_thresholds SET last_notified_at = ? WHERE account_id = ?",
      ).run(this.now().toISOString(), t.accountId);
    }
  }

  // ── Summary / profit ──────────────────────────────────────

  getSummary(query: FinanceSummaryQuery): FinanceSummaryResponse {
    const { appCurrency, rates } = loadRateTable(this.deps.sqlite, this.deps.config.USD_VND_RATE);
    const revenues = this.loadRevenueRows(query);
    const videos = this.loadVideoViews(query);
    const allocated = allocateRevenue(revenues, videos, { from: query.from, to: query.to }, appCurrency, rates);
    const costs = this.loadAllCosts(query, appCurrency, rates);
    const videoProfits = computeVideoProfits(allocated, costs, videos, appCurrency, rates);

    const revenue = sumRevenueInApp(allocated);
    const cost = sumCostsInApp(costs, appCurrency, rates);
    const profit = revenue - cost;

    const byMonthMap = new Map<string, { revenue: number; cost: number }>();
    for (const row of revenues.filter((r) => r.kind !== "payout")) {
      try {
        const amount = convertToAppCurrency(row.amount, row.currency, appCurrency, rates);
        const m = monthKey(row.periodStart);
        const cur = byMonthMap.get(m) ?? { revenue: 0, cost: 0 };
        cur.revenue += amount;
        byMonthMap.set(m, cur);
      } catch {
        // skip missing rate
      }
    }
    for (const c of costs) {
      try {
        const amount = convertToAppCurrency(c.amount, c.currency, appCurrency, rates);
        const m = monthKey(c.date);
        const cur = byMonthMap.get(m) ?? { revenue: 0, cost: 0 };
        cur.cost += amount;
        byMonthMap.set(m, cur);
      } catch {
        // skip
      }
    }

    const profileNames = new Map<string, string>();
    for (const row of this.deps.sqlite.prepare("SELECT id, name FROM profiles").all() as Array<{ id: string; name: string }>) {
      profileNames.set(row.id, row.name);
    }

    const byProfileMap = new Map<string | null, { revenue: number; cost: number }>();
    for (const row of allocated) {
      const key = row.profileId;
      const cur = byProfileMap.get(key) ?? { revenue: 0, cost: 0 };
      cur.revenue += row.amountApp;
      byProfileMap.set(key, cur);
    }
    for (const c of costs) {
      try {
        const amount = convertToAppCurrency(c.amount, c.currency, appCurrency, rates);
        const key = c.profileId;
        const cur = byProfileMap.get(key) ?? { revenue: 0, cost: 0 };
        cur.cost += amount;
        byProfileMap.set(key, cur);
      } catch {
        // skip
      }
    }

    const byPlatformMap = new Map<string | null, { revenue: number; cost: number }>();
    for (const vp of videoProfits) {
      const key = vp.platform;
      const cur = byPlatformMap.get(key) ?? { revenue: 0, cost: 0 };
      cur.revenue += vp.revenue;
      cur.cost += vp.cost;
      byPlatformMap.set(key, cur);
    }

    const revenueByKindMap = new Map<string, number>();
    for (const row of allocated) {
      revenueByKindMap.set(row.kind, (revenueByKindMap.get(row.kind) ?? 0) + row.amountApp);
    }
    const costByKindMap = new Map<string, { amount: number; source: "usage_auto" | "manual" }>();
    for (const c of costs) {
      try {
        const amount = convertToAppCurrency(c.amount, c.currency, appCurrency, rates);
        const cur = costByKindMap.get(c.kind) ?? { amount: 0, source: c.source };
        cur.amount += amount;
        costByKindMap.set(c.kind, cur);
      } catch {
        // skip
      }
    }

    return FinanceSummaryResponseSchema.parse({
      from: query.from,
      to: query.to,
      currency: appCurrency,
      kpi: {
        revenue,
        cost,
        profit,
        margin: profitMargin(revenue, cost),
        currency: appCurrency,
      },
      byMonth: [...byMonthMap.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, v]) => ({ month, revenue: v.revenue, cost: v.cost })),
      byProfile: [...byProfileMap.entries()].map(([profileId, v]) => ({
        profileId,
        profileName: profileId ? (profileNames.get(profileId) ?? profileId) : "(không hồ sơ)",
        revenue: v.revenue,
        cost: v.cost,
        profit: v.revenue - v.cost,
      })),
      byPlatform: [...byPlatformMap.entries()].map(([platform, v]) => ({
        platform: platform as FinanceSummaryResponse["byPlatform"][number]["platform"],
        revenue: v.revenue,
        cost: v.cost,
        profit: v.revenue - v.cost,
      })),
      byVideo: videoProfits.sort((a, b) => b.profit - a.profit),
      revenueByKind: [...revenueByKindMap.entries()].map(([kind, amount]) => ({
        kind: kind as RevenueEntry["kind"],
        amount,
      })),
      costByKind: [...costByKindMap.entries()].map(([kind, v]) => ({
        kind: kind as CostEntry["kind"],
        amount: v.amount,
        source: v.source,
      })),
    });
  }

  // ── Monthly reports ───────────────────────────────────────

  listReports() {
    const rows = this.deps.sqlite.prepare(
      `SELECT month, created_at AS createdAt, json FROM monthly_reports ORDER BY month DESC`,
    ).all() as Array<{ month: string; createdAt: string; json: string | Record<string, unknown> }>;
    return MonthlyReportListSchema.parse({
      items: rows.map((r) => {
        const json = typeof r.json === "string" ? JSON.parse(r.json) as MonthlyReportJson : r.json as MonthlyReportJson;
        return {
          month: r.month,
          createdAt: r.createdAt,
          hasInsight: Array.isArray(json.insightBullets) && json.insightBullets.length > 0,
        };
      }),
    });
  }

  getReport(month: string): MonthlyReportDetail {
    const row = this.deps.sqlite.prepare(
      `SELECT month, created_at AS createdAt, json FROM monthly_reports WHERE month = ?`,
    ).get(month) as { month: string; createdAt: string; json: string | Record<string, unknown> } | undefined;
    if (!row) throw new AppError(404, "REPORT_NOT_FOUND", `Chưa có báo cáo tháng ${month}`);
    const json = typeof row.json === "string" ? JSON.parse(row.json) : row.json;
    return MonthlyReportDetailSchema.parse({
      month: row.month,
      createdAt: row.createdAt,
      report: MonthlyReportJsonSchema.parse(json),
    });
  }

  async generateMonthlyReport(month: string, opts: { force?: boolean } = {}): Promise<MonthlyReportDetail> {
    if (!opts.force) {
      const existing = this.deps.sqlite.prepare(
        "SELECT 1 AS ok FROM monthly_reports WHERE month = ?",
      ).get(month) as { ok: number } | undefined;
      if (existing) return this.getReport(month);
    }

    const range = monthDateRange(month);
    const summary = this.getSummary({ from: range.from, to: range.to });
    const prevMonth = previousMonthKey(month);
    const prevRange = monthDateRange(prevMonth);
    let previousMonth: MonthlyReportJson["previousMonth"] = null;
    let momChange: MonthlyReportJson["momChange"] = null;
    try {
      const prev = this.getSummary({ from: prevRange.from, to: prevRange.to });
      previousMonth = {
        revenue: prev.kpi.revenue,
        cost: prev.kpi.cost,
        profit: prev.kpi.profit,
      };
      momChange = {
        revenue: summary.kpi.revenue - prev.kpi.revenue,
        cost: summary.kpi.cost - prev.kpi.cost,
        profit: summary.kpi.profit - prev.kpi.profit,
      };
    } catch {
      // no previous data
    }

    const { startIso, endIso } = monthIsoBounds(month);
    const videosPublished = (this.deps.sqlite.prepare(
      `SELECT COUNT(*) AS count FROM publications
       WHERE status = 'PUBLISHED' AND published_at >= ? AND published_at < ?`,
    ).get(startIso, endIso) as { count: number }).count;
    const publishFailures = (this.deps.sqlite.prepare(
      `SELECT COUNT(*) AS count FROM publications
       WHERE status = 'FAILED' AND updated_at >= ? AND updated_at < ?`,
    ).get(startIso, endIso) as { count: number }).count;

    const topByViews = [...summary.byVideo]
      .filter((v) => v.views != null)
      .sort((a, b) => (b.views ?? 0) - (a.views ?? 0))
      .slice(0, 5);

    let insightBullets: string[] | undefined;
    try {
      insightBullets = await this.maybeFinanceInsight(summary, month);
    } catch (error) {
      this.deps.logger.warn({ err: error instanceof Error ? error.message : String(error) }, "financeInsight skipped");
    }

    const report: MonthlyReportJson = MonthlyReportJsonSchema.parse({
      month,
      currency: summary.currency,
      revenueByPlatform: summary.byPlatform.map((p) => ({ platform: p.platform, amount: p.revenue })),
      revenueByProfile: summary.byProfile.map((p) => ({
        profileId: p.profileId,
        profileName: p.profileName,
        amount: p.revenue,
      })),
      revenueByKind: summary.revenueByKind,
      costByKind: summary.costByKind.map((c) => ({ kind: c.kind, amount: c.amount })),
      profit: summary.kpi.profit,
      margin: summary.kpi.margin,
      topVideosByProfit: summary.byVideo.slice(0, 5),
      topVideosByViews: topByViews,
      videosPublished,
      publishFailures,
      previousMonth,
      momChange,
      ...(insightBullets ? { insightBullets } : {}),
    });

    const createdAt = this.now().toISOString();
    this.deps.sqlite.prepare(
      `INSERT INTO monthly_reports (month, json, created_at) VALUES (?, ?, ?)
       ON CONFLICT(month) DO UPDATE SET json = excluded.json, created_at = excluded.created_at`,
    ).run(month, JSON.stringify(report), createdAt);

    return MonthlyReportDetailSchema.parse({ month, createdAt, report });
  }

  async maybeSendMonthlyReport(): Promise<void> {
    const settings = this.deps.notifications
      ? (await import("../settings/notifications.js")).getNotificationSettings(this.deps.sqlite)
      : null;
    if (!settings?.events.dailySummary) return;

    const now = this.now();
    const dateKey = localDateKey(now, settings.timezone);
    // Only on the 1st of the month.
    if (!dateKey.endsWith("-01") && localDayOfMonth(now, settings.timezone) !== 1) return;

    const minutes = localMinutes(now, settings.timezone);
    const target = parseHhMm(settings.dailySummaryTime);
    if (minutes < target) return;

    const prev = previousCalendarMonth(dateKey);
    const last = getLastMonthlyReportMonth(this.deps.sqlite);
    if (last === prev) return;

    const detail = await this.generateMonthlyReport(prev, { force: false });
    const link = `${this.webBaseUrl()}/finance?report=${prev}`;
    const text = [
      `Doanh thu: ${formatMoney(detail.report.revenueByKind.reduce((s, r) => s + r.amount, 0), detail.report.currency)}`,
      `Chi phí: ${formatMoney(detail.report.costByKind.reduce((s, c) => s + c.amount, 0), detail.report.currency)}`,
      `Lợi nhuận: ${formatMoney(detail.report.profit, detail.report.currency)}`,
      `Video đăng: ${detail.report.videosPublished} · Thất bại: ${detail.report.publishFailures}`,
      link,
    ].join("\n");

    if (this.deps.notifications) {
      await this.deps.notifications.notify({
        kind: "monthly_report",
        month: prev,
        text,
        link,
      });
    }
    const existing = this.deps.sqlite.prepare(
      "SELECT 1 AS ok FROM notification_log WHERE subject_key = ? LIMIT 1",
    ).get(`monthly_report:${prev}`) as { ok: number } | undefined;
    if (existing) saveLastMonthlyReportMonth(this.deps.sqlite, prev);
  }

  // ── YouTube revenue sync ──────────────────────────────────

  listYoutubeRevenueAccounts(): YoutubeRevenueAccountStatus[] {
    const rows = this.deps.sqlite.prepare(
      `SELECT id, profile_id AS profileId, display_name AS displayName, platform,
        revenue_sync_enabled AS revenueSyncEnabled, revenue_status AS revenueStatus,
        revenue_synced_at AS lastSyncAt, revenue_last_error AS lastError
       FROM platform_accounts WHERE platform = 'youtube'`,
    ).all() as Array<{
      id: string;
      profileId: string;
      displayName: string;
      platform: "youtube";
      revenueSyncEnabled: number | boolean;
      revenueStatus: string | null;
      lastSyncAt: string | null;
      lastError: string | null;
    }>;

    return rows.map((row) => {
      const tokens = this.deps.vault.loadTokens(row.id);
      const missing = row.revenueSyncEnabled
        ? monetaryScopesMissing(tokens?.scopes)
        : [];
      return YoutubeRevenueAccountStatusSchema.parse({
        accountId: row.id,
        profileId: row.profileId,
        displayName: row.displayName,
        platform: row.platform,
        revenueSyncEnabled: Boolean(row.revenueSyncEnabled),
        revenueStatus: row.revenueStatus,
        lastSyncAt: row.lastSyncAt,
        lastError: row.lastError,
        missingScopes: missing,
      });
    });
  }

  setYoutubeRevenueEnabled(accountId: string, enabled: boolean): YoutubeRevenueAccountStatus {
    const account = this.deps.sqlite.prepare(
      "SELECT id, platform FROM platform_accounts WHERE id = ?",
    ).get(accountId) as { id: string; platform: string } | undefined;
    if (!account) throw new AppError(404, "ACCOUNT_NOT_FOUND", "Không tìm thấy tài khoản");
    if (account.platform !== "youtube") {
      throw new AppError(400, "NOT_YOUTUBE", "Chỉ bật doanh thu API cho tài khoản YouTube");
    }

    let revenueStatus: string | null = null;
    let lastError: string | null = null;
    if (enabled) {
      const tokens = this.deps.vault.loadTokens(accountId);
      const missing = monetaryScopesMissing(tokens?.scopes);
      if (missing.length > 0) {
        revenueStatus = "needs_reconnect";
        lastError = "Kết nối lại để cấp quyền thống kê doanh thu YouTube";
      } else {
        revenueStatus = "ok";
      }
    }

    this.deps.sqlite.prepare(
      `UPDATE platform_accounts SET revenue_sync_enabled = ?, revenue_status = ?,
        revenue_last_error = ?, updated_at = ? WHERE id = ?`,
    ).run(enabled ? 1 : 0, revenueStatus, lastError, this.now().toISOString(), accountId);

    return this.listYoutubeRevenueAccounts().find((a) => a.accountId === accountId)!;
  }

  async syncYoutubeRevenue(accountId: string, signal = AbortSignal.timeout(60_000)): Promise<{
    synced: boolean;
    skipped: boolean;
    reason: string | null;
    inserted: number;
    updated: number;
  }> {
    const account = this.deps.sqlite.prepare(
      `SELECT id, profile_id AS profileId, platform, external_id AS externalId,
        revenue_sync_enabled AS revenueSyncEnabled, revenue_status AS revenueStatus
       FROM platform_accounts WHERE id = ?`,
    ).get(accountId) as {
      id: string;
      profileId: string;
      platform: string;
      externalId: string | null;
      revenueSyncEnabled: number | boolean;
      revenueStatus: string | null;
    } | undefined;

    if (!account) {
      return { synced: false, skipped: true, reason: "Không tìm thấy tài khoản", inserted: 0, updated: 0 };
    }
    if (!account.revenueSyncEnabled) {
      return { synced: false, skipped: true, reason: "Chưa bật thống kê doanh thu", inserted: 0, updated: 0 };
    }
    if (account.revenueStatus === "not_monetized") {
      return { synced: false, skipped: true, reason: "Kênh chưa bật kiếm tiền", inserted: 0, updated: 0 };
    }

    const tokens = await this.refreshTokensIfNeeded(accountId);
    if (!tokens) {
      this.setRevenueStatus(accountId, "needs_reconnect", "Không có token");
      return { synced: false, skipped: true, reason: "Không có token", inserted: 0, updated: 0 };
    }
    const missing = monetaryScopesMissing(tokens.scopes);
    if (missing.length > 0) {
      this.setRevenueStatus(accountId, "needs_reconnect", "Kết nối lại để cấp quyền thống kê doanh thu YouTube");
      return { synced: false, skipped: true, reason: "needs_reconnect", inserted: 0, updated: 0 };
    }

    const to = isoDate(this.now());
    const fromDate = new Date(this.now());
    fromDate.setUTCDate(fromDate.getUTCDate() - 29);
    const from = isoDate(fromDate);
    const channelId = account.externalId ?? "MINE";

    const result = await syncAccountYoutubeRevenue({
      sqlite: this.deps.sqlite,
      accountId,
      profileId: account.profileId,
      channelId,
      tokens,
      from,
      to,
      signal,
      fetchImpl: this.fetchImpl,
      nowIso: this.now().toISOString(),
    });

    if (!result.ok) {
      if (result.notMonetized) {
        this.setRevenueStatus(accountId, "not_monetized", "Kênh chưa bật kiếm tiền");
      } else {
        this.setRevenueStatus(accountId, "ok", result.error);
      }
      return { synced: false, skipped: true, reason: result.error, inserted: 0, updated: 0 };
    }

    this.setRevenueStatus(accountId, "ok", null, this.now().toISOString());
    return {
      synced: true,
      skipped: false,
      reason: null,
      inserted: result.result.inserted,
      updated: result.result.updated,
    };
  }

  async tick(signal?: AbortSignal): Promise<void> {
    try {
      await this.maybeSendMonthlyReport();
      await this.checkPayoutReminders();
      const accounts = this.listYoutubeRevenueAccounts().filter((a) => a.revenueSyncEnabled && a.revenueStatus !== "not_monetized");
      for (const account of accounts) {
        if (signal?.aborted) break;
        // Sync at most once per day per account.
        if (account.lastSyncAt) {
          const last = Date.parse(account.lastSyncAt);
          if (Number.isFinite(last) && this.now().getTime() - last < 20 * 60 * 60 * 1000) continue;
        }
        await this.syncYoutubeRevenue(account.accountId, signal ?? AbortSignal.timeout(60_000));
      }
    } catch (error) {
      this.deps.logger.warn(
        { err: error instanceof Error ? error.message : String(error) },
        "Finance tick failed",
      );
    }
  }

  // ── Internals ─────────────────────────────────────────────

  private webBaseUrl(): string {
    return this.deps.config.WEB_BASE_URL?.replace(/\/$/, "")
      || this.deps.config.CORS_ORIGIN?.replace(/\/$/, "")
      || "http://localhost:5180";
  }

  private setRevenueStatus(
    accountId: string,
    status: string,
    error: string | null,
    syncedAt?: string,
  ): void {
    this.deps.sqlite.prepare(
      `UPDATE platform_accounts SET revenue_status = ?, revenue_last_error = ?,
        revenue_synced_at = COALESCE(?, revenue_synced_at), updated_at = ? WHERE id = ?`,
    ).run(status, error, syncedAt ?? null, this.now().toISOString(), accountId);
  }

  private async refreshTokensIfNeeded(accountId: string): Promise<TokenSet | null> {
    let tokens = this.deps.vault.loadTokens(accountId);
    if (!tokens) return null;
    const publisher = this.deps.registry.get("youtube");
    if (!publisher) return tokens;
    try {
      if (tokens.expiresAt) {
        const expiresAt = Date.parse(tokens.expiresAt);
        if (Number.isFinite(expiresAt) && expiresAt - Date.now() > 60_000) return tokens;
      }
      const refreshed = await publisher.oauth.refresh(tokens, AbortSignal.timeout(30_000), accountId);
      this.deps.vault.storeTokens(accountId, refreshed, refreshed.scopes);
      tokens = refreshed;
    } catch {
      // keep existing
    }
    return tokens;
  }

  private loadRevenueRows(query: FinanceSummaryQuery): RevenueRowInput[] {
    return this.listRevenue({
      from: query.from,
      to: query.to,
      profileId: query.profileId,
    }).map((r) => ({
      id: r.id,
      accountId: r.accountId,
      publicationId: r.publicationId,
      profileId: r.profileId,
      kind: r.kind,
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
      amount: r.amount,
      currency: r.currency,
    }));
  }

  private loadVideoViews(query: FinanceSummaryQuery): VideoViewsInput[] {
    const clauses = ["pub.status = 'PUBLISHED'"];
    const bindings: string[] = [];
    if (query.profileId) {
      clauses.push("a.profile_id = ?");
      bindings.push(query.profileId);
    }
    if (query.from) {
      clauses.push("(pub.published_at IS NULL OR substr(pub.published_at, 1, 10) <= ?)");
      bindings.push(query.to);
    }
    const rows = this.deps.sqlite.prepare(
      `SELECT pub.id AS publicationId, pub.account_id AS accountId, pub.project_id AS projectId,
        a.profile_id AS profileId, a.platform AS platform,
        COALESCE(proj.title, pub.external_id, pub.id) AS title,
        CAST(json_extract(pub.latest_metrics, '$.views') AS INTEGER) AS views
       FROM publications pub
       JOIN platform_accounts a ON a.id = pub.account_id
       LEFT JOIN projects proj ON proj.id = pub.project_id
       WHERE ${clauses.join(" AND ")}`,
    ).all(...bindings) as Array<{
      publicationId: string;
      accountId: string;
      projectId: string | null;
      profileId: string;
      platform: string;
      title: string;
      views: number | null;
    }>;
    return rows.map((r) => ({
      publicationId: r.publicationId,
      accountId: r.accountId,
      projectId: r.projectId,
      profileId: r.profileId,
      title: r.title || r.publicationId,
      platform: r.platform,
      views: r.views,
    }));
  }

  private loadAllCosts(
    query: FinanceSummaryQuery,
    appCurrency: AppCurrency,
    rates: ReturnType<typeof loadRateTable>["rates"],
  ): CostRowInput[] {
    const manual = this.listCosts({
      from: query.from,
      to: query.to,
      profileId: query.profileId,
    }).map((c) => ({
      id: c.id,
      profileId: c.profileId,
      projectId: c.projectId,
      kind: c.kind,
      date: c.date,
      amount: c.amount,
      currency: c.currency,
      source: "manual" as const,
    }));

    // Live LLM usage from jobs → usage_auto / llm.
    const usageCosts: CostRowInput[] = [];
    const projectFilter = query.profileId
      ? (this.deps.sqlite.prepare(
        "SELECT id FROM projects WHERE profile_id = ?",
      ).all(query.profileId) as Array<{ id: string }>).map((p) => p.id)
      : null;

    const usage = this.deps.usage.getAppUsage({
      from: query.from,
      to: query.to,
      groupBy: "day",
    });

    // Per-project usage for allocation.
    const projectRows = this.deps.sqlite.prepare(
      `SELECT DISTINCT j.project_id AS projectId, p.profile_id AS profileId,
        substr(COALESCE(j.started_at, j.created_at), 1, 10) AS day,
        j.usage AS usage
       FROM jobs j
       JOIN projects p ON p.id = j.project_id
       WHERE j.usage IS NOT NULL
         AND substr(COALESCE(j.started_at, j.created_at), 1, 10) >= ?
         AND substr(COALESCE(j.started_at, j.created_at), 1, 10) <= ?`,
    ).all(query.from, query.to) as Array<{
      projectId: string;
      profileId: string | null;
      day: string;
      usage: string;
    }>;

    const byProjectDay = new Map<string, number>();
    for (const row of projectRows) {
      if (projectFilter && !projectFilter.includes(row.projectId)) continue;
      if (query.profileId && row.profileId !== query.profileId) continue;
      let costUsd = 0;
      try {
        const parsed = typeof row.usage === "string" ? JSON.parse(row.usage) as { costUsd?: number } : row.usage as { costUsd?: number };
        costUsd = Number(parsed.costUsd ?? 0) || 0;
      } catch {
        continue;
      }
      if (!(costUsd > 0)) continue;
      const key = `${row.projectId}|${row.day}|${row.profileId ?? ""}`;
      byProjectDay.set(key, (byProjectDay.get(key) ?? 0) + costUsd);
    }

    for (const [key, costUsd] of byProjectDay) {
      const [projectId, day, profileId] = key.split("|");
      // Prefer converting USD via rate table; fall back to leaving as USD if app is USD.
      let amount = costUsd;
      let currency: string = "USD";
      try {
        amount = convertToAppCurrency(costUsd, "USD", appCurrency, rates);
        currency = appCurrency;
      } catch {
        // keep USD
      }
      usageCosts.push({
        profileId: profileId || null,
        projectId: projectId!,
        kind: "llm",
        date: day!,
        amount,
        currency,
        source: "usage_auto",
      });
    }

    // Also surface unused aggregated usage when no project rows (for profile-level totals).
    void usage;

    return [...manual, ...usageCosts];
  }

  private async maybeFinanceInsight(
    summary: FinanceSummaryResponse,
    month: string,
  ): Promise<string[] | undefined> {
    if (!this.deps.llm) return undefined;
    const features = resolveBudget("BALANCED");
    if (!features.financeInsight) return undefined;

    const { generateRoutedStructured } = await import("../providers/llm/structured.js");
    const { LlmCache } = await import("../providers/llm/cache.js");
    const appRouting = getAppLlmSettings(this.deps.sqlite);
    const stubProject = {
      id: "finance-insight",
      mode: "AUTO" as const,
      settings: { language: "vi", budget: { mode: "BALANCED" as const } },
    };
    const route = this.deps.llm.resolveTask("financeInsight", stubProject as never, appRouting);
    const cache = new LlmCache(this.deps.sqlite, true);
    const result = await generateRoutedStructured({
      registry: this.deps.llm,
      route,
      task: "financeInsight",
      system: [
        "Bạn là chuyên gia phân tích doanh thu kênh.",
        "Trả về đúng JSON { bullets: string[3..5] } bằng tiếng Việt, ngắn gọn.",
        "Reply with JSON only.",
      ].join(" "),
      prompt: JSON.stringify({
        month,
        currency: summary.currency,
        kpi: summary.kpi,
        byPlatform: summary.byPlatform,
        revenueByKind: summary.revenueByKind,
        costByKind: summary.costByKind,
        topVideos: summary.byVideo.slice(0, 5),
      }),
      schema: FinanceInsightSchema,
      schemaName: "FinanceInsight",
      schemaVersion: "1",
      maxOutputTokens: route.maxOutputTokens ?? 1_024,
      signal: AbortSignal.timeout(60_000),
      cache,
    });
    const parsed = FinanceInsightSchema.safeParse(result.value);
    return parsed.success ? parsed.data.bullets : undefined;
  }
}

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("vi-VN", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function localDateKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function localDayOfMonth(date: Date, timeZone: string): number {
  return Number(localDateKey(date, timeZone).slice(8, 10));
}

function localMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

function parseHhMm(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function previousCalendarMonth(dateKey: string): string {
  return previousMonthKey(dateKey.slice(0, 7));
}

function monthIsoBounds(month: string): { startIso: string; endIso: string } {
  const [y, m] = month.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1));
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

function getLastMonthlyReportMonth(sqlite: Database.Database): string | null {
  const row = sqlite.prepare("SELECT value FROM app_settings WHERE key = ?").get(LAST_MONTHLY_REPORT_KEY) as
    | { value: string }
    | undefined;
  if (!row) return null;
  const value = typeof row.value === "string" ? JSON.parse(row.value) as unknown : row.value;
  return typeof value === "string" ? value : null;
}

function saveLastMonthlyReportMonth(sqlite: Database.Database, month: string): void {
  sqlite.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(LAST_MONTHLY_REPORT_KEY, JSON.stringify(month), new Date().toISOString());
}

// Re-export monetary scope for publishers.
export { YOUTUBE_ANALYTICS_MONETARY_READONLY_SCOPE };
