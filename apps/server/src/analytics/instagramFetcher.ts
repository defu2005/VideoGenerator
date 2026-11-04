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

/** API metric name → snapshot field. Times from IG are milliseconds. */
export const IG_METRIC_MAP = {
  views: "views",
  reach: "reach",
  likes: "likes",
  comments: "comments",
  shares: "shares",
  saved: "saves",
  ig_reels_avg_watch_time: "avgViewDurationSec",
  ig_reels_video_view_total_time: "watchTimeSec",
} as const satisfies Record<string, keyof MetricsSnapshotInput>;

const IG_METRICS = Object.keys(IG_METRIC_MAP);
const MS_METRICS = new Set(["ig_reels_avg_watch_time", "ig_reels_video_view_total_time"]);

export type InstagramFetcherOptions = {
  fetchImpl?: typeof fetch;
  logger?: AnalyticsLogger;
  now?: () => Date;
};

type InsightRow = { name?: string; values?: Array<{ value?: unknown }> };

export class InstagramMetricsFetcher implements MetricsFetcher {
  readonly platform = "instagram_reels" as const;
  readonly requiredScopes = [...ANALYTICS_REQUIRED_SCOPES.instagram_reels];

  private readonly fetchImpl: typeof fetch;
  private readonly logger?: AnalyticsLogger;
  private readonly now: () => Date;
  private loggedRejected = new Set<string>();

  constructor(options: InstagramFetcherOptions = {}) {
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
        const metrics = await this.fetchMediaInsights(pub.externalId, tokens.accessToken, signal);
        result.set(pub.publicationId, metrics);
      } catch (err) {
        if (err instanceof AnalyticsHttpError && (err.status === 401 || err.status === 429)) {
          throw err;
        }
        this.logOnce("media", String(err));
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
    const igUserId = account.externalId;
    if (!igUserId || igUserId.startsWith("pending:")) return [];
    const url = new URL(`${GRAPH}/${encodeURIComponent(igUserId)}`);
    url.searchParams.set("fields", "followers_count");
    url.searchParams.set("access_token", tokens.accessToken);
    const response = await this.fetchImpl(url.toString(), { signal });
    await throwIfBad(response, "Instagram user followers");
    const body = (await response.json()) as { followers_count?: number };
    const followers =
      typeof body.followers_count === "number" && Number.isFinite(body.followers_count)
        ? Math.round(body.followers_count)
        : null;
    const date = (to || this.now().toISOString().slice(0, 10)).slice(0, 10);
    return [{ date, followers }];
  }

  private async fetchMediaInsights(
    mediaId: string,
    accessToken: string,
    signal: AbortSignal,
  ): Promise<MetricsSnapshotInput> {
    let metrics = [...IG_METRICS];
    let lastError: string | null = null;

    for (let attempt = 0; attempt < IG_METRICS.length + 1; attempt++) {
      if (metrics.length === 0) break;
      const url = new URL(`${GRAPH}/${encodeURIComponent(mediaId)}/insights`);
      url.searchParams.set("metric", metrics.join(","));
      url.searchParams.set("access_token", accessToken);
      const response = await this.fetchImpl(url.toString(), { signal });
      if (response.ok) {
        const body = (await response.json()) as { data?: InsightRow[] };
        return mapInsights(body.data ?? [], this.logOnce.bind(this));
      }
      if (response.status === 401 || response.status === 429) {
        await throwIfBad(response, "Instagram media insights");
      }
      const text = await safeText(response);
      lastError = text;
      const rejected = findRejectedMetric(text, metrics);
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
    this.logger?.warn({ metric: key, detail }, "Instagram analytics metric rejected/unknown");
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
    if (!name || !(name in IG_METRIC_MAP)) {
      if (name) logOnce(name, "unmapped");
      continue;
    }
    const field = IG_METRIC_MAP[name as keyof typeof IG_METRIC_MAP];
    const rawValue = row.values?.[0]?.value;
    raw[name] = rawValue ?? null;
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

function findRejectedMetric(errorText: string, metrics: string[]): string | undefined {
  return metrics.find((m) => errorText.includes(m));
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
