import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  META_GRAPH_VERSION,
  YOUTUBE_ANALYTICS_READONLY_SCOPE,
  YOUTUBE_FULL_SCOPE,
  YOUTUBE_READONLY_SCOPE,
  YOUTUBE_UPLOAD_SCOPE,
  type PlatformId,
  type TokenSet,
} from "@vg/shared";
import { YoutubeMetricsFetcher, chunkIds, YOUTUBE_DATA_BATCH } from "../src/analytics/youtubeFetcher.js";
import { TikTokMetricsFetcher, TIKTOK_VIDEO_BATCH } from "../src/analytics/tiktokFetcher.js";
import { InstagramMetricsFetcher } from "../src/analytics/instagramFetcher.js";
import { FacebookMetricsFetcher } from "../src/analytics/facebookFetcher.js";
import { AnalyticsSyncService } from "../src/analytics/syncService.js";
import { createFetchers } from "../src/analytics/registry.js";
import { isDue } from "../src/analytics/freshness.js";
import { missingScopes, ANALYTICS_REQUIRED_SCOPES } from "../src/analytics/scopes.js";
import { buildOverview } from "../src/analytics/overview.js";
import { AnalyticsHttpError, type MetricsFetcher, type PubRef } from "../src/analytics/types.js";
import { openDatabase } from "../src/db/client.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { parseConfig, type AppConfig } from "../src/lib/config.js";
import { NotificationService } from "../src/notifications/notificationService.js";
import { saveNotificationSettings, TELEGRAM_BOT_TOKEN_KEY } from "../src/settings/notifications.js";
import { PublisherRegistry } from "../src/publishing/registry.js";
import { TokenVault } from "../src/publishing/tokenVault.js";
import type { Publisher } from "../src/publishing/types.js";

const root = mkdtempSync(join(tmpdir(), "vg-analytics-"));
const ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
const ACCESS_SECRET = "ya29.access-secret-NEVER-LEAK";
const REFRESH_SECRET = "1//refresh-secret-NEVER-LEAK";

let dataDir: string;
let sqlite: ReturnType<typeof openDatabase>["sqlite"];
let vault: TokenVault;
let config: AppConfig;
let nowMs: number;
const now = () => new Date(nowMs);

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

function textResponse(body: string, status = 400): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/plain" } });
}

function silentLogger() {
  return { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(), child: () => silentLogger() } as never;
}

async function flushNotify(): Promise<void> {
  await new Promise((r) => setTimeout(r, 30));
}

beforeEach(() => {
  dataDir = join(root, randomUUID());
  mkdirSync(dataDir, { recursive: true });
  const dbPath = join(dataDir, "app.db");
  const database = openDatabase(dbPath);
  sqlite = database.sqlite;
  migrateDatabase(database.db, undefined, database.sqlite);
  config = parseConfig({
    DATA_DIR: dataDir,
    DATABASE_PATH: dbPath,
    LLM_ENABLE_MOCK: "true",
    WORKER_ENABLED: "false",
    LOG_LEVEL: "silent",
    TOKEN_ENCRYPTION_KEY: ENCRYPTION_KEY,
    WEB_BASE_URL: "http://localhost:5180",
  });
  vault = new TokenVault(sqlite, dataDir, ENCRYPTION_KEY);
  nowMs = Date.parse("2026-11-05T12:00:00.000Z");
});

afterEach(() => {
  sqlite.close();
  vi.restoreAllMocks();
});

afterAll(() => {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    // ignore cleanup races on Windows
  }
});

function seedProfile(name = `P-${randomUUID().slice(0, 8)}`): string {
  const id = randomUUID();
  const ts = now().toISOString();
  sqlite.prepare(
    `INSERT INTO profiles (id, name, description, direction, language, default_brief, voice, guidelines, llm, avatar_path, color, archived_at, created_at, updated_at)
     VALUES (?, ?, '', '', 'vi', ?, NULL, ?, NULL, NULL, '#3B82F6', NULL, ?, ?)`,
  ).run(
    id,
    name,
    JSON.stringify({ platform: "youtube" }),
    JSON.stringify({ platformPack: "auto", customRules: [] }),
    ts,
    ts,
  );
  return id;
}

