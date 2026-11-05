import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  YOUTUBE_ANALYTICS_MONETARY_READONLY_SCOPE,
  type PlatformId,
  type TokenSet,
} from "@vg/shared";
import { previewRevenueCsv } from "../src/finance/csvImport.js";
import { FinanceService } from "../src/finance/financeService.js";
import { upsertYoutubeRevenueEntries } from "../src/finance/youtubeRevenue.js";
import { openDatabase } from "../src/db/client.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { parseConfig, type AppConfig } from "../src/lib/config.js";
import { NotificationService } from "../src/notifications/notificationService.js";
import { saveNotificationSettings, TELEGRAM_BOT_TOKEN_KEY } from "../src/settings/notifications.js";
import { PublisherRegistry } from "../src/publishing/registry.js";
import { TokenVault } from "../src/publishing/tokenVault.js";
import { UsageService } from "../src/services/usageService.js";
import type { Publisher } from "../src/publishing/types.js";

const root = mkdtempSync(join(tmpdir(), "vg-finance-"));
const ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");

let dataDir: string;
let sqlite: ReturnType<typeof openDatabase>["sqlite"];
let vault: TokenVault;
let config: AppConfig;
let nowMs: number;
const now = () => new Date(nowMs);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function silentLogger() {
  return { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(), child: () => silentLogger() } as never;
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
    USD_VND_RATE: "25000",
  });
  vault = new TokenVault(sqlite, dataDir, ENCRYPTION_KEY);
  nowMs = Date.parse("2026-11-05T14:00:00.000Z");
  sqlite.prepare(
    `INSERT INTO currency_rates (currency, rate_to_app_currency, updated_at) VALUES ('USD', 25000, ?)`,
  ).run(now().toISOString());
});

afterEach(() => {
  sqlite.close();
  vi.restoreAllMocks();
});

