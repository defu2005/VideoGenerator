import type { AppCurrency, CostKind, RevenueKind } from "@vg/shared";

export type RateTable = Record<string, number>;

export type RevenueRowInput = {
  id: string;
  accountId: string | null;
  publicationId: string | null;
  profileId: string | null;
  kind: RevenueKind;
  periodStart: string;
  periodEnd: string;
  amount: number;
  currency: string;
};

export type CostRowInput = {
  id?: string;
  profileId: string | null;
  projectId: string | null;
  kind: CostKind;
  date: string;
  amount: number;
  currency: string;
  source: "usage_auto" | "manual";
};

export type VideoViewsInput = {
  publicationId: string;
  accountId: string;
  projectId: string | null;
  profileId: string | null;
  title: string;
  platform: string | null;
  views: number | null;
};

export type AllocatedRevenue = {
  publicationId: string | null;
  accountId: string | null;
  profileId: string | null;
  amountApp: number;
  estimated: boolean;
  kind: RevenueKind;
};

export type VideoProfit = {
  publicationId: string | null;
  projectId: string | null;
  title: string;
  platform: string | null;
  views: number | null;
  revenue: number;
  revenueEstimated: boolean;
  cost: number;
  profit: number;
};

/** Convert an amount into the app currency using a manual rate table. */
export function convertToAppCurrency(
  amount: number,
  currency: string,
  appCurrency: AppCurrency,
  rates: RateTable,
): number {
  const from = currency.toUpperCase();
  const to = appCurrency.toUpperCase();
  if (from === to) return amount;
  const rate = rates[from];
  if (rate == null || !(rate > 0)) {
    throw new Error(`Thiếu tỷ giá cho ${from}`);
  }
  // rates[X] = how many appCurrency units per 1 unit of X
  return amount * rate;
}

export function buildRateTable(
  rows: Array<{ currency: string; rateToAppCurrency: number }>,
  appCurrency: AppCurrency,
): RateTable {
  const table: RateTable = { [appCurrency]: 1 };
  for (const row of rows) {
    table[row.currency.toUpperCase()] = row.rateToAppCurrency;
  }
  return table;
}

function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && aEnd >= bStart;
}

/**
 * Allocate channel-level revenue (no publicationId) to videos of the same account
 * in the overlapping period, proportional to views. Equal split when no views.
 * Direct publication-linked revenue stays as-is (estimated=false).
 */
export function allocateRevenue(
  revenues: RevenueRowInput[],
  videos: VideoViewsInput[],
  range: { from: string; to: string },
  appCurrency: AppCurrency,
  rates: RateTable,
): AllocatedRevenue[] {
  const out: AllocatedRevenue[] = [];
  const payoutFiltered = revenues.filter((r) => r.kind !== "payout");

  for (const row of payoutFiltered) {
    if (!overlaps(row.periodStart, row.periodEnd, range.from, range.to)) continue;
    const amountApp = convertToAppCurrency(row.amount, row.currency, appCurrency, rates);

    if (row.publicationId) {
      out.push({
        publicationId: row.publicationId,
        accountId: row.accountId,
        profileId: row.profileId,
        amountApp,
        estimated: false,
        kind: row.kind,
      });
      continue;
    }

    // Channel-level: allocate across videos of this account in range.
    const candidates = videos.filter((v) => {
      if (row.accountId && v.accountId !== row.accountId) return false;
      if (row.profileId && v.profileId && v.profileId !== row.profileId) return false;
      return true;
    });

    if (candidates.length === 0) {
      out.push({
        publicationId: null,
        accountId: row.accountId,
        profileId: row.profileId,
        amountApp,
        estimated: true,
        kind: row.kind,
      });
      continue;
    }

    const totalViews = candidates.reduce((sum, v) => sum + (v.views ?? 0), 0);
    if (totalViews <= 0) {
      const each = amountApp / candidates.length;
      for (const v of candidates) {
        out.push({
          publicationId: v.publicationId,
          accountId: v.accountId,
          profileId: v.profileId,
          amountApp: each,
          estimated: true,
          kind: row.kind,
        });
      }
    } else {
      for (const v of candidates) {
        const share = (v.views ?? 0) / totalViews;
        out.push({
          publicationId: v.publicationId,
          accountId: v.accountId,
          profileId: v.profileId,
          amountApp: amountApp * share,
          estimated: true,
          kind: row.kind,
        });
      }
    }
  }

  return out;
}