function seedAccount(
  profileId: string,
  platform: PlatformId,
  opts: { connection?: string; externalId?: string; displayName?: string } = {},
): string {
  const id = randomUUID();
  const ts = now().toISOString();
  sqlite.prepare(
    `INSERT INTO platform_accounts (
      id, profile_id, platform, display_name, handle, external_id, format, enabled,
      connection, connection_error, last_checked_at, publish_settings, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'landscape', 1, ?, NULL, NULL, ?, ?, ?)`,
  ).run(
    id,
    profileId,
    platform,
    opts.displayName ?? `${platform}-channel`,
    `@${platform}`,
    opts.externalId ?? `ext-${platform}`,
    opts.connection ?? "CONNECTED",
    JSON.stringify({ visibility: "public", autoPublish: false }),
    ts,
    ts,
  );
  return id;
}

function seedProject(profileId: string, title = "Analytics video"): { projectId: string; renderId: string } {
  const projectId = randomUUID();
  const renderId = randomUUID();
  const ts = now().toISOString();
  sqlite.prepare(
    `INSERT INTO projects (
      id, title, description, topic, mode, run_mode, settings, status, stage,
      thumbnail_path, duration_sec, version, profile_id, created_at, updated_at, archived_at
    ) VALUES (?, ?, '', 'topic', 'BALANCED', 'ASSISTED', ?, 'COMPLETED', 'DONE', NULL, 30, 1, ?, ?, ?, NULL)`,
  ).run(projectId, title, JSON.stringify({}), profileId, ts, ts);
  sqlite.prepare(
    `INSERT INTO renders (
      id, project_id, input_hash, status, output_path, credits_path, srt_path,
      duration_sec, size_bytes, width, height, report, created_at, version, note, pinned, deleted_at,
      review_thread_id, metadata_snapshot, aspect_ratio, variant_of
    ) VALUES (?, ?, 'hash', 'DONE', '/tmp/x.mp4', NULL, NULL, 30, 1000, 1920, 1080, ?, ?, 1, NULL, 0, NULL, NULL, NULL, NULL, NULL)`,
  ).run(renderId, projectId, JSON.stringify({ ok: true, issues: [] }), ts);
  return { projectId, renderId };
}

function seedPublication(opts: {
  projectId: string;
  renderId: string;
  accountId: string;
  externalId: string;
  publishedAt: string;
  metricsSyncedAt?: string | null;
  latestMetrics?: Record<string, unknown> | null;
  status?: string;
}): string {
  const id = randomUUID();
  const ts = now().toISOString();
  sqlite.prepare(
    `INSERT INTO publications (
      id, project_id, render_id, account_id, status, visibility_requested, visibility_used,
      guardrail_reason, scheduled_for, external_id, external_url, attempts, last_error, progress,
      warnings, latest_metrics, metrics_synced_at, created_at, updated_at, published_at
    ) VALUES (?, ?, ?, ?, ?, 'public', 'public', NULL, NULL, ?, ?, 0, NULL, 100, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    opts.projectId,
    opts.renderId,
    opts.accountId,
    opts.status ?? "PUBLISHED",
    opts.externalId,
    `https://example.com/${opts.externalId}`,
    JSON.stringify([]),
    opts.latestMetrics == null ? null : JSON.stringify(opts.latestMetrics),
    opts.metricsSyncedAt ?? null,
    ts,
    ts,
    opts.publishedAt,
  );
  return id;
}

function youtubeScopes(extra: string[] = []): string[] {
  return [YOUTUBE_UPLOAD_SCOPE, YOUTUBE_READONLY_SCOPE, YOUTUBE_ANALYTICS_READONLY_SCOPE, ...extra];
}

function storeTokens(accountId: string, scopes: string[], accessToken = ACCESS_SECRET): TokenSet {
  const tokens: TokenSet = {
    accessToken,
    refreshToken: REFRESH_SECRET,
    expiresAt: new Date(nowMs + 3600_000).toISOString(),
    scopes,
    tokenType: "Bearer",
  };
  vault.storeTokens(accountId, tokens, scopes);
  return tokens;
}

