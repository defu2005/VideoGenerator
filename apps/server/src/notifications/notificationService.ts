import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { FastifyBaseLogger } from "fastify";
import {
  NotificationEventSchema,
  notificationToggleForKind,
  subjectKeyForEvent,
  type NotificationEvent,
  type NotificationKind,
  type NotificationLogEntry,
  type NotificationLogStatus,
  type NotificationSettings,
} from "@vg/shared";
import type { TokenVault } from "../publishing/tokenVault.js";
import type { AppConfig } from "../lib/config.js";
import type { UsageService } from "../services/usageService.js";
import {
  getLastDailySummaryDate,
  getNotificationSettings,
  getQuietQueue,
  saveLastDailySummaryDate,
  saveQuietQueue,
  TELEGRAM_BOT_TOKEN_KEY,
} from "../settings/notifications.js";
import { escapeHtml, maskTelegramSecret, TelegramClient, type InlineButton } from "./telegram.js";
import { quotaDailySummaryLine } from "../providers/llm/quota.js";

const DEDUP_MS = 6 * 60 * 60 * 1000;
const RETENTION_DAYS = 30;
const MAX_SEND_ATTEMPTS = 3;
const TOKEN_EXPIRY_DAYS = 3;

export type NotificationServiceDeps = {
  sqlite: Database.Database;
  vault: TokenVault;
  config: AppConfig;
  logger: FastifyBaseLogger;
  usage?: UsageService;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  /** Optional: buttons for waiting_approval (e.g. Duyệt / Xem via assistant pending). */
  waitingApprovalButtons?: (event: Extract<NotificationEvent, { kind: "waiting_approval" }>) => InlineButton[][] | null;
};

export class NotificationService {
  private readonly now: () => Date;
  private readonly sleepFn: (ms: number) => Promise<void>;
  private readonly fetchImpl: typeof fetch;
  private lastTokenCheckAt = 0;
  private waitingApprovalButtons?: NotificationServiceDeps["waitingApprovalButtons"];

  constructor(private readonly deps: NotificationServiceDeps) {
    this.now = deps.now ?? (() => new Date());
    this.sleepFn = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.fetchImpl = deps.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
    this.waitingApprovalButtons = deps.waitingApprovalButtons;
  }

  setWaitingApprovalButtons(fn: NotificationServiceDeps["waitingApprovalButtons"]): void {
    this.waitingApprovalButtons = fn;
  }

  /** Never throws into the caller. */
  async notify(raw: NotificationEvent): Promise<void> {
    try {
      await this.notifyInner(raw);
    } catch (error) {
      const token = this.deps.vault.loadSecret(TELEGRAM_BOT_TOKEN_KEY);
      this.deps.logger.warn(
        { err: maskTelegramSecret(error instanceof Error ? error.message : String(error), token) },
        "Notification notify failed",
      );
    }
  }

  listLog(limit = 100): NotificationLogEntry[] {
    const rows = this.deps.sqlite.prepare(
      `SELECT id, at, kind, subject_key, channel, status, message, error
       FROM notification_log ORDER BY at DESC LIMIT ?`,
    ).all(limit) as Array<{
      id: string;
      at: string;
      kind: string;
      subject_key: string;
      channel: string;
      status: string;
      message: string;
      error: string | null;
    }>;
    return rows.map((row) => ({
      id: row.id,
      at: row.at,
      kind: row.kind as NotificationKind,
      subjectKey: row.subject_key,
      channel: row.channel,
      status: row.status as NotificationLogStatus,
      message: row.message,
      error: row.error,
    }));
  }

  async sendTest(): Promise<{ ok: boolean; error?: string }> {
    const settings = getNotificationSettings(this.deps.sqlite);
    const token = this.deps.vault.loadSecret(TELEGRAM_BOT_TOKEN_KEY);
    if (!token || !settings.telegram.chatId) {
      return { ok: false, error: "Chưa cấu hình token hoặc chưa ghép nối chat." };
    }
    try {
      const client = new TelegramClient(token, this.fetchImpl);
      await client.sendMessage(settings.telegram.chatId, "Video Agent: thông báo thử");
      this.insertLog({
        kind: "automation_warning",
        subjectKey: `test:${this.now().toISOString()}`,
        status: "sent",
        message: "Video Agent: thông báo thử",
        error: null,
      });
      return { ok: true };
    } catch (error) {
      const message = maskTelegramSecret(error instanceof Error ? error.message : String(error), token);
      return { ok: false, error: message };
    }
  }

