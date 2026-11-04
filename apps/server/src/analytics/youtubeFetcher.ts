import type { TokenSet } from "@vg/shared";
import { ANALYTICS_REQUIRED_SCOPES } from "./scopes.js";
import type { YoutubeQuotaTracker } from "../publishing/youtubeQuota.js";
import {
  AnalyticsHttpError,
  type AnalyticsLogger,
  type ChannelDailyInput,
  type MetricsFetcher,
  type MetricsSnapshotInput,
  type PubRef,
} from "./types.js";

export const YOUTUBE_DATA_BATCH = 50;

const DATA_API = "https://www.googleapis.com/youtube/v3";
const ANALYTICS_API = "https://youtubeanalytics.googleapis.com/v2";

export function chunkIds<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

export type YoutubeFetcherOptions = {
  fetchImpl?: typeof fetch;
  youtubeQuota?: YoutubeQuotaTracker;
  logger?: AnalyticsLogger;
  now?: () => Date;
};

type StatsItem = {
  id?: string;
  statistics?: {
    viewCount?: string;
    likeCount?: string;
    commentCount?: string;
  };
};

type AnalyticsRow = (string | number)[];

export class YoutubeMetricsFetcher implements MetricsFetcher {
  readonly platform = "youtube" as const;
  readonly requiredScopes = [...ANALYTICS_REQUIRED_SCOPES.youtube];

  private readonly fetchImpl: typeof fetch;
  private readonly quota?: YoutubeQuotaTracker;
  private readonly logger?: AnalyticsLogger;
  private readonly now: () => Date;
  private loggedRejected = false;

  constructor(options: YoutubeFetcherOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.quota = options.youtubeQuota;
    this.logger = options.logger;
    this.now = options.now ?? (() => new Date());
  }

  async fetchVideoMetrics(
    pubs: PubRef[],
    tokens: TokenSet,
    signal: AbortSignal,
  ): Promise<Map<string, MetricsSnapshotInput>> {
    const result = new Map<string, MetricsSnapshotInput>();
    if (pubs.length === 0) return result;

    const byExternal = new Map(pubs.map((p) => [p.externalId, p.publicationId]));
    const ids = pubs.map((p) => p.externalId);

    for (const batch of chunkIds(ids, YOUTUBE_DATA_BATCH)) {
      const stats = await this.fetchStatistics(batch, tokens.accessToken, signal);
      for (const item of stats) {
        if (!item.id) continue;
        const publicationId = byExternal.get(item.id);
        if (!publicationId) continue;
        const s = item.statistics ?? {};
        result.set(publicationId, {
          views: parseCount(s.viewCount),
          likes: parseCount(s.likeCount),
          comments: parseCount(s.commentCount),
          raw: { statistics: s },
        });
      }
    }

    const endDate = this.now().toISOString().slice(0, 10);
    const startDate = "2006-01-01";
    for (const batch of chunkIds(ids, YOUTUBE_DATA_BATCH)) {
      const rows = await this.fetchAnalyticsForVideos(
        batch,
        tokens.accessToken,
        startDate,
        endDate,
        signal,
      );
      for (const row of rows) {
        const videoId = String(row[0] ?? "");
        const publicationId = byExternal.get(videoId);
        if (!publicationId) continue;
        const existing = result.get(publicationId) ?? {};
        const estimatedMinutes = toNum(row[1]);
        const avgDuration = toNum(row[2]);
        const avgPct = toNum(row[3]);
        const subs = toNum(row[4]);
        const shares = toNum(row[5]);
        result.set(publicationId, {
          ...existing,
          watchTimeSec: estimatedMinutes == null ? null : estimatedMinutes * 60,
          avgViewDurationSec: avgDuration,
          avgViewPct: avgPct,
          subscribersGained: subs == null ? null : Math.round(subs),
          shares: shares == null ? null : Math.round(shares),
          raw: {
            ...(existing.raw ?? {}),
            analytics: {
              estimatedMinutesWatched: estimatedMinutes,
              averageViewDuration: avgDuration,
              averageViewPercentage: avgPct,
              subscribersGained: subs,
              shares,
            },
          },
        });
      }
    }

    return result;
  }