function mockPublisher(platform: PlatformId, refreshImpl?: Publisher["oauth"]["refresh"]): Publisher {
  return {
    platform,
    oauth: {
      buildAuthUrl: () => "https://example.com/auth",
      exchangeCode: async () => ({ accessToken: "x", scopes: [] }),
      refresh: refreshImpl ?? (async (tokens) => ({
        ...tokens,
        accessToken: "refreshed-access-token",
        expiresAt: new Date(nowMs + 7200_000).toISOString(),
      })),
      fetchIdentity: async () => ({ displayName: "Ch", externalId: "ext-1" }),
    },
    upload: async () => ({ externalId: "vid", externalUrl: "https://example.com/v" }),
    limits: {
      maxDurationSec: 600,
      maxTitleChars: 100,
      maxDescriptionChars: 5000,
      maxTags: 10,
      supportsScheduledPublishAt: false,
    },
  };
}

function makeNotifications(sent: string[]): NotificationService {
  vault.storeSecret(TELEGRAM_BOT_TOKEN_KEY, "111:telegram-bot-token");
  saveNotificationSettings(sqlite, {
    telegram: { enabled: true, chatId: "42", botUsername: "bot" },
    events: { attention: true, published: true, waitingApproval: true, dailySummary: true },
    dailySummaryTime: "21:00",
    timezone: "UTC",
    quietHours: null,
  });
  return new NotificationService({
    sqlite,
    vault,
    config,
    logger: silentLogger(),
    now,
    sleep: async () => undefined,
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/sendMessage")) {
        const body = JSON.parse(String(init?.body)) as { text: string };
        sent.push(body.text);
        return jsonResponse({ ok: true, result: { message_id: 1 } });
      }
      return jsonResponse({ ok: true, result: {} });
    }) as typeof fetch,
  });
}

function makeSyncService(opts: {
  fetchers: Map<PlatformId, MetricsFetcher>;
  publishers?: Publisher[];
  notifications?: NotificationService | null;
}): AnalyticsSyncService {
  const registry = new PublisherRegistry();
  for (const p of opts.publishers ?? []) registry.register(p);
  return new AnalyticsSyncService({
    sqlite,
    vault,
    registry,
    fetchers: opts.fetchers,
    logger: silentLogger(),
    notifications: opts.notifications ?? null,
    now,
  });
}

describe("missingScopes", () => {
  it("treats YouTube FULL scope as covering READONLY", () => {
    const required = ANALYTICS_REQUIRED_SCOPES.youtube;
    expect(missingScopes([YOUTUBE_FULL_SCOPE, YOUTUBE_ANALYTICS_READONLY_SCOPE], required)).toEqual([]);
    expect(missingScopes([YOUTUBE_READONLY_SCOPE, YOUTUBE_ANALYTICS_READONLY_SCOPE], required)).toEqual([]);
    expect(missingScopes([YOUTUBE_FULL_SCOPE], required)).toContain(YOUTUBE_ANALYTICS_READONLY_SCOPE);
    expect(missingScopes([YOUTUBE_UPLOAD_SCOPE], required)).toEqual(
      expect.arrayContaining([YOUTUBE_READONLY_SCOPE, YOUTUBE_ANALYTICS_READONLY_SCOPE]),
    );
  });
});

describe("chunkIds helpers", () => {
  it("splits evenly and leaves a remainder", () => {
    const ids = Array.from({ length: 120 }, (_, i) => `id-${i}`);
    const batches = chunkIds(ids, YOUTUBE_DATA_BATCH);
    expect(batches.map((b) => b.length)).toEqual([50, 50, 20]);
    expect(chunkIds(ids, TIKTOK_VIDEO_BATCH).every((b) => b.length <= 20)).toBe(true);
  });
});

