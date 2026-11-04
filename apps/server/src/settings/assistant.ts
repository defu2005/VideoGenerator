import type Database from "better-sqlite3";
import {
  AssistantSettingsSchema,
  DEFAULT_ASSISTANT_SETTINGS,
  type AssistantSettings,
} from "@vg/shared";

const SETTINGS_KEY = "assistant";

export function getAssistantSettings(sqlite: Database.Database): AssistantSettings {
  const row = sqlite.prepare("SELECT value FROM app_settings WHERE key = ?").get(SETTINGS_KEY) as
    | { value: string }
    | undefined;
  if (!row) return { ...DEFAULT_ASSISTANT_SETTINGS };
  const value = typeof row.value === "string" ? JSON.parse(row.value) as unknown : row.value;
  return AssistantSettingsSchema.parse(value);
}

export function saveAssistantSettings(
  sqlite: Database.Database,
  settings: AssistantSettings,
): AssistantSettings {
  const parsed = AssistantSettingsSchema.parse(settings);
  sqlite.prepare(
    "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  ).run(SETTINGS_KEY, JSON.stringify(parsed), new Date().toISOString());
  return parsed;
}
