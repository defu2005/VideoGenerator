import { META_GRAPH_VERSION, type TokenSet } from "@vg/shared";
import { ANALYTICS_REQUIRED_SCOPES } from "./scopes.js";
import {
  AnalyticsHttpError,
  type AnalyticsLogger,
  type ChannelDailyInput,
  type MetricsFetcher,
  type MetricsSnapshotInput,
  type PubRef,
} from "./types.js";

const GRAPH = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

/** API metric name → snapshot field. Watch-time metrics are milliseconds. */
export const FB_METRIC_MAP = {
  blue_reels_play_count: "views",
  post_impressions_unique: "reach",
  post_video_avg_time_watched: "avgViewDurationSec",
  post_video_view_time: "watchTimeSec",
  post_video_social_actions: "social",
} as const;

const FB_METRICS = Object.keys(FB_METRIC_MAP);
const MS_METRICS = new Set(["post_video_avg_time_watched", "post_video_view_time"]);

export type FacebookFetcherOptions = {
  fetchImpl?: typeof fetch;
  logger?: AnalyticsLogger;
  now?: () => Date;
};

type InsightRow = { name?: string; values?: Array<{ value?: unknown }> };

export class FacebookMetricsFetcher implements MetricsFetcher {
  readonly platform = "facebook_reels" as const;
  readonly requiredScopes = [...ANALYTICS_REQUIRED_SCOPES.facebook_reels];

  private readonly fetchImpl: typeof fetch;
  private readonly logger?: AnalyticsLogger;
  private readonly now: () => Date;
  private loggedRejected = new Set<string>();

  constructor(options: FacebookFetcherOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.logger = options.logger;
    this.now = options.now ?? (() => new Date());
  }

  async fetchVideoMetrics(
    pubs: PubRef[],
    tokens: TokenSet,
    signal: AbortSignal,
  ): Promise<Map<string, MetricsSnapshotInput>> {
    const result = new Map<string, MetricsSnapshotInput>();
    for (const pub of pubs) {
      try {
        const metrics = await this.fetchVideoInsights(pub.externalId, tokens.accessToken, signal);
        result.set(pub.publicationId, metrics);
      } catch (err) {
        if (err instanceof AnalyticsHttpError && (err.status === 401 || err.status === 429)) {
          throw err;
        }
        this.logOnce("video", String(err));
        result.set(pub.publicationId, { raw: { error: String(err) } });
      }
    }
    return result;
  }

  async fetchChannelDaily(
    account: { accountId: string; externalId: string | null },
    tokens: TokenSet,
    _from: string,
    to: string,
    signal: AbortSignal,
  ): Promise<ChannelDailyInput[]> {
    const pageId = account.externalId;
    if (!pageId || pageId.startsWith("pending:")) return [];
    const url = new URL(`${GRAPH}/${encodeURIComponent(pageId)}`);
    url.searchParams.set("fields", "followers_count");
    url.searchParams.set("access_token", tokens.accessToken);
    const response = await this.fetchImpl(url.toString(), { signal });
    await throwIfBad(response, "Facebook page followers");
    const body = (await response.json()) as { followers_count?: number };
    const followers =
      typeof body.followers_count === "number" && Number.isFinite(body.followers_count)
        ? Math.round(body.followers_count)
        : null;
    const date = (to || this.now().toISOString().slice(0, 10)).slice(0, 10);
    return [{ date, followers }];
  }

  private async fetchVideoInsights(
    videoId: string,
    accessToken: string,
    signal: AbortSignal,
  ): Promise<MetricsSnapshotInput> {
    let metrics = [...FB_METRICS];
    let lastError: string | null = null;

    for (let attempt = 0; attempt < FB_METRICS.length + 1; attempt++) {
      if (metrics.length === 0) break;
      const url = new URL(`${GRAPH}/${encodeURIComponent(videoId)}/video_insights`);
      url.searchParams.set("metric", metrics.join(","));
      url.searchParams.set("access_token", accessToken);
      const response = await this.fetchImpl(url.toString(), { signal });
      if (response.ok) {
        const body = (await response.json()) as { data?: InsightRow[] };
        return mapInsights(body.data ?? [], this.logOnce.bind(this));
      }
      if (response.status === 401 || response.status === 429) {
        await throwIfBad(response, "Facebook video insights");
      }
      const text = await safeText(response);
      lastError = text;
      const rejected = metrics.find((m) => text.includes(m));
      if (rejected) {
        this.logOnce(rejected, text);
        metrics = metrics.filter((m) => m !== rejected);
        continue;
      }
      this.logOnce("insights", text);
      break;
    }

    return { raw: { error: lastError } };
  }

  private logOnce(key: string, detail: string): void {
    if (this.loggedRejected.has(key)) return;
    this.loggedRejected.add(key);
    this.logger?.warn({ metric: key, detail }, "Facebook analytics metric rejected/unknown");
  }
}

function mapInsights(
  rows: InsightRow[],
  logOnce: (key: string, detail: string) => void,
): MetricsSnapshotInput {
  const out: MetricsSnapshotInput = { raw: {} };
  const raw: Record<string, unknown> = {};

  for (const row of rows) {
    const name = row.name;
    if (!name || !(name in FB_METRIC_MAP)) {
      if (name) logOnce(name, "unmapped");
      continue;
    }
    const rawValue = row.values?.[0]?.value;
    raw[name] = rawValue ?? null;

    if (name === "post_video_social_actions") {
      applySocialActions(out, rawValue);
      continue;
    }

    const field = FB_METRIC_MAP[name as keyof typeof FB_METRIC_MAP];
    if (field === "social") continue;
    const num = toFiniteNumber(rawValue);
    if (num == null) {
      (out as Record<string, unknown>)[field] = null;
      continue;
    }
    if (MS_METRICS.has(name)) {
      (out as Record<string, unknown>)[field] = num / 1000;
    } else {
      (out as Record<string, unknown>)[field] = Math.round(num);
    }
  }

  out.raw = raw;
  return out;
}

function applySocialActions(out: MetricsSnapshotInput, value: unknown): void {
  if (!value || typeof value !== "object") {
    out.likes = out.likes ?? null;
    out.comments = out.comments ?? null;
    out.shares = out.shares ?? null;
    return;
  }
  const obj = value as Record<string, unknown>;
  const like = pickAction(obj, ["LIKE", "like", "reaction"]);
  const comment = pickAction(obj, ["COMMENT", "comment"]);
  const share = pickAction(obj, ["SHARE", "share"]);
  if (like != null) out.likes = like;
  if (comment != null) out.comments = comment;
  if (share != null) out.shares = share;
}

function pickAction(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    if (key in obj) {
      const n = toFiniteNumber(obj[key]);
      if (n != null) return Math.round(n);
    }
  }
  // Sum numeric values if structure is nested differently
  return null;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
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