export function computeVideoProfits(
  allocated: AllocatedRevenue[],
  costs: CostRowInput[],
  videos: VideoViewsInput[],
  appCurrency: AppCurrency,
  rates: RateTable,
): VideoProfit[] {
  const byPub = new Map<string, { revenue: number; estimated: boolean }>();
  const unlinkedRevenue = { revenue: 0, estimated: false };

  for (const row of allocated) {
    if (!row.publicationId) {
      unlinkedRevenue.revenue += row.amountApp;
      unlinkedRevenue.estimated = unlinkedRevenue.estimated || row.estimated;
      continue;
    }
    const cur = byPub.get(row.publicationId) ?? { revenue: 0, estimated: false };
    cur.revenue += row.amountApp;
    cur.estimated = cur.estimated || row.estimated;
    byPub.set(row.publicationId, cur);
  }

  const costByProject = new Map<string, number>();
  for (const cost of costs) {
    if (!cost.projectId) continue;
    const amountApp = convertToAppCurrency(cost.amount, cost.currency, appCurrency, rates);
    costByProject.set(cost.projectId, (costByProject.get(cost.projectId) ?? 0) + amountApp);
  }

  const results: VideoProfit[] = [];
  const seen = new Set<string>();

  for (const video of videos) {
    seen.add(video.publicationId);
    const rev = byPub.get(video.publicationId) ?? { revenue: 0, estimated: false };
    const cost = video.projectId ? (costByProject.get(video.projectId) ?? 0) : 0;
    results.push({
      publicationId: video.publicationId,
      projectId: video.projectId,
      title: video.title,
      platform: video.platform,
      views: video.views,
      revenue: rev.revenue,
      revenueEstimated: rev.estimated,
      cost,
      profit: rev.revenue - cost,
    });
  }

  // Publications that have revenue but weren't in the views list.
  for (const [publicationId, rev] of byPub) {
    if (seen.has(publicationId)) continue;
    results.push({
      publicationId,
      projectId: null,
      title: publicationId,
      platform: null,
      views: null,
      revenue: rev.revenue,
      revenueEstimated: rev.estimated,
      cost: 0,
      profit: rev.revenue,
    });
  }

  if (unlinkedRevenue.revenue !== 0) {
    results.push({
      publicationId: null,
      projectId: null,
      title: "(doanh thu kênh chưa phân bổ)",
      platform: null,
      views: null,
      revenue: unlinkedRevenue.revenue,
      revenueEstimated: unlinkedRevenue.estimated,
      cost: 0,
      profit: unlinkedRevenue.revenue,
    });
  }

  return results;
}

export function sumCostsInApp(
  costs: CostRowInput[],
  appCurrency: AppCurrency,
  rates: RateTable,
  filter?: (c: CostRowInput) => boolean,
): number {
  let total = 0;
  for (const cost of costs) {
    if (filter && !filter(cost)) continue;
    total += convertToAppCurrency(cost.amount, cost.currency, appCurrency, rates);
  }
  return total;
}

export function sumRevenueInApp(allocated: AllocatedRevenue[]): number {
  return allocated.reduce((sum, row) => sum + row.amountApp, 0);
}

export function profitMargin(revenue: number, cost: number): number | null {
  if (revenue === 0) return null;
  return (revenue - cost) / revenue;
}

export function monthKey(date: string): string {
  return date.slice(0, 7);
}

export function previousMonthKey(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthDateRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const from = `${month}-01`;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const to = `${month}-${String(last).padStart(2, "0")}`;
  return { from, to };
}
