import type Database from "better-sqlite3";
import { profileScopeSql } from "../auth/requestContext.js";
import { scoreMapForProfiles } from "../learning/loadRows.js";
import type {
  AnalyticsDayPoint,
  AnalyticsKpiTotals,
  AnalyticsOverviewQuery,
  AnalyticsOverviewResponse,
  AnalyticsPlatformSplit,
  AnalyticsVideoRankItem,
  PlatformId,
} from "@vg/shared";

type PubJoinRow = {
  id: string;
  project_id: string | null;
  title: string;
  platform: PlatformId;
  profile_id: string;
  published_at: string | null;
  external_url: string | null;
  latest_metrics: string | null;
};

type SnapshotDayRow = {
  day: string;
  platform: PlatformId;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  watch_time_sec: number | null;
};

type ChannelDayRow = {
  day: string;
  platform: PlatformId;
  views: number | null;
  watch_time_sec: number | null;
  followers: number | null;
  account_id: string;
};

function emptyTotals(): AnalyticsKpiTotals {
  return { views: 0, likes: 0, comments: 0, shares: 0, watchHours: 0, followersDelta: 0 };
}

function parseMetrics(raw: string | null): {
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  watchTimeSec: number | null;
  avgViewPct: number | null;
} {
  if (!raw) {
    return {
      views: null,
      likes: null,
      comments: null,
      shares: null,
      watchTimeSec: null,
      avgViewPct: null,
    };
  }
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) as Record<string, unknown> : raw;
    return {
      views: toNullableNumber(parsed.views),
      likes: toNullableNumber(parsed.likes),
      comments: toNullableNumber(parsed.comments),
      shares: toNullableNumber(parsed.shares),
      watchTimeSec: toNullableNumber(parsed.watchTimeSec),
      avgViewPct: toNullableNumber(parsed.avgViewPct),
    };
  } catch {
    return {
      views: null,
      likes: null,
      comments: null,
      shares: null,
      watchTimeSec: null,
      avgViewPct: null,
    };
  }
}

function toNullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetweenInclusive(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00.000Z`);
  const b = Date.parse(`${to}T00:00:00.000Z`);
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

function sumMetrics(items: AnalyticsVideoRankItem[]): Omit<AnalyticsKpiTotals, "followersDelta"> {
  let views = 0;
  let likes = 0;
  let comments = 0;
  let shares = 0;
  let watchSec = 0;
  for (const item of items) {
    views += item.views ?? 0;
    likes += item.likes ?? 0;
    comments += item.comments ?? 0;
    shares += item.shares ?? 0;
  }
  // watch hours come from latest_metrics.watchTimeSec — re-read via videos' raw not available;
  // callers that need watchHours should pass it separately. Here we only have rank items.
  void watchSec;
  return { views, likes, comments, shares, watchHours: 0 };
}

function loadPublishedVideos(
  sqlite: Database.Database,
  from: string,
  to: string,
  profileId?: string,
  platform?: PlatformId,
): { videos: AnalyticsVideoRankItem[]; watchHours: number } {
  const where: string[] = [
    "p.status = 'PUBLISHED'",
    "p.published_at IS NOT NULL",
    "date(p.published_at) >= date(?)",
    "date(p.published_at) <= date(?)",
  ];
  const params: unknown[] = [from, to];
  const scoped = profileScopeSql("a.profile_id");
  where.push(scoped.sql);
  params.push(...scoped.args);

  if (profileId) {
    where.push("(proj.profile_id = ? OR a.profile_id = ?)");
    params.push(profileId, profileId);
  }
  if (platform) {
    where.push("a.platform = ?");
    params.push(platform);
  }

  const rows = sqlite.prepare(
    `SELECT p.id, p.project_id, COALESCE(proj.title, '') AS title, a.platform, a.profile_id,
            p.published_at, p.external_url, p.latest_metrics
     FROM publications p
     JOIN platform_accounts a ON a.id = p.account_id
     LEFT JOIN projects proj ON proj.id = p.project_id
     WHERE ${where.join(" AND ")}
     ORDER BY p.published_at DESC`,
  ).all(...params) as PubJoinRow[];

  let watchHours = 0;
  const scores = scoreMapForProfiles(sqlite, rows.map((row) => row.profile_id));
  const videos: AnalyticsVideoRankItem[] = rows.map((row) => {
    const m = parseMetrics(row.latest_metrics);
    watchHours += (m.watchTimeSec ?? 0) / 3600;
    return {
      publicationId: row.id,
      projectId: row.project_id,
      title: row.title || "(không tiêu đề)",
      platform: row.platform,
      publishedAt: row.published_at,
      externalUrl: row.external_url,
      views: m.views,
      avgViewPct: m.avgViewPct,
      likes: m.likes,
      comments: m.comments,
      shares: m.shares,
      score: scores.get(row.id) ?? null,
    };
  });

  return { videos, watchHours };
}

function followersDeltaForRange(
  sqlite: Database.Database,
  from: string,
  to: string,
  profileId?: string,
  platform?: PlatformId,
): number {
  const where: string[] = [
    "d.date >= ?",
    "d.date <= ?",
    "d.followers IS NOT NULL",
  ];
  const params: unknown[] = [from, to];
  const scoped = profileScopeSql("a.profile_id");
  where.push(scoped.sql);
  params.push(...scoped.args);
  if (profileId) {
    where.push("a.profile_id = ?");
    params.push(profileId);
  }
  if (platform) {
    where.push("a.platform = ?");
    params.push(platform);
  }

  const rows = sqlite.prepare(
    `SELECT d.account_id, d.date, d.followers
     FROM channel_metrics_daily d
     JOIN platform_accounts a ON a.id = d.account_id
     WHERE ${where.join(" AND ")}
     ORDER BY d.account_id, d.date`,
  ).all(...params) as Array<{ account_id: string; date: string; followers: number }>;

  const byAccount = new Map<string, { first: number; last: number }>();
  for (const row of rows) {
    const cur = byAccount.get(row.account_id);
    if (!cur) {
      byAccount.set(row.account_id, { first: row.followers, last: row.followers });
    } else {
      cur.last = row.followers;
    }
  }
  let delta = 0;
  for (const { first, last } of byAccount.values()) {
    delta += last - first;
  }
  return delta;
}

function buildSeries(
  sqlite: Database.Database,
  from: string,
  to: string,
  profileId?: string,
  platform?: PlatformId,
): AnalyticsDayPoint[] {
  const accountWhere: string[] = [];
  const accountParams: unknown[] = [];
  const scopedAcc = profileScopeSql("a.profile_id");
  accountWhere.push(scopedAcc.sql);
  accountParams.push(...scopedAcc.args);
  if (profileId) {
    accountWhere.push("a.profile_id = ?");
    accountParams.push(profileId);
  }
  if (platform) {
    accountWhere.push("a.platform = ?");
    accountParams.push(platform);
  }
  const accountFilter = accountWhere.length ? `AND ${accountWhere.join(" AND ")}` : "";

  const channelRows = sqlite.prepare(
    `SELECT d.date AS day, a.platform, d.views, d.watch_time_sec, d.followers, d.account_id
     FROM channel_metrics_daily d
     JOIN platform_accounts a ON a.id = d.account_id
     WHERE d.date >= ? AND d.date <= ? ${accountFilter}
     ORDER BY d.date`,
  ).all(from, to, ...accountParams) as ChannelDayRow[];

  const snapWhere: string[] = [
    "p.status = 'PUBLISHED'",
    "date(s.fetched_at) >= date(?)",
    "date(s.fetched_at) <= date(?)",
  ];
  const snapParams: unknown[] = [from, to];
  snapWhere.push(scopedAcc.sql);
  snapParams.push(...scopedAcc.args);
  if (profileId) {
    snapWhere.push("(proj.profile_id = ? OR a.profile_id = ?)");
    snapParams.push(profileId, profileId);
  }
  if (platform) {
    snapWhere.push("a.platform = ?");
    snapParams.push(platform);
  }

  const snapshotRows = sqlite.prepare(
    `SELECT date(s.fetched_at) AS day, a.platform,
            s.views, s.likes, s.comments, s.shares, s.watch_time_sec
     FROM publication_metrics_snapshots s
     JOIN publications p ON p.id = s.publication_id
     JOIN platform_accounts a ON a.id = p.account_id
     LEFT JOIN projects proj ON proj.id = p.project_id
     WHERE ${snapWhere.join(" AND ")}`,
  ).all(...snapParams) as SnapshotDayRow[];

  type Agg = {
    views: number;
    likes: number;
    comments: number;
    shares: number;
    watchHours: number;
  };
  const map = new Map<string, Agg>();
  const keyOf = (day: string, plat: PlatformId) => `${day}|${plat}`;

  const bump = (day: string, plat: PlatformId, patch: Partial<Agg>) => {
    const key = keyOf(day, plat);
    const cur = map.get(key) ?? { views: 0, likes: 0, comments: 0, shares: 0, watchHours: 0 };
    cur.views += patch.views ?? 0;
    cur.likes += patch.likes ?? 0;
    cur.comments += patch.comments ?? 0;
    cur.shares += patch.shares ?? 0;
    cur.watchHours += patch.watchHours ?? 0;
    map.set(key, cur);
  };

  // Prefer channel daily for views/watch; snapshots fill engagement when present.
  const channelDays = new Set<string>();
  for (const row of channelRows) {
    channelDays.add(keyOf(row.day, row.platform));
    bump(row.day, row.platform, {
      views: row.views ?? 0,
      watchHours: (row.watch_time_sec ?? 0) / 3600,
    });
  }

  for (const row of snapshotRows) {
    const key = keyOf(row.day, row.platform);
    if (channelDays.has(key)) {
      bump(row.day, row.platform, {
        likes: row.likes ?? 0,
        comments: row.comments ?? 0,
        shares: row.shares ?? 0,
      });
    } else {
      bump(row.day, row.platform, {
        views: row.views ?? 0,
        likes: row.likes ?? 0,
        comments: row.comments ?? 0,
        shares: row.shares ?? 0,
        watchHours: (row.watch_time_sec ?? 0) / 3600,
      });
    }
  }

  const series: AnalyticsDayPoint[] = [];
  for (const [key, agg] of map) {
    const [date, plat] = key.split("|") as [string, PlatformId];
    series.push({
      date,
      platform: plat,
      views: agg.views,
      likes: agg.likes,
      comments: agg.comments,
      shares: agg.shares,
      watchHours: agg.watchHours,
    });
  }
  series.sort((a, b) => a.date.localeCompare(b.date) || a.platform.localeCompare(b.platform));
  return series;
}

function rankBy(
  videos: AnalyticsVideoRankItem[],
  field: "views" | "avgViewPct",
  topN: number,
  bottomN: number,
): { top: AnalyticsVideoRankItem[]; bottom: AnalyticsVideoRankItem[] } {
  const withValue = videos.filter((v) => v[field] != null);
  const sorted = [...withValue].sort((a, b) => (b[field] ?? 0) - (a[field] ?? 0));
  const top = sorted.slice(0, topN);
  const bottom = [...sorted].reverse().slice(0, bottomN);
  return { top, bottom };
}

function platformSplit(videos: AnalyticsVideoRankItem[], watchByPub: Map<string, number>): AnalyticsPlatformSplit[] {
  const map = new Map<PlatformId, AnalyticsPlatformSplit>();
  for (const v of videos) {
    const cur = map.get(v.platform) ?? {
      platform: v.platform,
      views: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      watchHours: 0,
    };
    cur.views += v.views ?? 0;
    cur.likes += v.likes ?? 0;
    cur.comments += v.comments ?? 0;
    cur.shares += v.shares ?? 0;
    cur.watchHours += watchByPub.get(v.publicationId) ?? 0;
    map.set(v.platform, cur);
  }
  return [...map.values()].sort((a, b) => a.platform.localeCompare(b.platform));
}

/**
 * Aggregate analytics overview for GET /api/analytics/overview.
 */
export function buildOverview(
  sqlite: Database.Database,
  query: AnalyticsOverviewQuery,
  _now: Date,
): AnalyticsOverviewResponse {
  void _now;
  const { from, to, profileId, platform } = query;
  const spanDays = daysBetweenInclusive(from, to);
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -spanDays);

  const current = loadPublishedVideos(sqlite, from, to, profileId, platform);
  const previous = loadPublishedVideos(sqlite, prevFrom, prevTo, profileId, platform);

  const currentBase = sumMetrics(current.videos);
  const previousBase = sumMetrics(previous.videos);

  const currentFollowers = followersDeltaForRange(sqlite, from, to, profileId, platform);
  const previousFollowers = followersDeltaForRange(sqlite, prevFrom, prevTo, profileId, platform);

  const totalsCurrent: AnalyticsKpiTotals = {
    ...currentBase,
    watchHours: current.watchHours,
    followersDelta: currentFollowers,
  };
  const totalsPrevious: AnalyticsKpiTotals = {
    ...previousBase,
    watchHours: previous.watchHours,
    followersDelta: previousFollowers,
  };

  const delta: AnalyticsKpiTotals = {
    views: totalsCurrent.views - totalsPrevious.views,
    likes: totalsCurrent.likes - totalsPrevious.likes,
    comments: totalsCurrent.comments - totalsPrevious.comments,
    shares: totalsCurrent.shares - totalsPrevious.shares,
    watchHours: totalsCurrent.watchHours - totalsPrevious.watchHours,
    followersDelta: totalsCurrent.followersDelta - totalsPrevious.followersDelta,
  };

  const byViews = rankBy(current.videos, "views", 10, 5);
  const byPct = rankBy(current.videos, "avgViewPct", 10, 5);

  // Per-video watch hours for platform split
  const watchByPub = new Map<string, number>();
  for (const row of sqlite.prepare(
    `SELECT p.id, p.latest_metrics
     FROM publications p
     JOIN platform_accounts a ON a.id = p.account_id
     LEFT JOIN projects proj ON proj.id = p.project_id
     WHERE p.status = 'PUBLISHED'
       AND p.published_at IS NOT NULL
       AND date(p.published_at) >= date(?)
       AND date(p.published_at) <= date(?)
       AND ${profileScopeSql("a.profile_id").sql}
       ${profileId ? "AND (proj.profile_id = ? OR a.profile_id = ?)" : ""}
       ${platform ? "AND a.platform = ?" : ""}`,
  ).all(
    from,
    to,
    ...profileScopeSql("a.profile_id").args,
    ...(profileId ? [profileId, profileId] : []),
    ...(platform ? [platform] : []),
  ) as Array<{ id: string; latest_metrics: string | null }>) {
    const m = parseMetrics(row.latest_metrics);
    watchByPub.set(row.id, (m.watchTimeSec ?? 0) / 3600);
  }

  return {
    from,
    to,
    totals: {
      ...totalsCurrent,
      previous: totalsPrevious,
      delta,
    },
    series: buildSeries(sqlite, from, to, profileId, platform),
    byPlatform: platformSplit(current.videos, watchByPub),
    topByViews: byViews.top,
    bottomByViews: byViews.bottom,
    topByAvgViewPct: byPct.top,
    bottomByAvgViewPct: byPct.bottom,
    videos: current.videos,
  };
}