describe("YoutubeMetricsFetcher", () => {
  it("maps Data API + Analytics API responses into snapshot fields", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("youtube/v3/videos")) {
        return jsonResponse({
          items: [{
            id: "yt1",
            statistics: { viewCount: "1000", likeCount: "50", commentCount: "10" },
          }],
        });
      }
      if (url.includes("youtubeanalytics")) {
        return jsonResponse({
          rows: [["yt1", 30, 45.5, 62.1, 3, 7]],
        });
      }
      return jsonResponse({}, { status: 404 });
    });
    const fetcher = new YoutubeMetricsFetcher({ fetchImpl: fetchMock as typeof fetch, now });
    const tokens: TokenSet = { accessToken: ACCESS_SECRET, scopes: youtubeScopes() };
    const map = await fetcher.fetchVideoMetrics(
      [{ publicationId: "pub-1", externalId: "yt1" }],
      tokens,
      AbortSignal.timeout(5_000),
    );
    const snap = map.get("pub-1");
    expect(snap).toMatchObject({
      views: 1000,
      likes: 50,
      comments: 10,
      watchTimeSec: 1800,
      avgViewDurationSec: 45.5,
      avgViewPct: 62.1,
      subscribersGained: 3,
      shares: 7,
    });
  });

  it("soft-fails analytics enrichment and keeps Data API stats", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("youtube/v3/videos")) {
        return jsonResponse({
          items: [{ id: "yt1", statistics: { viewCount: "9", likeCount: "1", commentCount: "0" } }],
        });
      }
      return textResponse("unknown metric rejected", 400);
    });
    const fetcher = new YoutubeMetricsFetcher({ fetchImpl: fetchMock as typeof fetch, now });
    const map = await fetcher.fetchVideoMetrics(
      [{ publicationId: "pub-1", externalId: "yt1" }],
      { accessToken: ACCESS_SECRET, scopes: youtubeScopes() },
      AbortSignal.timeout(5_000),
    );
    expect(map.get("pub-1")).toMatchObject({ views: 9, likes: 1, comments: 0 });
    expect(map.get("pub-1")?.shares).toBeUndefined();
  });

  it("batches 120 ids into 50/50/20 for Data and Analytics calls", async () => {
    const pubs: PubRef[] = Array.from({ length: 120 }, (_, i) => ({
      publicationId: `pub-${i}`,
      externalId: `vid-${i}`,
    }));
    const dataIdLens: number[] = [];
    const analyticsIdLens: number[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.includes("/youtube/v3/videos")) {
        const ids = (url.searchParams.get("id") ?? "").split(",").filter(Boolean);
        dataIdLens.push(ids.length);
        return jsonResponse({
          items: ids.map((id) => ({ id, statistics: { viewCount: "1", likeCount: "0", commentCount: "0" } })),
        });
      }
      if (url.hostname.includes("youtubeanalytics")) {
        const filter = url.searchParams.get("filters") ?? "";
        const ids = filter.replace(/^video==/, "").split(",").filter(Boolean);
        analyticsIdLens.push(ids.length);
        return jsonResponse({ rows: [] });
      }
      return jsonResponse({}, { status: 404 });
    });
    const fetcher = new YoutubeMetricsFetcher({ fetchImpl: fetchMock as typeof fetch, now });
    await fetcher.fetchVideoMetrics(
      pubs,
      { accessToken: ACCESS_SECRET, scopes: youtubeScopes() },
      AbortSignal.timeout(5_000),
    );
    expect(dataIdLens).toEqual([50, 50, 20]);
    expect(analyticsIdLens).toEqual([50, 50, 20]);
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });
});

describe("TikTokMetricsFetcher", () => {
  it("maps video.query fields and batches ≤ 20 ids", async () => {
    const batchSizes: number[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/video/query/")) {
        const body = JSON.parse(String(init?.body)) as { filters: { video_ids: string[] } };
        batchSizes.push(body.filters.video_ids.length);
        expect(body.filters.video_ids.length).toBeLessThanOrEqual(TIKTOK_VIDEO_BATCH);
        return jsonResponse({
          error: { code: "ok" },
          data: {
            videos: body.filters.video_ids.slice(0, 1).map((id) => ({
              id,
              view_count: 200,
              like_count: 20,
              comment_count: 5,
              share_count: 3,
            })),
          },
        });
      }
      return jsonResponse({}, { status: 404 });
    });
    const pubs = Array.from({ length: 25 }, (_, i) => ({
      publicationId: `p-${i}`,
      externalId: `tt-${i}`,
    }));
    const fetcher = new TikTokMetricsFetcher({ fetchImpl: fetchMock as typeof fetch, now });
    const map = await fetcher.fetchVideoMetrics(
      pubs,
      { accessToken: ACCESS_SECRET, scopes: ["video.list", "user.info.stats"] },
      AbortSignal.timeout(5_000),
    );
    expect(batchSizes).toEqual([20, 5]);
    expect(map.get("p-0")).toMatchObject({ views: 200, likes: 20, comments: 5, shares: 3 });
  });

  it("returns empty map entries when API rejects with error code", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ error: { code: "scope_not_authorized", message: "nope" }, data: {} }),
    );
    const fetcher = new TikTokMetricsFetcher({ fetchImpl: fetchMock as typeof fetch, now });
    const map = await fetcher.fetchVideoMetrics(
      [{ publicationId: "p1", externalId: "tt1" }],
      { accessToken: ACCESS_SECRET, scopes: ["video.list"] },
      AbortSignal.timeout(5_000),
    );
    expect(map.size).toBe(0);
  });
});

