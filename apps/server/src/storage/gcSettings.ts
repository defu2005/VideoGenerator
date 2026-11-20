import type Database from "better-sqlite3";
import { z } from "zod";

const key = "storage_gc";
export const GcSettingsSchema = z.object({
  graceDays: z.number().int().min(7).max(60),
  postPublishDays: z.number().int().min(0).max(60),
}).strict();
export type GcSettings = z.infer<typeof GcSettingsSchema>;
export const DEFAULT_GC_SETTINGS: GcSettings = { graceDays: 14, postPublishDays: 7 };

export function getGcSettings(db: Database.Database): GcSettings {
  const row = db.prepare("SELECT value FROM app_settings WHERE key=?").get(key) as { value: string } | undefined;
  if (row) {
    try {
      const parsed = GcSettingsSchema.safeParse(JSON.parse(row.value));
      if (parsed.success) return parsed.data;
    } catch { /* Use the defaults when a stored setting is malformed. */ }
  }
  return { ...DEFAULT_GC_SETTINGS };
}

export function saveGcSettings(db: Database.Database, settings: GcSettings): GcSettings {
  const parsed = GcSettingsSchema.parse(settings);
  db.prepare(`INSERT INTO app_settings(key,value,updated_at) VALUES (?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
    .run(key, JSON.stringify(parsed), new Date().toISOString());
  return parsed;
}