afterAll(() => {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

function seedProfile(name = `P-${randomUUID().slice(0, 8)}`): string {
  const id = randomUUID();
  const ts = now().toISOString();
  sqlite.prepare(
    `INSERT INTO profiles (id, name, description, direction, language, default_brief, voice, guidelines, llm, avatar_path, color, archived_at, created_at, updated_at)
     VALUES (?, ?, '', '', 'vi', ?, NULL, ?, NULL, NULL, '#3B82F6', NULL, ?, ?)`,
  ).run(id, name, JSON.stringify({ platform: "youtube" }), JSON.stringify({ platformPack: "auto", customRules: [] }), ts, ts);
  return id;
}

function seedAccount(profileId: string, platform: PlatformId = "youtube"): string {
  const id = randomUUID();
  const ts = now().toISOString();
  sqlite.prepare(
    `INSERT INTO platform_accounts (
      id, profile_id, platform, display_name, handle, external_id, format, enabled,
      connection, connection_error, last_checked_at, analytics_status, analytics_last_error, analytics_synced_at,
      revenue_sync_enabled, revenue_status, revenue_last_error, revenue_synced_at,
      publish_settings, created_at, updated_at
    ) VALUES (?, ?, ?, ?, NULL, ?, 'landscape', 1, 'CONNECTED', NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL, NULL, ?, ?, ?)`,
  ).run(id, profileId, platform, `Acc ${id.slice(0, 6)}`, `ch_${id.slice(0, 8)}`, JSON.stringify({}), ts, ts);
  return id;
}

function storeTokens(accountId: string, scopes: string[]): void {
  const tokens: TokenSet = {
    accessToken: "ya29.access",
    refreshToken: "1//refresh",
    expiresAt: new Date(nowMs + 3_600_000).toISOString(),
    scopes,
    tokenType: "Bearer",
  };
  vault.storeTokens(accountId, tokens, scopes);
}

function makePublisher(): Publisher {
  return {
    platform: "youtube",
    limits: {
      maxDurationSec: 3600,
      maxTitleChars: 100,
      maxDescriptionChars: 5000,
      maxTags: 30,
      supportsScheduledPublishAt: true,
    },
    oauth: {
      buildAuthUrl: () => "https://example.com",
      exchangeCode: async () => ({ accessToken: "x", scopes: [], tokenType: "Bearer" }),
      refresh: async (tokens) => tokens,
      fetchIdentity: async () => ({ displayName: "x", externalId: "ch" }),
    },
    upload: async () => ({ externalId: "v", externalUrl: "https://example.com/v" }),
  };
}

function createFinance(fetchImpl?: typeof fetch, notifications?: NotificationService): FinanceService {
  const registry = new PublisherRegistry();
  registry.register(makePublisher());
  return new FinanceService({
    sqlite,
    vault,
    registry,
    usage: new UsageService(sqlite, 25_000),
    config,
    logger: silentLogger(),
    notifications,
    fetchImpl,
    now,
  });
}

describe("CSV import", () => {
  it("previews a valid file and rejects the whole file on one bad row", () => {
    const ok = previewRevenueCsv({
      csv: "period_start,period_end,amount,currency,kind,note\n2026-10-01,2026-10-31,1000,VND,ads,ok\n2026-10-01,2026-10-31,2000,USD,gift,ok2",
      mapping: {
        periodStart: "period_start",
        periodEnd: "period_end",
        amount: "amount",
        currency: "currency",
        kind: "kind",
        note: "note",
      },
    });
    expect(ok.errors).toEqual([]);
    expect(ok.rows).toHaveLength(2);

    const bad = previewRevenueCsv({
      csv: "period_start,amount\n2026-10-01,100\nbad-date,xyz",
      mapping: { periodStart: "period_start", amount: "amount" },
      defaults: { currency: "VND", kind: "other" },
    });
    expect(bad.rows).toEqual([]);
    expect(bad.errors.some((e) => e.rowNumber === 3)).toBe(true);

    const finance = createFinance();
    expect(() => finance.commitCsv({
      csv: "period_start,amount\n2026-10-01,100\nbad,nope",
      mapping: { periodStart: "period_start", amount: "amount" },
      defaults: { currency: "VND", kind: "ads" },
    })).toThrow(/dòng/i);
  });

  it("commits a valid CSV", () => {
    const finance = createFinance();
    const result = finance.commitCsv({
      csv: "period_start,period_end,amount,currency,kind\n2026-10-01,2026-10-31,500000,VND,sponsorship",
      mapping: {
        periodStart: "period_start",
        periodEnd: "period_end",
        amount: "amount",
        currency: "currency",
        kind: "kind",
      },
    });
    expect(result.inserted).toBe(1);
    expect(finance.listRevenue({ from: "2026-10-01", to: "2026-10-31" })).toHaveLength(1);
  });
});

describe("YouTube revenue upsert", () => {
  it("upserts idempotently over overlapping windows", () => {
    const profileId = seedProfile();
    const accountId = seedAccount(profileId);
    const first = upsertYoutubeRevenueEntries(sqlite, {
      accountId,
      profileId,
      channelId: "ch1",
      dayRows: [
        { date: "2026-10-01", estimatedRevenue: 1.5, estimatedAdRevenue: 1.5, estimatedRedPartnerRevenue: 0 },
        { date: "2026-10-02", estimatedRevenue: 3, estimatedAdRevenue: 3, estimatedRedPartnerRevenue: 0 },
      ],
      videoRows: [{ videoId: "vid1", date: "2026-10-01", estimatedRevenue: 0.5 }],
      publicationByExternalId: new Map(),
      nowIso: now().toISOString(),
    });
    // Video day wins for 10-01; channel day kept for 10-02 only.
    expect(first.inserted).toBe(2);

    const second = upsertYoutubeRevenueEntries(sqlite, {
      accountId,
      profileId,
      channelId: "ch1",
      dayRows: [
        { date: "2026-10-01", estimatedRevenue: 2, estimatedAdRevenue: 2, estimatedRedPartnerRevenue: 0 },
        { date: "2026-10-02", estimatedRevenue: 4, estimatedAdRevenue: 4, estimatedRedPartnerRevenue: 0 },
      ],
      videoRows: [{ videoId: "vid1", date: "2026-10-01", estimatedRevenue: 0.8 }],
      publicationByExternalId: new Map(),
      nowIso: now().toISOString(),
    });
    expect(second.inserted).toBe(0);
    expect(second.updated).toBe(2);

    const rows = sqlite.prepare(
      "SELECT amount, external_key FROM revenue_entries WHERE source = 'youtube_api' ORDER BY external_key",
    ).all() as Array<{ amount: number; external_key: string }>;
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.external_key === "vid1:2026-10-01")!.amount).toBe(0.8);
    expect(rows.find((r) => r.external_key === "ch1:2026-10-02")!.amount).toBe(4);
  });

  it("marks non-partner channels as not_monetized and skips retry spam", async () => {
    const profileId = seedProfile();
    const accountId = seedAccount(profileId);
    storeTokens(accountId, [YOUTUBE_ANALYTICS_MONETARY_READONLY_SCOPE]);
    sqlite.prepare(
      "UPDATE platform_accounts SET revenue_sync_enabled = 1, revenue_status = 'ok' WHERE id = ?",
    ).run(accountId);

    const fetchImpl = vi.fn(async () => jsonResponse({ error: { message: "Monetization not enabled" } }, 403));
    const finance = createFinance(fetchImpl as unknown as typeof fetch);

    const first = await finance.syncYoutubeRevenue(accountId);
    expect(first.skipped).toBe(true);
    expect(first.reason).toMatch(/kiếm tiền/i);

    const status = finance.listYoutubeRevenueAccounts().find((a) => a.accountId === accountId)!;
    expect(status.revenueStatus).toBe("not_monetized");

    const second = await finance.syncYoutubeRevenue(accountId);
    expect(second.skipped).toBe(true);
    expect(second.reason).toMatch(/kiếm tiền/i);
    // No further API calls once marked not_monetized.
    expect(fetchImpl).toHaveBeenCalledTimes(2); // channel + video on first attempt only
  });
});

