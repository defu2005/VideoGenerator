import type Database from "better-sqlite3";
import { LlmSettingsSchema, type LlmSettings } from "@vg/shared";

const SETTINGS_KEY = "llmRouting";

export function getAppLlmSettings(sqlite: Database.Database): LlmSettings | undefined {
  const row = sqlite.prepare("SELECT value FROM app_settings WHERE key = ?").get(SETTINGS_KEY) as { value: string } | undefined;
  if (!row) return undefined;
  const value = typeof row.value === "string" ? JSON.parse(row.value) as unknown : row.value;
  return LlmSettingsSchema.parse(value);
}

export function saveAppLlmSettings(sqlite: Database.Database, settings: LlmSettings): void {
  sqlite.prepare(
    "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  ).run(SETTINGS_KEY, JSON.stringify(settings), new Date().toISOString());
}
