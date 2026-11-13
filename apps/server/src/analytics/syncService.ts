import { enqueueIndex } from "../retrieval/service.js";
import { scopeSql } from "../auth/requestContext.js";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type {
  AnalyticsAccountStatus,
  AnalyticsOverviewQuery,
  AnalyticsOverviewResponse,
  AnalyticsPublicationSeriesResponse,
  AnalyticsSyncResponse,
  PlatformId,
  TokenSet,
} from "@vg/shared";
import type { FastifyBaseLogger } from "fastify";
import { safeNotify, type NotificationService } from "../notifications/notificationService.js";
import type { PublisherRegistry } from "../publishing/registry.js";
import type { TokenVault } from "../publishing/tokenVault.js";
import type { YoutubeQuotaTracker } from "../publishing/youtubeQuota.js";
import type { Publisher } from "../publishing/types.js";
import { isDue } from "./freshness.js";
import { buildOverview } from "./overview.js";
import { missingScopes } from "./scopes.js";
import {
  errorStatus,
  type MetricsFetcher,
  type MetricsSnapshotInput,
  type PubRef,
} from "./types.js";

const REFRESH_SKEW_MS = 5 * 60 * 1000;
const MANUAL_SYNC_COOLDOWN_MS = 5 * 60 * 1000;
const DEFAULT_BACKOFF_MS = 60 * 60 * 1000;

const KEY_BACKOFF = (accountId: string) => `analyticsBackoff:${accountId}`;
const KEY_MANUAL = (accountId: string) => `analyticsManualSync:${accountId}`;
const KEY_CHANNEL_DAY = (accountId: string) => `analyticsChannelDaily:${accountId}`;

type AccountRow = {
  id: string;
  profile_id: string;
  platform: PlatformId;
  display_name: string;
  handle: string | null;
  external_id: string | null;
  connection: string;
  analytics_status: string | null;
  analytics_last_error: string | null;
  analytics_synced_at: string | null;
};

type DuePubRow = {
  id: string;
  external_id: string;
  published_at: string;
  metrics_synced_at: string | null;
};

export type AnalyticsSyncServiceDeps = {
  sqlite: Database.Database;
  vault: TokenVault;
  registry: PublisherRegistry;
  fetchers: Map<PlatformId, MetricsFetcher>;
  logger: FastifyBaseLogger;
  notifications?: NotificationService | null;
  now?: () => Date;
  youtubeQuota?: YoutubeQuotaTracker;
};

export class AnalyticsSyncService {
  private readonly sqlite: Database.Database;
  private readonly vault: TokenVault;
  private readonly registry: PublisherRegistry;
  private readonly fetchers: Map<PlatformId, MetricsFetcher>;
  private readonly logger: FastifyBaseLogger;
  private notifications: NotificationService | null;
  private readonly now: () => Date;

  constructor(deps: AnalyticsSyncServiceDeps) {
    this.sqlite = deps.sqlite;
    this.vault = deps.vault;
    this.registry = deps.registry;
    this.fetchers = deps.fetchers;
    this.logger = deps.logger;
    this.notifications = deps.notifications ?? null;
    this.now = deps.now ?? (() => new Date());
  }

  setNotifications(service: NotificationService | null): void {
    this.notifications = service;
  }

  async tick(signal: AbortSignal): Promise<void> {
    const accounts = this.sqlite.prepare(
      `SELECT id, profile_id, platform, display_name, handle, external_id, connection,
              analytics_status, analytics_last_error, analytics_synced_at
       FROM platform_accounts
       WHERE connection = 'CONNECTED'`,
    ).all() as AccountRow[];

    for (const account of accounts) {
      if (signal.aborted) return;
      const fetcher = this.fetchers.get(account.platform);
      if (!fetcher) continue;
      try {
        await this.syncOneAccount(account, fetcher, signal, { force: false });
      } catch (err) {
        this.logger.warn(
          { err: err instanceof Error ? err.message : String(err), accountId: account.id },
          "Analytics sync account failed",
        );
      }
    }
  }

