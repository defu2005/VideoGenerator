import type { KnowledgeService } from "../knowledge/service.js";
import type { TokenSet } from "@vg/shared";
import { analyticsScopes } from "./scopes.js";
import { chunkIds } from "./youtubeFetcher.js";
import {
  AnalyticsHttpError,
  type AnalyticsLogger,
  type ChannelDailyInput,
  type MetricsFetcher,
  type MetricsSnapshotInput,
  type PubRef,
} from "./types.js";

export const TIKTOK_VIDEO_BATCH = 20;

const VIDEO_QUERY_URL = "https://open.tiktokapis.com/v2/video/query/";
const USER_INFO_URL = "https://open.tiktokapis.com/v2/user/info/";

export type TikTokFetcherOptions = {
  knowledge?: KnowledgeService;
  fetchImpl?: typeof fetch;
  logger?: AnalyticsLogger;
  now?: () => Date;
};

type TikTokVideo = {
  id?: string;
  view_count?: number;
  like_count?: number;
  comment_count?: number;
  share_count?: number;
};

export class TikTokMetricsFetcher implements MetricsFetcher {
  readonly platform = "tiktok" as const;
  get requiredScopes() { return analyticsScopes(this.platform, this.options.knowledge); }

  private readonly fetchImpl: typeof fetch;
  private readonly logger?: AnalyticsLogger;
  private readonly now: () => Date;
  private loggedRejected = false;

  constructor(private readonly options: TikTokFetcherOptions = {}) {
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
    if (pubs.length === 0) return result;

    const byExternal = new Map(pubs.map((p) => [p.externalId, p.publicationId]));
    const ids = pubs.map((p) => p.externalId);

    for (const batch of chunkIds(ids, TIKTOK_VIDEO_BATCH)) {
      const videos = await this.queryVideos(batch, tokens.accessToken, signal);
      for (const video of videos) {
        if (!video.id) continue;
        const publicationId = byExternal.get(video.id);
        if (!publicationId) continue;
        result.set(publicationId, {
          views: toInt(video.view_count),
          likes: toInt(video.like_count),
          comments: toInt(video.comment_count),
          shares: toInt(video.share_count),
          raw: {
            view_count: video.view_count ?? null,
            like_count: video.like_count ?? null,
            comment_count: video.comment_count ?? null,
            share_count: video.share_count ?? null,
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
    void from;
    const url = new URL(USER_INFO_URL);
    url.searchParams.set("fields", "follower_count");
    const response = await this.fetchImpl(url.toString(), {
      method: "GET",
      signal,
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    await throwIfBad(response, "TikTok user.info");
    const body = (await response.json()) as {
      data?: { user?: { follower_count?: number } };
      error?: { code?: string; message?: string };
    };
    if (body.error?.code && body.error.code !== "ok") {
      this.logRejected(body.error.message ?? body.error.code);
      return [];
    }
    const followers = toInt(body.data?.user?.follower_count);
    const date = (to || this.now().toISOString().slice(0, 10)).slice(0, 10);
    return [{ date, followers }];
  }

  private async queryVideos(
    ids: string[],
    accessToken: string,
    signal: AbortSignal,
  ): Promise<TikTokVideo[]> {
    const url = new URL(VIDEO_QUERY_URL);
    url.searchParams.set("fields", "id,view_count,like_count,comment_count,share_count");
    const response = await this.fetchImpl(url.toString(), {
      method: "POST",
      signal,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ filters: { video_ids: ids } }),
    });
    await throwIfBad(response, "TikTok video.query");
    const body = (await response.json()) as {
      data?: { videos?: TikTokVideo[] };
      error?: { code?: string; message?: string };
    };
    if (body.error?.code && body.error.code !== "ok") {
      this.logRejected(body.error.message ?? body.error.code);
      return [];
    }
    return body.data?.videos ?? [];
  }

  private logRejected(detail: string): void {
    if (this.loggedRejected) return;
    this.loggedRejected = true;
    this.logger?.warn({ detail }, "TikTok analytics metric rejected/unknown");
  }
}

function toInt(value: number | undefined | null): number | null {
  if (value == null) return null;
  return Number.isFinite(value) ? Math.round(value) : null;
}

async function throwIfBad(response: Response, label: string): Promise<void> {
  if (response.ok) return;
  throw new AnalyticsHttpError(
    `${label} thất bại (${response.status})`,
    response.status,
    response.status === 429 || response.status >= 500,
  );
}
