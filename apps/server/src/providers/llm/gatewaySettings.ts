import type Database from "better-sqlite3";
import { LlmGatewaySettingsSchema, type LlmGatewaySettings } from "@vg/shared";

const SETTINGS_KEY = "llmGateway";

export function defaultLlmGatewaySettings(): LlmGatewaySettings {
  return LlmGatewaySettingsSchema.parse({});
}

export function getLlmGatewaySettings(sqlite: Database.Database): LlmGatewaySettings {
  const row = sqlite.prepare("SELECT value FROM app_settings WHERE key = ?").get(SETTINGS_KEY) as { value: string } | undefined;
  if (!row) return defaultLlmGatewaySettings();
  const value = typeof row.value === "string" ? JSON.parse(row.value) as unknown : row.value;
  return LlmGatewaySettingsSchema.parse(value);
}

export function saveLlmGatewaySettings(sqlite: Database.Database, settings: LlmGatewaySettings): LlmGatewaySettings {
  const parsed = LlmGatewaySettingsSchema.parse(settings);
  sqlite.prepare(
    "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  ).run(SETTINGS_KEY, JSON.stringify(parsed), new Date().toISOString());
  return parsed;
}
