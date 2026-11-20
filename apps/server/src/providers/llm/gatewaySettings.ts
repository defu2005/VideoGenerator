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

/**
 * TASK-136: a NEW install with an OmniRoute key and a working catalog starts in mode `only`. "New" means no saved
 * gateway row and no project yet. The choice is saved once, so it never flips later and an existing install keeps `off`.
 * Returns true when it saved the default.
 */
export function applyNewInstallGatewayDefault(sqlite: Database.Database, input: { hasKey: boolean; modelCount: number }): boolean {
  if (!input.hasKey || input.modelCount < 1) return false;
  if (sqlite.prepare("SELECT 1 AS x FROM app_settings WHERE key = ?").get(SETTINGS_KEY)) return false;
  const projects = sqlite.prepare("SELECT COUNT(*) AS n FROM projects").get() as { n: number };
  if (projects.n > 0) return false;
  saveLlmGatewaySettings(sqlite, { ...defaultLlmGatewaySettings(), mode: "only" });
  return true;
}

export function saveLlmGatewaySettings(sqlite: Database.Database, settings: LlmGatewaySettings): LlmGatewaySettings {
  const parsed = LlmGatewaySettingsSchema.parse(settings);
  sqlite.prepare(
    "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  ).run(SETTINGS_KEY, JSON.stringify(parsed), new Date().toISOString());
  return parsed;
}
