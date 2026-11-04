import type Database from "better-sqlite3";
import { DEFAULT_RENDER_KEEP_VERSIONS, RenderSettingsSchema, type RenderSettings } from "@vg/shared";

const SETTINGS_KEY = "renderKeepVersions";

export function getRenderSettings(sqlite: Database.Database): RenderSettings {
  const row = sqlite.prepare("SELECT value FROM app_settings WHERE key = ?").get(SETTINGS_KEY) as { value: string } | undefined;
  if (!row) return RenderSettingsSchema.parse({ keepVersions: DEFAULT_RENDER_KEEP_VERSIONS });
  const value = typeof row.value === "string" ? JSON.parse(row.value) as unknown : row.value;
  if (typeof value === "number") return RenderSettingsSchema.parse({ keepVersions: value });
  return RenderSettingsSchema.parse(value);
}

export function saveRenderSettings(sqlite: Database.Database, settings: RenderSettings): RenderSettings {
  const parsed = RenderSettingsSchema.parse(settings);
  sqlite.prepare(
    "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  ).run(SETTINGS_KEY, JSON.stringify(parsed), new Date().toISOString());
  return parsed;
}
