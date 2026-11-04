import type Database from "better-sqlite3";
import { AutomationPausedSchema, type AutomationPaused } from "@vg/shared";

const SETTINGS_KEY = "automationPaused";

type PausedNotify = () => void;

let pausedNotify: PausedNotify | null = null;

export function setAutomationPausedNotify(handler: PausedNotify | null): void {
  pausedNotify = handler;
}

export function getAutomationPaused(sqlite: Database.Database): boolean {
  const row = sqlite.prepare("SELECT value FROM app_settings WHERE key = ?").get(SETTINGS_KEY) as
    | { value: string }
    | undefined;
  if (!row) return false;
  const value = typeof row.value === "string" ? JSON.parse(row.value) as unknown : row.value;
  return AutomationPausedSchema.parse(value).paused;
}

export function setAutomationPaused(sqlite: Database.Database, paused: boolean): AutomationPaused {
  const previous = getAutomationPaused(sqlite);
  const value = AutomationPausedSchema.parse({ paused });
  sqlite.prepare(
    "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  ).run(SETTINGS_KEY, JSON.stringify(value), new Date().toISOString());
  if (paused && !previous && pausedNotify) {
    try {
      pausedNotify();
    } catch {
      // never break settings for notifications
    }
  }
  return value;
}