  /** Flush quiet-hours queue and maybe send daily summary / token checks. */
  async tick(): Promise<void> {
    try {
      await this.flushQuietQueue();
      await this.maybeSendDailySummary();
      await this.maybeCheckTokens();
    } catch (error) {
      const token = this.deps.vault.loadSecret(TELEGRAM_BOT_TOKEN_KEY);
      this.deps.logger.warn(
        { err: maskTelegramSecret(error instanceof Error ? error.message : String(error), token) },
        "Notification tick failed",
      );
    }
  }

  webBaseUrl(): string {
    return this.deps.config.WEB_BASE_URL?.replace(/\/$/, "")
      || this.deps.config.CORS_ORIGIN?.replace(/\/$/, "")
      || "http://localhost:5180";
  }

  formatMessage(event: NotificationEvent): string {
    switch (event.kind) {
      case "publish_succeeded":
        return `✅ Đã đăng <b>${escapeHtml(event.title)}</b> lên ${escapeHtml(event.platform)} (${escapeHtml(event.account)} / ${escapeHtml(event.profile)})\n${escapeHtml(event.url)}`;
      case "publish_failed":
        return `❌ Đăng thất bại: <b>${escapeHtml(event.title)}</b> — ${escapeHtml(event.platform)} (${escapeHtml(event.account)})\n${escapeHtml(event.error)}`;
      case "render_failed":
        return `❌ Render thất bại: <b>${escapeHtml(event.project)}</b>\n${escapeHtml(event.error)}\n${escapeHtml(`${this.webBaseUrl()}/projects/${event.projectId}`)}`;
      case "stage_failed":
        return `❌ Stage <b>${escapeHtml(event.stage)}</b> thất bại: ${escapeHtml(event.project)}\n${escapeHtml(event.error)}\n${escapeHtml(`${this.webBaseUrl()}/projects/${event.projectId}`)}`;
      case "waiting_approval":
        if (event.unexpectedAutoStop) {
          return `⚠️ Dự án tự động bị dừng ở <b>${escapeHtml(event.gate)}</b>: ${escapeHtml(event.project)}\n${escapeHtml(event.link)}`;
        }
        return `⚠️ Chờ duyệt <b>${escapeHtml(event.gate)}</b>: ${escapeHtml(event.project)}\n${escapeHtml(event.link)}`;
      case "token_expiring":
        return `⚠️ Token sắp hết hạn: <b>${escapeHtml(event.account)}</b> (${escapeHtml(event.expiresAt)})`;
      case "account_error":
        return `❌ Lỗi tài khoản <b>${escapeHtml(event.account)}</b>\n${escapeHtml(event.error)}`;
      case "automation_warning":
        return `⚠️ Tự động hoá (${escapeHtml(event.profile)}): ${escapeHtml(event.message)}`;
      case "automation_paused":
        return `⏸ Tự động hoá đã tạm dừng (kill switch).`;
      case "daily_summary":
        return `📊 <b>Tóm tắt ngày ${escapeHtml(event.dateKey)}</b>\n${event.text}`;
      case "monthly_report":
        return `📈 <b>Báo cáo tháng ${escapeHtml(event.month)}</b>\n${event.text}`;
      case "comment_attention":
        return `💬 ${escapeHtml(event.profile)}: ${event.count} bình luận cần trả lời`;
    }
  }

  isInQuietHours(settings: NotificationSettings, at = this.now()): boolean {
    if (!settings.quietHours) return false;
    const minutes = localMinutes(at, settings.timezone);
    const from = parseHhMm(settings.quietHours.from);
    const to = parseHhMm(settings.quietHours.to);
    if (from === to) return false;
    if (from < to) return minutes >= from && minutes < to;
    return minutes >= from || minutes < to;
  }