describe("monthly report + payout", () => {
  it("generates once and regenerate replaces", async () => {
    const finance = createFinance();
    finance.createRevenue({
      kind: "ads",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-31",
      amount: 1_000_000,
      currency: "VND",
    });
    const first = await finance.generateMonthlyReport("2026-10", { force: false });
    expect(first.month).toBe("2026-10");
    expect(first.report.profit).toBeGreaterThan(0);
    const createdAt = first.createdAt;

    nowMs += 60_000;
    const again = await finance.generateMonthlyReport("2026-10", { force: false });
    expect(again.createdAt).toBe(createdAt);

    const regen = await finance.generateMonthlyReport("2026-10", { force: true });
    expect(regen.createdAt).not.toBe(createdAt);
  });

  it("sends payout reminder at threshold with 7-day dedup", async () => {
    const profileId = seedProfile();
    const accountId = seedAccount(profileId);
    vault.storeSecret(TELEGRAM_BOT_TOKEN_KEY, "123:token");
    saveNotificationSettings(sqlite, {
      telegram: { enabled: true, chatId: "99", botUsername: "bot" },
      events: { attention: true, published: true, waitingApproval: true, dailySummary: true },
      dailySummaryTime: "21:00",
      timezone: "Asia/Ho_Chi_Minh",
      quietHours: null,
    });

    const telegramCalls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("api.telegram.org")) {
        telegramCalls.push(url);
        return jsonResponse({ ok: true, result: {} });
      }
      return jsonResponse({});
    });

    const notifications = new NotificationService({
      sqlite,
      vault,
      config,
      logger: silentLogger(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now,
    });
    const finance = createFinance(undefined, notifications);
    finance.upsertPayoutThreshold(accountId, {
      thresholdAmount: 100,
      currency: "VND",
      currentBalance: 150,
    });

    await finance.checkPayoutReminders();
    await new Promise((r) => setTimeout(r, 40));
    expect(telegramCalls.length).toBeGreaterThanOrEqual(1);

    const afterFirst = finance.listPayoutThresholds().find((t) => t.accountId === accountId)!;
    expect(afterFirst.lastNotifiedAt).toBeTruthy();

    telegramCalls.length = 0;
    nowMs += 2 * 24 * 60 * 60 * 1000;
    await finance.checkPayoutReminders();
    await new Promise((r) => setTimeout(r, 40));
    expect(telegramCalls.length).toBe(0);

    nowMs += 6 * 24 * 60 * 60 * 1000;
    await finance.checkPayoutReminders();
    await new Promise((r) => setTimeout(r, 40));
    expect(telegramCalls.length).toBeGreaterThanOrEqual(1);
  });
});

describe("finance summary", () => {
  it("includes manual revenue and costs in KPI", () => {
    const profileId = seedProfile();
    const finance = createFinance();
    finance.createRevenue({
      kind: "ads",
      periodStart: "2026-11-01",
      periodEnd: "2026-11-05",
      amount: 200_000,
      currency: "VND",
      profileId,
    });
    finance.createCost({
      kind: "tool_subscription",
      date: "2026-11-02",
      amount: 50_000,
      currency: "VND",
      profileId,
    });
    const summary = finance.getSummary({ from: "2026-11-01", to: "2026-11-05", profileId });
    expect(summary.kpi.revenue).toBe(200_000);
    expect(summary.kpi.cost).toBe(50_000);
    expect(summary.kpi.profit).toBe(150_000);
  });
});