describe("InstagramMetricsFetcher", () => {
  it("maps insights; drops rejected metrics and keeps the rest", async () => {
    let attempt = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.includes("/insights")) return jsonResponse({}, { status: 404 });
      attempt += 1;
      if (attempt === 1) {
        return textResponse('(#100) metric (shares) is not available', 400);
      }
      return jsonResponse({
        data: [
          { name: "views", values: [{ value: 500 }] },
          { name: "reach", values: [{ value: 400 }] },
          { name: "likes", values: [{ value: 40 }] },
          { name: "comments", values: [{ value: 4 }] },
          { name: "saved", values: [{ value: 2 }] },
          { name: "ig_reels_avg_watch_time", values: [{ value: 12500 }] },
          { name: "ig_reels_video_view_total_time", values: [{ value: 60000 }] },
          { name: "unknown_metric_xyz", values: [{ value: 1 }] },
        ],
      });
    });
    const fetcher = new InstagramMetricsFetcher({ fetchImpl: fetchMock as typeof fetch, now });
    const map = await fetcher.fetchVideoMetrics(
      [{ publicationId: "ig-pub", externalId: "media-1" }],
      { accessToken: ACCESS_SECRET, scopes: ["instagram_manage_insights"] },
      AbortSignal.timeout(5_000),
    );
    const snap = map.get("ig-pub");
    expect(snap).toMatchObject({
      views: 500,
      reach: 400,
      likes: 40,
      comments: 4,
      saves: 2,
      avgViewDurationSec: 12.5,
      watchTimeSec: 60,
    });
    expect(snap?.shares).toBeUndefined();
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(`graph.facebook.com/${META_GRAPH_VERSION}`);
  });
});

describe("FacebookMetricsFetcher", () => {
  it("maps video_insights including social actions; nulls rejected metrics", async () => {
    let attempt = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.includes("/video_insights")) return jsonResponse({}, { status: 404 });
      attempt += 1;
      if (attempt === 1) {
        return textResponse("(#100) post_impressions_unique is not valid", 400);
      }
      return jsonResponse({
        data: [
          { name: "blue_reels_play_count", values: [{ value: 900 }] },
          { name: "post_video_avg_time_watched", values: [{ value: 8000 }] },
          { name: "post_video_view_time", values: [{ value: 120000 }] },
          { name: "post_video_social_actions", values: [{ value: { LIKE: 11, COMMENT: 2, SHARE: 1 } }] },
        ],
      });
    });
    const fetcher = new FacebookMetricsFetcher({ fetchImpl: fetchMock as typeof fetch, now });
    const map = await fetcher.fetchVideoMetrics(
      [{ publicationId: "fb-pub", externalId: "vid-1" }],
      { accessToken: ACCESS_SECRET, scopes: ["read_insights"] },
      AbortSignal.timeout(5_000),
    );
    expect(map.get("fb-pub")).toMatchObject({
      views: 900,
      avgViewDurationSec: 8,
      watchTimeSec: 120,
      likes: 11,
      comments: 2,
      shares: 1,
    });
    expect(map.get("fb-pub")?.reach).toBeUndefined();
  });
});