  async syncAccount(
    accountId: string,
    signal: AbortSignal,
    opts: { force?: boolean } = {},
  ): Promise<AnalyticsSyncResponse> {
    const account = this.sqlite.prepare(
      `SELECT id, profile_id, platform, display_name, handle, external_id, connection,
              analytics_status, analytics_last_error, analytics_synced_at
       FROM platform_accounts WHERE id = ?`,
    ).get(accountId) as AccountRow | undefined;

    if (!account) {
      return {
        accountId,
        synced: false,
        skipped: true,
        reason: "Không tìm thấy tài khoản",
        publicationsSynced: 0,
      };
    }

    if (account.connection !== "CONNECTED") {
      return {
        accountId,
        synced: false,
        skipped: true,
        reason: "Tài khoản chưa kết nối",
        publicationsSynced: 0,
      };
    }

    const fetcher = this.fetchers.get(account.platform);
    if (!fetcher) {
      return {
        accountId,
        synced: false,
        skipped: true,
        reason: "Nền tảng không hỗ trợ thống kê",
        publicationsSynced: 0,
      };
    }

    if (!opts.force) {
      const lastManual = this.readSettingNumber(KEY_MANUAL(accountId));
      if (lastManual != null && this.now().getTime() - lastManual < MANUAL_SYNC_COOLDOWN_MS) {
        return {
          accountId,
          synced: false,
          skipped: true,
          reason: "Chỉ được đồng bộ thủ công mỗi 5 phút",
          publicationsSynced: 0,
        };
      }
    }

    const result = await this.syncOneAccount(account, fetcher, signal, {
      force: true,
    });
    this.writeSetting(KEY_MANUAL(accountId), String(this.now().getTime()));
    return result;
  }

  listAccountStatuses(): AnalyticsAccountStatus[] {
    const rows = this.sqlite.prepare(
      `SELECT a.id, a.profile_id, a.platform, a.display_name,
              a.analytics_status, a.analytics_last_error, a.analytics_synced_at
       FROM platform_accounts a
       JOIN profiles scope_p ON scope_p.id = a.profile_id
       WHERE ${scopeSql("scope_p.workspace_id", "a.profile_id").sql}
       ORDER BY a.platform, a.display_name`,
    ).all(...scopeSql("scope_p.workspace_id", "a.profile_id").args) as Array<{
      id: string;
      profile_id: string;
      platform: PlatformId;
      display_name: string;
      analytics_status: string | null;
      analytics_last_error: string | null;
      analytics_synced_at: string | null;
    }>;

    return rows.map((row) => {
      const fetcher = this.fetchers.get(row.platform);
      const meta = this.vault.getCredentialMeta(row.id);
      const granted = meta?.scopes ?? [];
      const required = fetcher?.requiredScopes ?? [];
      const missing = missingScopes(granted, required);
      const status =
        row.analytics_status === "ok" || row.analytics_status === "needs_reconnect"
          ? row.analytics_status
          : missing.length > 0
            ? "needs_reconnect"
            : null;
      return {
        accountId: row.id,
        profileId: row.profile_id,
        platform: row.platform,
        displayName: row.display_name,
        analyticsStatus: status,
        lastSyncAt: row.analytics_synced_at,
        lastError: row.analytics_last_error,
        missingScopes: missing,
      };
    });
  }

  getPublicationSeries(publicationId: string): AnalyticsPublicationSeriesResponse {
    const rows = this.sqlite.prepare(
      `SELECT id, publication_id, fetched_at, views, likes, comments, shares, saves,
              watch_time_sec, avg_view_duration_sec, avg_view_pct, subscribers_gained, reach
       FROM publication_metrics_snapshots
       WHERE publication_id = ?
       ORDER BY fetched_at ASC`,
    ).all(publicationId) as Array<{
      id: string;
      publication_id: string;
      fetched_at: string;
      views: number | null;
      likes: number | null;
      comments: number | null;
      shares: number | null;
      saves: number | null;
      watch_time_sec: number | null;
      avg_view_duration_sec: number | null;
      avg_view_pct: number | null;
      subscribers_gained: number | null;
      reach: number | null;
    }>;

    return {
      publicationId,
      snapshots: rows.map((row) => ({
        id: row.id,
        publicationId: row.publication_id,
        fetchedAt: row.fetched_at,
        views: row.views,
        likes: row.likes,
        comments: row.comments,
        shares: row.shares,
        saves: row.saves,
        watchTimeSec: row.watch_time_sec,
        avgViewDurationSec: row.avg_view_duration_sec,
        avgViewPct: row.avg_view_pct,
        subscribersGained: row.subscribers_gained,
        reach: row.reach,
      })),
    };
  }

  getOverview(query: AnalyticsOverviewQuery): AnalyticsOverviewResponse {
    return buildOverview(this.sqlite, query, this.now());
  }