  private async notifyInner(raw: NotificationEvent): Promise<void> {
    const event = NotificationEventSchema.parse(raw);
    const settings = getNotificationSettings(this.deps.sqlite);
    const unexpected = event.kind === "waiting_approval" && Boolean(event.unexpectedAutoStop);
    const toggle = notificationToggleForKind(event.kind, unexpected);
    if (!settings.events[toggle]) return;

    const subjectKey = subjectKeyForEvent(event);
    const message = this.formatMessage(event);
    this.pruneOld();

    if (this.wasSentRecently(subjectKey)) return;

    // Quiet hours: queue published + dailySummary (+ monthly_report); attention still goes through.
    if (
      this.isInQuietHours(settings)
      && (toggle === "published" || toggle === "dailySummary")
    ) {
      const queue = getQuietQueue(this.deps.sqlite);
      queue.push(event);
      saveQuietQueue(this.deps.sqlite, queue);
      this.insertLog({
        kind: event.kind,
        subjectKey,
        status: "skipped",
        message,
        error: "quiet_hours",
      });
      return;
    }

    const token = this.deps.vault.loadSecret(TELEGRAM_BOT_TOKEN_KEY);
    const chatId = settings.telegram.chatId;
    if (!settings.telegram.enabled || !token || !chatId) {
      this.insertLog({
        kind: event.kind,
        subjectKey,
        status: "skipped",
        message,
        error: !settings.telegram.enabled ? "disabled" : !token ? "no_token" : "unpaired",
      });
      return;
    }

    const client = new TelegramClient(token, this.fetchImpl);
    let buttons: InlineButton[][] | undefined;
    if (event.kind === "waiting_approval" && !event.unexpectedAutoStop && this.waitingApprovalButtons) {
      try {
        buttons = this.waitingApprovalButtons(event) ?? undefined;
      } catch (error) {
        this.deps.logger.debug(
          { err: error instanceof Error ? error.message : String(error) },
          "waiting_approval buttons skipped",
        );
      }
    }
    let lastError: string | null = null;
    for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt += 1) {
      try {
        await client.sendMessage(chatId, message, buttons?.length ? { buttons } : {});
        this.insertLog({
          kind: event.kind,
          subjectKey,
          status: "sent",
          message,
          error: null,
        });
        return;
      } catch (error) {
        lastError = maskTelegramSecret(error instanceof Error ? error.message : String(error), token);
        if (attempt < MAX_SEND_ATTEMPTS) {
          await this.sleepFn(250 * 2 ** (attempt - 1));
        }
      }
    }
    this.insertLog({
      kind: event.kind,
      subjectKey,
      status: "failed",
      message,
      error: lastError,
    });
  }

  private async flushQuietQueue(): Promise<void> {
    const settings = getNotificationSettings(this.deps.sqlite);
    if (this.isInQuietHours(settings)) return;
    const queue = getQuietQueue(this.deps.sqlite);
    if (queue.length === 0) return;
    saveQuietQueue(this.deps.sqlite, []);
    for (const item of queue) {
      const parsed = NotificationEventSchema.safeParse(item);
      if (!parsed.success) continue;
      // Bypass quiet check by calling notifyInner after clearing queue; quiet is off now.
      await this.notifyInner(parsed.data);
    }
  }

  async maybeSendDailySummary(): Promise<void> {
    const settings = getNotificationSettings(this.deps.sqlite);
    if (!settings.events.dailySummary) return;

    const dateKey = localDateKey(this.now(), settings.timezone);
    const last = getLastDailySummaryDate(this.deps.sqlite);
    if (last === dateKey) return;

    const minutes = localMinutes(this.now(), settings.timezone);
    const target = parseHhMm(settings.dailySummaryTime);
    if (minutes < target) return;

    if (this.isInQuietHours(settings)) return;

    const text = await this.buildDailySummaryText(dateKey, settings.timezone);
    await this.notify({
      kind: "daily_summary",
      dateKey,
      text,
    });
    // Mark sent even if skipped/failed so we don't spam retries every tick —
    // but only if a log row for today exists (sent or skipped).
    const existing = this.deps.sqlite.prepare(
      "SELECT 1 AS ok FROM notification_log WHERE subject_key = ? LIMIT 1",
    ).get(`daily_summary:${dateKey}`) as { ok: number } | undefined;
    if (existing) saveLastDailySummaryDate(this.deps.sqlite, dateKey);
  }

  private async buildDailySummaryText(dateKey: string, timezone: string): Promise<string> {
    const { startIso, endIso } = localDayBounds(dateKey, timezone);
    const lines: string[] = [];

    const published = this.deps.sqlite.prepare(
      `SELECT p.name AS profile, a.platform AS platform, COUNT(*) AS count
       FROM publications pub
       JOIN platform_accounts a ON a.id = pub.account_id
       JOIN profiles p ON p.id = a.profile_id
       WHERE pub.status = 'PUBLISHED' AND pub.published_at >= ? AND pub.published_at < ?
       GROUP BY p.name, a.platform
       ORDER BY p.name, a.platform`,
    ).all(startIso, endIso) as Array<{ profile: string; platform: string; count: number }>;

    const produced = this.deps.sqlite.prepare(
      `SELECT COALESCE(pr.name, '(không hồ sơ)') AS profile, COUNT(*) AS count
       FROM projects proj
       LEFT JOIN profiles pr ON pr.id = proj.profile_id
       WHERE proj.status = 'COMPLETED' AND proj.updated_at >= ? AND proj.updated_at < ?
       GROUP BY profile ORDER BY profile`,
    ).all(startIso, endIso) as Array<{ profile: string; count: number }>;

    const failures = this.deps.sqlite.prepare(
      `SELECT COUNT(*) AS count FROM publications
       WHERE status = 'FAILED' AND updated_at >= ? AND updated_at < ?`,
    ).get(startIso, endIso) as { count: number };

    lines.push("<b>Video sản xuất</b>");
    if (produced.length === 0) lines.push("— không có");
    else for (const row of produced) lines.push(`• ${escapeHtml(row.profile)}: ${row.count}`);

    lines.push("<b>Đã đăng</b>");
    if (published.length === 0) lines.push("— không có");
    else for (const row of published) {
      lines.push(`• ${escapeHtml(row.profile)} / ${escapeHtml(row.platform)}: ${row.count}`);
    }

    lines.push(`<b>Thất bại đăng</b>: ${failures.count}`);

    let costUsd = 0;
    if (this.deps.usage) {
      try {
        const usage = this.deps.usage.getAppUsage({ from: dateKey, to: dateKey, groupBy: "day" });
        costUsd = usage.totals.costUsd;
      } catch {
        // ignore
      }
    }
    lines.push(`<b>Chi phí LLM hôm nay</b>: $${costUsd.toFixed(4)}`);
    const quotaLine = quotaDailySummaryLine(this.deps.sqlite, this.now());
    if (quotaLine) lines.push(quotaLine);

    const nextDay = new Date(this.now().getTime() + 24 * 60 * 60 * 1000).toISOString();
    const scheduled = this.deps.sqlite.prepare(
      `SELECT COUNT(*) AS count FROM publications
       WHERE status = 'SCHEDULED' AND scheduled_for IS NOT NULL
         AND scheduled_for >= ? AND scheduled_for < ?`,
    ).get(this.now().toISOString(), nextDay) as { count: number };
    lines.push(`<b>Lịch đăng 24h tới</b>: ${scheduled.count}`);

    const topics = this.deps.sqlite.prepare(
      `SELECT p.name AS profile, COUNT(*) AS count
       FROM profile_topics t
       JOIN profiles p ON p.id = t.profile_id
       WHERE t.status IN ('PENDING', 'APPROVED')
       GROUP BY p.name ORDER BY p.name`,
    ).all() as Array<{ profile: string; count: number }>;
    lines.push("<b>Chủ đề còn trong hàng đợi</b>");
    if (topics.length === 0) lines.push("— trống");
    else for (const row of topics) lines.push(`• ${escapeHtml(row.profile)}: ${row.count}`);

    return lines.join("\n");
  }

  private async maybeCheckTokens(): Promise<void> {
    const nowMs = this.now().getTime();
    if (nowMs - this.lastTokenCheckAt < 60 * 60 * 1000) return;
    this.lastTokenCheckAt = nowMs;

    const accounts = this.deps.sqlite.prepare(
      `SELECT a.id, a.display_name, a.handle, a.connection, a.connection_error, c.expires_at
       FROM platform_accounts a
       LEFT JOIN platform_credentials c ON c.account_id = a.id
       WHERE a.connection IN ('CONNECTED', 'EXPIRED', 'ERROR')`,
    ).all() as Array<{
      id: string;
      display_name: string;
      handle: string | null;
      connection: string;
      connection_error: string | null;
      expires_at: string | null;
    }>;

    const horizon = nowMs + TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
    for (const account of accounts) {
      const label = account.display_name || account.handle || account.id;
      if (account.connection === "ERROR" || account.connection === "EXPIRED") {
        await this.notify({
          kind: "account_error",
          accountId: account.id,
          account: label,
          error: account.connection_error ?? account.connection,
        });
        continue;
      }
      if (!account.expires_at) continue;
      const expiresMs = Date.parse(account.expires_at);
      if (Number.isNaN(expiresMs) || expiresMs > horizon) continue;

      const tokens = this.deps.vault.loadTokens(account.id);
      const refreshable = Boolean(tokens?.refreshToken);
      if (refreshable) continue;

      await this.notify({
        kind: "token_expiring",
        accountId: account.id,
        account: label,
        expiresAt: account.expires_at,
      });
    }
  }

  private wasSentRecently(subjectKey: string): boolean {
    const cutoff = new Date(this.now().getTime() - DEDUP_MS).toISOString();
    const row = this.deps.sqlite.prepare(
      `SELECT 1 AS ok FROM notification_log
       WHERE subject_key = ? AND status = 'sent' AND at >= ?
       LIMIT 1`,
    ).get(subjectKey, cutoff) as { ok: number } | undefined;
    return Boolean(row);
  }

  private insertLog(input: {
    kind: NotificationKind;
    subjectKey: string;
    status: NotificationLogStatus;
    message: string;
    error: string | null;
  }): void {
    this.deps.sqlite.prepare(
      `INSERT INTO notification_log (id, at, kind, subject_key, channel, status, message, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      this.now().toISOString(),
      input.kind,
      input.subjectKey,
      "telegram",
      input.status,
      input.message,
      input.error,
    );
  }

  private pruneOld(): void {
    const cutoff = new Date(this.now().getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    this.deps.sqlite.prepare("DELETE FROM notification_log WHERE at < ?").run(cutoff);
  }
}

function parseHhMm(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function localMinutes(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

function localDateKey(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}

function localDayBounds(dateKey: string, timezone: string): { startIso: string; endIso: string } {
  // Approximate: interpret dateKey midnight in timezone via iterative offset guess.
  const start = zonedMidnightUtc(dateKey, timezone);
  const next = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  // Correct next day if DST shifted the local date.
  const nextKey = localDateKey(next, timezone);
  let end = next;
  if (nextKey === dateKey) end = new Date(next.getTime() + 60 * 60 * 1000);
  else if (nextKey !== addCalendarDay(dateKey)) {
    // walk until date changes
    end = next;
    while (localDateKey(end, timezone) === dateKey) {
      end = new Date(end.getTime() + 15 * 60 * 1000);
    }
  }
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

function addCalendarDay(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + 1));
  return dt.toISOString().slice(0, 10);
}

function zonedMidnightUtc(dateKey: string, timezone: string): Date {
  // Binary-search a UTC instant whose local date is dateKey and local time ~00:00.
  let lo = Date.parse(`${dateKey}T00:00:00.000Z`) - 14 * 60 * 60 * 1000;
  let hi = Date.parse(`${dateKey}T00:00:00.000Z`) + 14 * 60 * 60 * 1000;
  for (let i = 0; i < 40; i += 1) {
    const mid = Math.floor((lo + hi) / 2);
    const key = localDateKey(new Date(mid), timezone);
    const mins = localMinutes(new Date(mid), timezone);
    if (key < dateKey || (key === dateKey && mins > 0)) hi = mid;
    else if (key > dateKey) lo = mid;
    else if (mins === 0) return new Date(mid);
    else hi = mid;
  }
  return new Date(lo);
}

/** Safe wrapper used at hook points. */
export function safeNotify(
  service: NotificationService | null | undefined,
  event: NotificationEvent,
): void {
  if (!service) return;
  void service.notify(event);
}
