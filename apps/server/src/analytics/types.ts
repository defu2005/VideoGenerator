import type { PlatformId, TokenSet } from "@vg/shared";

export type MetricsSnapshotInput = {
  views?: number | null;
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;
  saves?: number | null;
  watchTimeSec?: number | null;
  avgViewDurationSec?: number | null;
  avgViewPct?: number | null;
  subscribersGained?: number | null;
  reach?: number | null;
  raw?: Record<string, unknown>;
};

export type ChannelDailyInput = {
  date: string; // YYYY-MM-DD
  followers?: number | null;
  views?: number | null;
  watchTimeSec?: number | null;
};

export type PubRef = { publicationId: string; externalId: string };

export interface MetricsFetcher {
  platform: PlatformId;
  requiredScopes: string[];
  fetchVideoMetrics(
    pubs: PubRef[],
    tokens: TokenSet,
    signal: AbortSignal,
  ): Promise<Map<string, MetricsSnapshotInput>>;
  fetchChannelDaily?(
    account: { accountId: string; externalId: string | null },
    tokens: TokenSet,
    from: string,
    to: string,
    signal: AbortSignal,
  ): Promise<ChannelDailyInput[]>;
}

export type AnalyticsLogger = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  debug?: (obj: unknown, msg?: string) => void;
};

/** HTTP/API error with status for sync backoff / refresh handling. */
export class AnalyticsHttpError extends Error {
  readonly status: number;
  readonly retryable: boolean;

  constructor(message: string, status: number, retryable?: boolean) {
    super(message);
    this.name = "AnalyticsHttpError";
    this.status = status;
    this.retryable = retryable ?? (status === 429 || status >= 500);
  }
}

export function errorStatus(err: unknown): number | undefined {
  if (err instanceof AnalyticsHttpError) return err.status;
  if (err && typeof err === "object" && "status" in err) {
    const status = (err as { status: unknown }).status;
    return typeof status === "number" ? status : undefined;
  }
  return undefined;
}
