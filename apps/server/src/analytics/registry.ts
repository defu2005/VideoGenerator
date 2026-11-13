import type { KnowledgeService } from "../knowledge/service.js";
import type { PlatformId, TokenSet } from "@vg/shared";
import type { YoutubeQuotaTracker } from "../publishing/youtubeQuota.js";
import { FacebookMetricsFetcher } from "./facebookFetcher.js";
import { InstagramMetricsFetcher } from "./instagramFetcher.js";
import { analyticsScopes } from "./scopes.js";
import { TikTokMetricsFetcher } from "./tiktokFetcher.js";
import type {
  AnalyticsLogger,
  ChannelDailyInput,
  MetricsFetcher,
  MetricsSnapshotInput,
  PubRef,
} from "./types.js";
import { YoutubeMetricsFetcher } from "./youtubeFetcher.js";

export type CreateFetchersOptions = {
  fetchImpl?: typeof fetch;
  knowledge?: KnowledgeService;
  youtubeQuota?: YoutubeQuotaTracker;
  logger?: AnalyticsLogger;
  now?: () => Date;
};

/** Mock platform: empty metrics, no API calls. */
export class MockMetricsFetcher implements MetricsFetcher {
  readonly platform = "mock" as const;
  readonly requiredScopes = analyticsScopes("mock");

  async fetchVideoMetrics(
    _pubs: PubRef[],
    _tokens: TokenSet,
    _signal: AbortSignal,
  ): Promise<Map<string, MetricsSnapshotInput>> {
    return new Map();
  }

  async fetchChannelDaily(
    _account: { accountId: string; externalId: string | null },
    _tokens: TokenSet,
    _from: string,
    _to: string,
    _signal: AbortSignal,
  ): Promise<ChannelDailyInput[]> {
    return [];
  }
}

export function createFetchers(options: CreateFetchersOptions = {}): Map<PlatformId, MetricsFetcher> {
  const shared = {
    fetchImpl: options.fetchImpl,
    logger: options.logger,
    now: options.now,
    knowledge: options.knowledge,
  };
  const map = new Map<PlatformId, MetricsFetcher>();
  map.set(
    "youtube",
    new YoutubeMetricsFetcher({
      ...shared,
      youtubeQuota: options.youtubeQuota,
    }),
  );
  map.set("tiktok", new TikTokMetricsFetcher(shared));
  map.set("instagram_reels", new InstagramMetricsFetcher(shared));
  map.set("facebook_reels", new FacebookMetricsFetcher(shared));
  map.set("mock", new MockMetricsFetcher());
  return map;
}
