import type Database from "better-sqlite3";
import {
  DEFAULT_WEB_IMAGE_DOMAIN_DENYLIST,
  DEFAULT_WEB_IMAGE_GEMINI_MODEL,
  JobUsageSchema,
  WebImageSettingsSchema,
  WebImageSettingsStatusSchema,
  type WebImageSettings,
  type WebImageSettingsStatus,
} from "@vg/shared";
import type { AppConfig } from "../lib/config.js";
import { parseDomainDenylist } from "../providers/images/webCrawl.js";

const SETTINGS_KEY = "webImageSearch";

export function defaultWebImageSettings(config?: AppConfig): WebImageSettings {
  const denylist = config
    ? parseDomainDenylist(config.WEB_IMAGE_DOMAIN_DENYLIST)
    : [...DEFAULT_WEB_IMAGE_DOMAIN_DENYLIST];
  return WebImageSettingsSchema.parse({
    braveEnabled: true,
    geminiGroundingEnabled: true,
    geminiModel: config?.WEB_IMAGE_GEMINI_MODEL || DEFAULT_WEB_IMAGE_GEMINI_MODEL,
    domainDenylist: denylist.length > 0 ? denylist : [...DEFAULT_WEB_IMAGE_DOMAIN_DENYLIST],
  });
}

export function getWebImageSettings(sqlite: Database.Database, config?: AppConfig): WebImageSettings {
  const row = sqlite.prepare("SELECT value FROM app_settings WHERE key = ?").get(SETTINGS_KEY) as { value: string } | undefined;
  if (!row) return defaultWebImageSettings(config);
  const value = typeof row.value === "string" ? JSON.parse(row.value) as unknown : row.value;
  return WebImageSettingsSchema.parse(value);
}

export function saveWebImageSettings(
  sqlite: Database.Database,
  settings: WebImageSettings,
): WebImageSettings {
  const parsed = WebImageSettingsSchema.parse(settings);
  sqlite.prepare(
    "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  ).run(SETTINGS_KEY, JSON.stringify(parsed), new Date().toISOString());
  return parsed;
}

/** Sum features.braveImageSearchRequests from jobs in the current calendar month. */
export function countBraveRequestsThisMonth(sqlite: Database.Database, now = new Date()): number {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
  let rows: Array<{ usage: string }> = [];
  try {
    rows = sqlite.prepare(
      "SELECT usage FROM jobs WHERE created_at >= ? AND created_at < ? AND usage IS NOT NULL",
    ).all(monthStart, nextMonth) as Array<{ usage: string }>;
  } catch {
    return 0;
  }
  let total = 0;
  for (const row of rows) {
    try {
      const raw = typeof row.usage === "string" ? JSON.parse(row.usage) as unknown : row.usage;
      const usage = JobUsageSchema.safeParse(raw);
      if (!usage.success) continue;
      total += usage.data.features?.braveImageSearchRequests ?? 0;
    } catch {
      // skip corrupt rows
    }
  }
  return total;
}

export function getWebImageSettingsStatus(
  sqlite: Database.Database,
  config: AppConfig,
  now = new Date(),
): WebImageSettingsStatus {
  const settings = getWebImageSettings(sqlite, config);
  return WebImageSettingsStatusSchema.parse({
    ...settings,
    keyConfigured: {
      brave: Boolean(config.BRAVE_SEARCH_API_KEY?.trim()),
      gemini: Boolean(config.GEMINI_API_KEY?.trim()),
    },
    braveRequestsThisMonth: countBraveRequestsThisMonth(sqlite, now),
  });
}