  private async syncOneAccount(
    account: AccountRow,
    fetcher: MetricsFetcher,
    signal: AbortSignal,
    opts: { force: boolean },
  ): Promise<AnalyticsSyncResponse> {
    const accountId = account.id;

    const backoffUntil = this.readBackoffUntil(accountId);
    if (backoffUntil && this.now().getTime() < backoffUntil) {
      return {
        accountId,
        synced: false,
        skipped: true,
        reason: "Đang tạm dừng do hạn mức API",
        publicationsSynced: 0,
      };
    }

    const meta = this.vault.getCredentialMeta(accountId);
    const granted = meta?.scopes ?? [];
    const missing = missingScopes(granted, fetcher.requiredScopes);
    if (missing.length > 0) {
      this.setAnalyticsStatus(accountId, "needs_reconnect", "Thiếu quyền thống kê");
      safeNotify(this.notifications, {
        kind: "account_error",
        accountId,
        account: account.display_name || account.handle || accountId,
        error: "Kết nối lại để bật thống kê",
      });
      return {
        accountId,
        synced: false,
        skipped: true,
        reason: "Kết nối lại để bật thống kê",
        publicationsSynced: 0,
      };
    }

    let tokens = this.vault.loadTokens(accountId);
    if (!tokens) {
      this.setAnalyticsStatus(accountId, "needs_reconnect", "Không có token");
      return {
        accountId,
        synced: false,
        skipped: true,
        reason: "Không có token",
        publicationsSynced: 0,
      };
    }

    const publisher = this.registry.get(account.platform);
    if (!publisher) {
      return {
        accountId,
        synced: false,
        skipped: true,
        reason: "Không có publisher",
        publicationsSynced: 0,
      };
    }

    try {
      tokens = await this.ensureFreshTokens(accountId, publisher, tokens, signal);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.setAnalyticsStatus(accountId, "needs_reconnect", msg);
      return {
        accountId,
        synced: false,
        skipped: true,
        reason: msg,
        publicationsSynced: 0,
      };
    }

    const duePubs = this.loadDuePublications(accountId, opts.force);
    let publicationsSynced = 0;

    try {
      if (duePubs.length > 0) {
        publicationsSynced = await this.fetchAndPersistVideos(
          account,
          fetcher,
          publisher,
          tokens,
          duePubs,
          signal,
        );
      }

      await this.maybeSyncChannelDaily(account, fetcher, tokens, signal);

      this.setAnalyticsStatus(accountId, "ok", null);
      this.sqlite.prepare(
        "UPDATE platform_accounts SET analytics_synced_at = ?, updated_at = ? WHERE id = ?",
      ).run(this.now().toISOString(), this.now().toISOString(), accountId);
      this.clearBackoff(accountId);

      return {
        accountId,
        synced: true,
        skipped: false,
        reason: null,
        publicationsSynced,
      };
    } catch (err) {
      return this.handleSyncError(account, publisher, fetcher, tokens, duePubs, signal, err, publicationsSynced);
    }
  }