describe("AnalyticsSyncService scopes + notifications", () => {
  it("missing scope → needs_reconnect, no API call, one attention notification (6h dedup)", async () => {
    const profileId = seedProfile();
    const accountId = seedAccount(profileId, "youtube");
    storeTokens(accountId, [YOUTUBE_UPLOAD_SCOPE, YOUTUBE_READONLY_SCOPE]); // missing analytics
    const { projectId, renderId } = seedProject(profileId);
    seedPublication({
      projectId,
      renderId,
      accountId,
      externalId: "yt-ext",
      publishedAt: new Date(nowMs - 3600_000).toISOString(),
    });

    const fetchMock = vi.fn(async () => jsonResponse({ items: [] }));
    const sent: string[] = [];
    const notifications = makeNotifications(sent);
    const fetchers = createFetchers({ fetchImpl: fetchMock as typeof fetch, now });
    const service = makeSyncService({
      fetchers,
      publishers: [mockPublisher("youtube")],
      notifications,
    });

    const first = await service.syncAccount(accountId, AbortSignal.timeout(5_000), { force: true });
    await flushNotify();
    expect(first.skipped).toBe(true);
    expect(first.reason).toMatch(/Kết nối lại/);
    expect(fetchMock).not.toHaveBeenCalled();

    const row = sqlite.prepare(
      "SELECT analytics_status, analytics_last_error FROM platform_accounts WHERE id = ?",
    ).get(accountId) as { analytics_status: string; analytics_last_error: string };
    expect(row.analytics_status).toBe("needs_reconnect");

    expect(sent.length).toBe(1);
    expect(notifications.listLog().filter((l) => l.kind === "account_error")).toHaveLength(1);

    const second = await service.syncAccount(accountId, AbortSignal.timeout(5_000), { force: true });
    await flushNotify();
    expect(second.skipped).toBe(true);
    expect(sent.length).toBe(1); // 6h dedup
    expect(fetchMock).not.toHaveBeenCalled();

    const statuses = service.listAccountStatuses();
    const statusJson = JSON.stringify(statuses);
    expect(statusJson).not.toContain(ACCESS_SECRET);
    expect(statusJson).not.toContain("accessToken");
    expect(statuses.find((s) => s.accountId === accountId)?.analyticsStatus).toBe("needs_reconnect");
    expect(statuses.find((s) => s.accountId === accountId)?.missingScopes).toContain(
      YOUTUBE_ANALYTICS_READONLY_SCOPE,
    );
  });
});

describe("AnalyticsSyncService freshness via tick", () => {
  it("only syncs publications that are due at the fake clock", async () => {
    const profileId = seedProfile();
    const accountId = seedAccount(profileId, "youtube");
    storeTokens(accountId, youtubeScopes());
    const { projectId, renderId } = seedProject(profileId);

    const dueId = seedPublication({
      projectId,
      renderId,
      accountId,
      externalId: "due-vid",
      publishedAt: new Date(nowMs - 3 * 3600_000).toISOString(),
      metricsSyncedAt: new Date(nowMs - 3 * 3600_000).toISOString(), // past 2h cadence
    });
    const freshId = seedPublication({
      projectId,
      renderId,
      accountId,
      externalId: "fresh-vid",
      publishedAt: new Date(nowMs - 3 * 3600_000).toISOString(),
      metricsSyncedAt: new Date(nowMs - 30 * 60_000).toISOString(), // within 2h
    });

    expect(isDue(
      new Date(nowMs - 3 * 3600_000),
      new Date(nowMs - 3 * 3600_000),
      now(),
    )).toBe(true);
    expect(isDue(
      new Date(nowMs - 3 * 3600_000),
      new Date(nowMs - 30 * 60_000),
      now(),
    )).toBe(false);

    const requested: string[] = [];
    const fetcher: MetricsFetcher = {
      platform: "youtube",
      requiredScopes: [...ANALYTICS_REQUIRED_SCOPES.youtube],
      async fetchVideoMetrics(pubs) {
        for (const p of pubs) requested.push(p.publicationId);
        return new Map(pubs.map((p) => [p.publicationId, { views: 1, likes: 0, comments: 0 }]));
      },
    };
    const fetchers = new Map<PlatformId, MetricsFetcher>([["youtube", fetcher]]);
    const service = makeSyncService({
      fetchers,
      publishers: [mockPublisher("youtube")],
    });

    await service.tick(AbortSignal.timeout(5_000));
    expect(requested).toContain(dueId);
    expect(requested).not.toContain(freshId);
  });
});