  async fetchChannelDaily(
    _account: { accountId: string; externalId: string | null },
    tokens: TokenSet,
    from: string,
    to: string,
    signal: AbortSignal,
  ): Promise<ChannelDailyInput[]> {
    const url = new URL(`${ANALYTICS_API}/reports`);
    url.searchParams.set("ids", "channel==MINE");
    url.searchParams.set("startDate", from);
    url.searchParams.set("endDate", to);
    url.searchParams.set("metrics", "views,estimatedMinutesWatched");
    url.searchParams.set("dimensions", "day");
    url.searchParams.set("sort", "day");

    const response = await this.fetchImpl(url.toString(), {
      signal,
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    await throwIfBad(response, "YouTube Analytics channel daily");

    const body = (await response.json()) as { rows?: AnalyticsRow[]; columnHeaders?: unknown[] };
    const rows = body.rows ?? [];
    const daily: ChannelDailyInput[] = rows.map((row) => {
      const date = String(row[0] ?? "");
      const views = toNum(row[1]);
      const minutes = toNum(row[2]);
      return {
        date,
        views: views == null ? null : Math.round(views),
        watchTimeSec: minutes == null ? null : minutes * 60,
      };
    });

    // Absolute follower count for "today" via Data API (1 unit).
    try {
      if (this.quota?.wouldExceed(1)) {
        throw new AnalyticsHttpError("Hết hạn mức YouTube Data API trong ngày", 429, true);
      }
      const chUrl = new URL(`${DATA_API}/channels`);
      chUrl.searchParams.set("part", "statistics");
      chUrl.searchParams.set("mine", "true");
      const chRes = await this.fetchImpl(chUrl.toString(), {
        signal,
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });
      this.quota?.record(1);
      if (chRes.ok) {
        const chBody = (await chRes.json()) as {
          items?: Array<{ statistics?: { subscriberCount?: string } }>;
        };
        const subs = parseCount(chBody.items?.[0]?.statistics?.subscriberCount);
        const today = to.slice(0, 10);
        const existing = daily.find((d) => d.date === today);
        if (existing) {
          existing.followers = subs;
        } else if (subs != null) {
          daily.push({ date: today, followers: subs });
        }
      }
    } catch (err) {
      if (err instanceof AnalyticsHttpError && err.status === 429) throw err;
      this.logRejected("youtube channel subscribers", err);
    }

    return daily;
  }

  private async fetchStatistics(
    ids: string[],
    accessToken: string,
    signal: AbortSignal,
  ): Promise<StatsItem[]> {
    if (this.quota?.wouldExceed(1)) {
      throw new AnalyticsHttpError("Hết hạn mức YouTube Data API trong ngày", 429, true);
    }
    const url = new URL(`${DATA_API}/videos`);
    url.searchParams.set("part", "statistics");
    url.searchParams.set("id", ids.join(","));
    const response = await this.fetchImpl(url.toString(), {
      signal,
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    this.quota?.record(1);
    await throwIfBad(response, "YouTube videos.list");
    const body = (await response.json()) as { items?: StatsItem[] };
    return body.items ?? [];
  }

  private async fetchAnalyticsForVideos(
    ids: string[],
    accessToken: string,
    startDate: string,
    endDate: string,
    signal: AbortSignal,
  ): Promise<AnalyticsRow[]> {
    const url = new URL(`${ANALYTICS_API}/reports`);
    url.searchParams.set("ids", "channel==MINE");
    url.searchParams.set("startDate", startDate);
    url.searchParams.set("endDate", endDate);
    url.searchParams.set(
      "metrics",
      "estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,shares",
    );
    url.searchParams.set("dimensions", "video");
    url.searchParams.set("filters", `video==${ids.join(",")}`);

    const response = await this.fetchImpl(url.toString(), {
      signal,
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      // Soft-fail analytics enrichment; Data API stats already saved.
      this.logRejected("youtube analytics reports.query", await safeText(response));
      return [];
    }
    const body = (await response.json()) as { rows?: AnalyticsRow[] };
    return body.rows ?? [];
  }

  private logRejected(context: string, detail: unknown): void {
    if (this.loggedRejected) return;
    this.loggedRejected = true;
    this.logger?.warn({ context, detail: String(detail) }, "YouTube analytics metric rejected/unknown");
  }
}

function parseCount(value: string | undefined): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function toNum(value: string | number | undefined | null): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

async function throwIfBad(response: Response, label: string): Promise<void> {
  if (response.ok) return;
  throw new AnalyticsHttpError(
    `${label} thất bại (${response.status})`,
    response.status,
    response.status === 429 || response.status >= 500,
  );
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}