  private async fetchAndPersistVideos(
    account: AccountRow,
    fetcher: MetricsFetcher,
    publisher: Publisher,
    tokens: TokenSet,
    duePubs: DuePubRow[],
    signal: AbortSignal,
    retried = false,
  ): Promise<number> {
    const refs: PubRef[] = duePubs.map((p) => ({
      publicationId: p.id,
      externalId: p.external_id,
    }));

    let map: Map<string, MetricsSnapshotInput>;
    try {
      map = await fetcher.fetchVideoMetrics(refs, tokens, signal);
    } catch (err) {
      const status = errorStatus(err);
      if (status === 401 && !retried) {
        const refreshed = await publisher.oauth.refresh(tokens, signal, account.id);
        this.vault.storeTokens(account.id, refreshed, refreshed.scopes);
        return this.fetchAndPersistVideos(
          account,
          fetcher,
          publisher,
          refreshed,
          duePubs,
          signal,
          true,
        );
      }
      throw err;
    }

    const fetchedAt = this.now().toISOString();
    const projectRevision = this.sqlite.prepare(`SELECT json_extract(j.settings, '$.knowledgeRev') AS revision
      FROM publications p JOIN projects j ON j.id = p.project_id WHERE p.id = ?`);
    let count = 0;
    const insert = this.sqlite.prepare(
      `INSERT INTO publication_metrics_snapshots (
         id, publication_id, fetched_at, views, likes, comments, shares, saves,
         watch_time_sec, avg_view_duration_sec, avg_view_pct, subscribers_gained, reach, raw
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const updatePub = this.sqlite.prepare(
      `UPDATE publications SET latest_metrics = ?, metrics_synced_at = ?, updated_at = ?
       WHERE id = ?`,
    );
    const touchPub = this.sqlite.prepare(
      `UPDATE publications SET metrics_synced_at = ?, updated_at = ? WHERE id = ?`,
    );

    const tx = this.sqlite.transaction(() => {
      for (const [publicationId, metrics] of map) {
        const revision = projectRevision.get(publicationId) as { revision: string | null } | undefined;
        const id = randomUUID();
        insert.run(
          id,
          publicationId,
          fetchedAt,
          metrics.views ?? null,
          metrics.likes ?? null,
          metrics.comments ?? null,
          metrics.shares ?? null,
          metrics.saves ?? null,
          metrics.watchTimeSec ?? null,
          metrics.avgViewDurationSec ?? null,
          metrics.avgViewPct ?? null,
          metrics.subscribersGained ?? null,
          metrics.reach ?? null,
          JSON.stringify({ ...metrics.raw, knowledgeRev: revision?.revision ?? "unknown" }),
        );
        const latest = {
          views: metrics.views ?? null,
          likes: metrics.likes ?? null,
          comments: metrics.comments ?? null,
          shares: metrics.shares ?? null,
          saves: metrics.saves ?? null,
          watchTimeSec: metrics.watchTimeSec ?? null,
          avgViewDurationSec: metrics.avgViewDurationSec ?? null,
          avgViewPct: metrics.avgViewPct ?? null,
          subscribersGained: metrics.subscribersGained ?? null,
          reach: metrics.reach ?? null,
        };
        updatePub.run(JSON.stringify(latest), fetchedAt, fetchedAt, publicationId);
        count += 1;
      }
      // Mark due pubs without returned metrics as attempted (keep prior latest_metrics).
      for (const pub of duePubs) {
        if (map.has(pub.id)) continue;
        touchPub.run(fetchedAt, fetchedAt, pub.id);
      }
    });
    tx();
    return count;
  }

  private async maybeSyncChannelDaily(
    account: AccountRow,
    fetcher: MetricsFetcher,
    tokens: TokenSet,
    signal: AbortSignal,
  ): Promise<void> {
    if (!fetcher.fetchChannelDaily) return;
    const today = this.now().toISOString().slice(0, 10);
    const lastDay = this.readSetting(KEY_CHANNEL_DAY(account.id));
    if (lastDay === today) return;

    const from = addDaysUtc(today, -7);
    const rows = await fetcher.fetchChannelDaily(
      { accountId: account.id, externalId: account.external_id },
      tokens,
      from,
      today,
      signal,
    );

    const upsert = this.sqlite.prepare(
      `INSERT INTO channel_metrics_daily (account_id, date, followers, views, watch_time_sec, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(account_id, date) DO UPDATE SET
         followers = COALESCE(excluded.followers, channel_metrics_daily.followers),
         views = COALESCE(excluded.views, channel_metrics_daily.views),
         watch_time_sec = COALESCE(excluded.watch_time_sec, channel_metrics_daily.watch_time_sec),
         fetched_at = excluded.fetched_at`,
    );
    const fetchedAt = this.now().toISOString();
    const tx = this.sqlite.transaction(() => {
      for (const row of rows) {
        upsert.run(
          account.id,
          row.date,
          row.followers ?? null,
          row.views ?? null,
          row.watchTimeSec ?? null,
          fetchedAt,
        );
      }
    });
    tx();
    this.writeSetting(KEY_CHANNEL_DAY(account.id), today);
  }

  private async handleSyncError(
    account: AccountRow,
    publisher: Publisher,
    fetcher: MetricsFetcher,
    tokens: TokenSet,
    duePubs: DuePubRow[],
    signal: AbortSignal,
    err: unknown,
    alreadySynced: number,
  ): Promise<AnalyticsSyncResponse> {
    const status = errorStatus(err);
    const message = err instanceof Error ? err.message : String(err);

    if (status === 401) {
      try {
        const refreshed = await publisher.oauth.refresh(tokens, signal, account.id);
        this.vault.storeTokens(account.id, refreshed, refreshed.scopes);
        if (duePubs.length > 0) {
          const n = await this.fetchAndPersistVideos(
            account,
            fetcher,
            publisher,
            refreshed,
            duePubs,
            signal,
            true,
          );
          await this.maybeSyncChannelDaily(account, fetcher, refreshed, signal);
          this.setAnalyticsStatus(account.id, "ok", null);
          this.sqlite.prepare(
            "UPDATE platform_accounts SET analytics_synced_at = ?, updated_at = ? WHERE id = ?",
          ).run(this.now().toISOString(), this.now().toISOString(), account.id);
          return {
            accountId: account.id,
            synced: true,
            skipped: false,
            reason: null,
            publicationsSynced: alreadySynced + n,
          };
        }
      } catch (refreshErr) {
        const msg = refreshErr instanceof Error ? refreshErr.message : String(refreshErr);
        this.setAnalyticsStatus(account.id, "needs_reconnect", msg);
        return {
          accountId: account.id,
          synced: false,
          skipped: true,
          reason: msg,
          publicationsSynced: alreadySynced,
        };
      }
    }

    if (status === 429 || status === 403) {
      const until = this.now().getTime() + DEFAULT_BACKOFF_MS;
      this.writeSetting(KEY_BACKOFF(account.id), JSON.stringify({ until }));
      this.setAnalyticsStatus(account.id, "ok", "Tạm dừng do hạn mức API");
      this.logger.warn({ accountId: account.id, status }, "Analytics backoff after quota/429");
      return {
        accountId: account.id,
        synced: false,
        skipped: true,
        reason: "Đang tạm dừng do hạn mức API",
        publicationsSynced: alreadySynced,
      };
    }

    this.setAnalyticsStatus(account.id, "ok", message);
    this.logger.warn({ accountId: account.id, err: message }, "Analytics sync error");
    return {
      accountId: account.id,
      synced: false,
      skipped: false,
      reason: message,
      publicationsSynced: alreadySynced,
    };
  }

  private loadDuePublications(accountId: string, force: boolean): DuePubRow[] {
    const rows = this.sqlite.prepare(
      `SELECT id, external_id, published_at, metrics_synced_at
       FROM publications
       WHERE account_id = ? AND status = 'PUBLISHED'
         AND external_id IS NOT NULL AND published_at IS NOT NULL`,
    ).all(accountId) as DuePubRow[];

    if (force) return rows;

    const now = this.now();
    return rows.filter((row) => {
      const publishedAt = new Date(row.published_at);
      const last = row.metrics_synced_at ? new Date(row.metrics_synced_at) : null;
      return isDue(publishedAt, last, now);
    });
  }

  private async ensureFreshTokens(
    accountId: string,
    publisher: Publisher,
    tokens: TokenSet,
    signal: AbortSignal,
  ): Promise<TokenSet> {
    if (!tokens.expiresAt) return tokens;
    const expiresAt = Date.parse(tokens.expiresAt);
    if (Number.isNaN(expiresAt) || expiresAt - this.now().getTime() > REFRESH_SKEW_MS) {
      return tokens;
    }
    const refreshed = await publisher.oauth.refresh(tokens, signal, accountId);
    this.vault.storeTokens(accountId, refreshed, refreshed.scopes);
    return refreshed;
  }

  private setAnalyticsStatus(
    accountId: string,
    status: "ok" | "needs_reconnect",
    error: string | null,
  ): void {
    this.sqlite.prepare(
      `UPDATE platform_accounts
       SET analytics_status = ?, analytics_last_error = ?, updated_at = ?
       WHERE id = ?`,
    ).run(status, error, this.now().toISOString(), accountId);
  }

  private readBackoffUntil(accountId: string): number | null {
    const raw = this.readSetting(KEY_BACKOFF(accountId));
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as { until?: number };
      return typeof parsed.until === "number" ? parsed.until : null;
    } catch {
      return null;
    }
  }

  private clearBackoff(accountId: string): void {
    this.sqlite.prepare("DELETE FROM app_settings WHERE key = ?").run(KEY_BACKOFF(accountId));
  }

  private readSetting(key: string): string | null {
    const row = this.sqlite.prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  private readSettingNumber(key: string): number | null {
    const raw = this.readSetting(key);
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }

  private writeSetting(key: string, value: string): void {
    this.sqlite.prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).run(key, value, this.now().toISOString());
  }
}

function addDaysUtc(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
