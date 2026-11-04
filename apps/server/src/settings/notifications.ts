import type Database from "better-sqlite3";
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  NotificationSettingsSchema,
  type NotificationSettings,
  type NotificationSettingsStatus,
} from "@vg/shared";
import type { TokenVault } from "../publishing/tokenVault.js";

export const TELEGRAM_BOT_TOKEN_KEY = "telegram.botToken";
const SETTINGS_KEY = "notifications";
const OFFSET_KEY = "telegram.updateOffset";
const PAIRING_KEY = "telegram.pairing";
const LAST_SUMMARY_KEY = "telegram.lastDailySummaryDate";
const QUIET_QUEUE_KEY = "notification.quietQueue";

export function getNotificationSettings(sqlite: Database.Database): NotificationSettings {
  const row = sqlite.prepare("SELECT value FROM app_settings WHERE key = ?").get(SETTINGS_KEY) as
    | { value: string }
    | undefined;
  if (!row) return { ...DEFAULT_NOTIFICATION_SETTINGS };
  const value = typeof row.value === "string" ? JSON.parse(row.value) as unknown : row.value;
  return NotificationSettingsSchema.parse(value);
}

export function saveNotificationSettings(
  sqlite: Database.Database,
  settings: NotificationSettings,
): NotificationSettings {
  const parsed = NotificationSettingsSchema.parse(settings);
  sqlite.prepare(
    "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  ).run(SETTINGS_KEY, JSON.stringify(parsed), new Date().toISOString());
  return parsed;
}

export function getNotificationSettingsStatus(
  sqlite: Database.Database,
  vault: TokenVault,
): NotificationSettingsStatus {
  const settings = getNotificationSettings(sqlite);
  return {
    ...settings,
    tokenConfigured: vault.hasSecret(TELEGRAM_BOT_TOKEN_KEY),
  };
}

export function getTelegramUpdateOffset(sqlite: Database.Database): number {
  const row = sqlite.prepare("SELECT value FROM app_settings WHERE key = ?").get(OFFSET_KEY) as
    | { value: string }
    | undefined;
  if (!row) return 0;
  const value = typeof row.value === "string" ? JSON.parse(row.value) as unknown : row.value;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function saveTelegramUpdateOffset(sqlite: Database.Database, offset: number): void {
  sqlite.prepare(
    "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  ).run(OFFSET_KEY, JSON.stringify(offset), new Date().toISOString());
}

export type PairingCodeState = {
  code: string;
  expiresAt: string;
};

export function getPairingCode(sqlite: Database.Database): PairingCodeState | null {
  const row = sqlite.prepare("SELECT value FROM app_settings WHERE key = ?").get(PAIRING_KEY) as
    | { value: string }
    | undefined;
  if (!row) return null;
  const value = typeof row.value === "string" ? JSON.parse(row.value) as PairingCodeState : row.value as PairingCodeState;
  if (!value?.code || !value?.expiresAt) return null;
  return value;
}

export function savePairingCode(sqlite: Database.Database, state: PairingCodeState): void {
  sqlite.prepare(
    "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  ).run(PAIRING_KEY, JSON.stringify(state), new Date().toISOString());
}

export function clearPairingCode(sqlite: Database.Database): void {
  sqlite.prepare("DELETE FROM app_settings WHERE key = ?").run(PAIRING_KEY);
}

export function getLastDailySummaryDate(sqlite: Database.Database): string | null {
  const row = sqlite.prepare("SELECT value FROM app_settings WHERE key = ?").get(LAST_SUMMARY_KEY) as
    | { value: string }
    | undefined;
  if (!row) return null;
  const value = typeof row.value === "string" ? JSON.parse(row.value) as unknown : row.value;
  return typeof value === "string" ? value : null;
}

export function saveLastDailySummaryDate(sqlite: Database.Database, dateKey: string): void {
  sqlite.prepare(
    "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  ).run(LAST_SUMMARY_KEY, JSON.stringify(dateKey), new Date().toISOString());
}

export function getQuietQueue(sqlite: Database.Database): unknown[] {
  const row = sqlite.prepare("SELECT value FROM app_settings WHERE key = ?").get(QUIET_QUEUE_KEY) as
    | { value: string }
    | undefined;
  if (!row) return [];
  const value = typeof row.value === "string" ? JSON.parse(row.value) as unknown : row.value;
  return Array.isArray(value) ? value : [];
}

export function saveQuietQueue(sqlite: Database.Database, events: unknown[]): void {
  sqlite.prepare(
    "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  ).run(QUIET_QUEUE_KEY, JSON.stringify(events), new Date().toISOString());
}