describe("AnalyticsSyncService quota backoff + 401 refresh", () => {
  it("backs off on quota/429 and skips subsequent sync until window passes", async () => {
    const profileId = seedProfile();
    const accountId = seedAccount(profileId, "youtube");
    storeTokens(accountId, youtubeScopes());
    const { projectId, renderId } = seedProject(profileId);
    seedPublication({
      projectId,
      renderId,
      accountId,
      externalId: "q-vid",
      publishedAt: new Date(nowMs - 3600_000).toISOString(),
    });

    let calls = 0;
    const fetcher: MetricsFetcher = {
      platform: "youtube",
      requiredScopes: [...ANALYTICS_REQUIRED_SCOPES.youtube],
      async fetchVideoMetrics() {
        calls += 1;
        throw new AnalyticsHttpError("quota", 429, true);
      },
    };
    const service = makeSyncService({
      fetchers: new Map([["youtube", fetcher]]),
      publishers: [mockPublisher("youtube")],
    });

    const first = await service.syncAccount(accountId, AbortSignal.timeout(5_000), { force: true });
    expect(first.skipped).toBe(true);
    expect(first.reason).toMatch(/hạn mức/i);
    expect(calls).toBe(1);

    const second = await service.syncAccount(accountId, AbortSignal.timeout(5_000), { force: true });
    expect(second.skipped).toBe(true);
    expect(second.reason).toMatch(/hạn mức/i);
    expect(calls).toBe(1); // no new API call while backoff active

    nowMs += 61 * 60_000; // past default 1h backoff
    const third = await service.syncAccount(accountId, AbortSignal.timeout(5_000), { force: true });
    expect(calls).toBe(2);
    expect(third.reason).toMatch(/hạn mức/i);
  });

  it("refreshes token once on 401 then succeeds", async () => {
    const profileId = seedProfile();
    const accountId = seedAccount(profileId, "youtube");
    storeTokens(accountId, youtubeScopes());
    const { projectId, renderId } = seedProject(profileId);
    const pubId = seedPublication({
      projectId,
      renderId,
      accountId,
      externalId: "auth-vid",
      publishedAt: new Date(nowMs - 3600_000).toISOString(),
    });

    let attempts = 0;
    const refresh = vi.fn(async (tokens: TokenSet) => ({
      ...tokens,
      accessToken: "refreshed-access-token",
      expiresAt: new Date(nowMs + 7200_000).toISOString(),
      scopes: youtubeScopes(),
    }));
    const fetcher: MetricsFetcher = {
      platform: "youtube",
      requiredScopes: [...ANALYTICS_REQUIRED_SCOPES.youtube],
      async fetchVideoMetrics(_pubs, tokens) {
        attempts += 1;
        if (tokens.accessToken === ACCESS_SECRET) {
          throw new AnalyticsHttpError("unauthorized", 401);
        }
        return new Map([[pubId, { views: 42, likes: 2, comments: 1 }]]);
      },
    };
    const service = makeSyncService({
      fetchers: new Map([["youtube", fetcher]]),
      publishers: [mockPublisher("youtube", refresh)],
    });

    const result = await service.syncAccount(accountId, AbortSignal.timeout(5_000), { force: true });
    expect(result.synced).toBe(true);
    expect(result.publicationsSynced).toBe(1);
    expect(attempts).toBe(2);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(vault.loadTokens(accountId)?.accessToken).toBe("refreshed-access-token");

    const syncJson = JSON.stringify(result);
    expect(syncJson).not.toContain(ACCESS_SECRET);
    expect(syncJson).not.toContain("refreshed-access-token");
    expect(syncJson).not.toContain("accessToken");
  });
});

describe("buildOverview aggregation", () => {
  it("computes totals, series, top/bottom, and previous-period deltas", () => {
    const profileId = seedProfile("Overview");
    const ytAccount = seedAccount(profileId, "youtube", { displayName: "YT" });
    const ttAccount = seedAccount(profileId, "tiktok", { displayName: "TT" });
    storeTokens(ytAccount, youtubeScopes());
    storeTokens(ttAccount, ["video.list", "user.info.stats"]);

    const a = seedProject(profileId, "Hot video");
    const b = seedProject(profileId, "Cold video");
    const c = seedProject(profileId, "Prev video");

    const hotId = seedPublication({
      projectId: a.projectId,
      renderId: a.renderId,
      accountId: ytAccount,
      externalId: "hot",
      publishedAt: "2026-11-03T10:00:00.000Z",
      latestMetrics: { views: 1000, likes: 100, comments: 10, shares: 5, watchTimeSec: 7200, avgViewPct: 80 },
    });
    const coldId = seedPublication({
      projectId: b.projectId,
      renderId: b.renderId,
      accountId: ttAccount,
      externalId: "cold",
      publishedAt: "2026-11-04T10:00:00.000Z",
      latestMetrics: { views: 50, likes: 5, comments: 1, shares: 0, watchTimeSec: 600, avgViewPct: 20 },
    });
    seedPublication({
      projectId: c.projectId,
      renderId: c.renderId,
      accountId: ytAccount,
      externalId: "prev",
      publishedAt: "2026-10-28T10:00:00.000Z",
      latestMetrics: { views: 200, likes: 20, comments: 2, shares: 1, watchTimeSec: 3600, avgViewPct: 50 },
    });

    const snapTs = "2026-11-04T15:00:00.000Z";
    sqlite.prepare(
      `INSERT INTO publication_metrics_snapshots (
         id, publication_id, fetched_at, views, likes, comments, shares, saves,
         watch_time_sec, avg_view_duration_sec, avg_view_pct, subscribers_gained, reach, raw
       ) VALUES (?, ?, ?, 1000, 100, 10, 5, NULL, 7200, NULL, 80, NULL, NULL, '{}')`,
    ).run(randomUUID(), hotId, snapTs);
    sqlite.prepare(
      `INSERT INTO publication_metrics_snapshots (
         id, publication_id, fetched_at, views, likes, comments, shares, saves,
         watch_time_sec, avg_view_duration_sec, avg_view_pct, subscribers_gained, reach, raw
       ) VALUES (?, ?, ?, 50, 5, 1, 0, NULL, 600, NULL, 20, NULL, NULL, '{}')`,
    ).run(randomUUID(), coldId, snapTs);

    sqlite.prepare(
      `INSERT INTO channel_metrics_daily (account_id, date, followers, views, watch_time_sec, fetched_at)
       VALUES (?, '2026-11-01', 100, 10, 100, ?), (?, '2026-11-07', 130, 40, 400, ?)`,
    ).run(ytAccount, snapTs, ytAccount, snapTs);
    sqlite.prepare(
      `INSERT INTO channel_metrics_daily (account_id, date, followers, views, watch_time_sec, fetched_at)
       VALUES (?, '2026-10-25', 90, 5, 50, ?), (?, '2026-10-31', 100, 8, 80, ?)`,
    ).run(ytAccount, snapTs, ytAccount, snapTs);

    const overview = buildOverview(
      sqlite,
      { from: "2026-11-01", to: "2026-11-07", profileId },
      now(),
    );

    expect(overview.totals.views).toBe(1050);
    expect(overview.totals.likes).toBe(105);
    expect(overview.totals.comments).toBe(11);
    expect(overview.totals.shares).toBe(5);
    expect(overview.totals.watchHours).toBeCloseTo(2.166, 2); // 7800/3600
    expect(overview.totals.followersDelta).toBe(30);

    expect(overview.totals.previous.views).toBe(200);
    expect(overview.totals.delta.views).toBe(850);
    expect(overview.totals.previous.followersDelta).toBe(10);
    expect(overview.totals.delta.followersDelta).toBe(20);

    expect(overview.topByViews[0]?.publicationId).toBe(hotId);
    expect(overview.bottomByViews[0]?.publicationId).toBe(coldId);
    expect(overview.topByAvgViewPct[0]?.publicationId).toBe(hotId);
    expect(overview.bottomByAvgViewPct[0]?.publicationId).toBe(coldId);

    expect(overview.series.some((p) => p.date === "2026-11-01" && p.platform === "youtube")).toBe(true);
    expect(overview.byPlatform.map((p) => p.platform).sort()).toEqual(["tiktok", "youtube"]);

    const service = makeSyncService({
      fetchers: createFetchers({ now }),
      publishers: [mockPublisher("youtube"), mockPublisher("tiktok")],
    });
    const viaService = service.getOverview({ from: "2026-11-01", to: "2026-11-07", profileId });
    expect(viaService.totals.views).toBe(overview.totals.views);
    expect(JSON.stringify(viaService)).not.toContain(ACCESS_SECRET);
    expect(JSON.stringify(viaService)).not.toContain("accessToken");
  });
});
