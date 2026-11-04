import type Database from "better-sqlite3";
import {
  defaultImageSourcesEnabled,
  IMAGE_SOURCE_KEY_REQUIRED,
  IMAGE_SOURCE_LABELS,
  ImageSourcesSettingsSchema,
  ImageSourcesSettingsStatusSchema,
  STOCK_IMAGE_PROVIDERS,
  type ImageSourcesSettings,
  type ImageSourcesSettingsStatus,
  type StockImageProvider,
} from "@vg/shared";
import type { AppConfig } from "../lib/config.js";

const SETTINGS_KEY = "imageSources";

function perMinute(config: AppConfig, id: StockImageProvider): number {
  const map: Record<StockImageProvider, number> = {
    wikimedia: config.IMAGE_SEARCH_PER_MINUTE_WIKIMEDIA,
    openverse: config.IMAGE_SEARCH_PER_MINUTE_OPENVERSE,
    pexels: config.IMAGE_SEARCH_PER_MINUTE_PEXELS,
    pixabay: config.IMAGE_SEARCH_PER_MINUTE_PIXABAY,
    unsplash: config.IMAGE_SEARCH_PER_MINUTE_UNSPLASH,
    nasa: config.IMAGE_SEARCH_PER_MINUTE_NASA,
    met: config.IMAGE_SEARCH_PER_MINUTE_MET,
    loc: config.IMAGE_SEARCH_PER_MINUTE_LOC,
    smithsonian: config.IMAGE_SEARCH_PER_MINUTE_SMITHSONIAN,
    europeana: config.IMAGE_SEARCH_PER_MINUTE_EUROPEANA,
    flickr: config.IMAGE_SEARCH_PER_MINUTE_FLICKR,
  };
  return map[id];
}

function keyConfigured(config: AppConfig, id: StockImageProvider): boolean {
  switch (id) {
    case "pexels": return Boolean(config.PEXELS_API_KEY?.trim());
    case "pixabay": return Boolean(config.PIXABAY_API_KEY?.trim());
    case "unsplash": return Boolean(config.UNSPLASH_ACCESS_KEY?.trim());
    case "smithsonian": return Boolean(config.SMITHSONIAN_API_KEY?.trim());
    case "europeana": return Boolean(config.EUROPEANA_API_KEY?.trim());
    case "flickr": return Boolean(config.FLICKR_API_KEY?.trim());
    default: return true;
  }
}

export function defaultImageSourcesSettings(): ImageSourcesSettings {
  return ImageSourcesSettingsSchema.parse({ enabled: defaultImageSourcesEnabled() });
}

export function getImageSourcesSettings(sqlite: Database.Database): ImageSourcesSettings {
  const row = sqlite.prepare("SELECT value FROM app_settings WHERE key = ?").get(SETTINGS_KEY) as { value: string } | undefined;
  if (!row) return defaultImageSourcesSettings();
  const value = typeof row.value === "string" ? JSON.parse(row.value) as unknown : row.value;
  const parsed = ImageSourcesSettingsSchema.safeParse(value);
  if (!parsed.success) return defaultImageSourcesSettings();
  return ImageSourcesSettingsSchema.parse({
    enabled: { ...defaultImageSourcesEnabled(), ...parsed.data.enabled },
  });
}

export function saveImageSourcesSettings(
  sqlite: Database.Database,
  settings: ImageSourcesSettings,
): ImageSourcesSettings {
  const parsed = ImageSourcesSettingsSchema.parse(settings);
  sqlite.prepare(
    "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  ).run(SETTINGS_KEY, JSON.stringify(parsed), new Date().toISOString());
  return parsed;
}

export function getImageSourcesSettingsStatus(
  sqlite: Database.Database,
  config: AppConfig,
): ImageSourcesSettingsStatus {
  const settings = getImageSourcesSettings(sqlite);
  return ImageSourcesSettingsStatusSchema.parse({
    enabled: settings.enabled,
    sources: STOCK_IMAGE_PROVIDERS.map((id) => ({
      id,
      label: IMAGE_SOURCE_LABELS[id],
      enabled: settings.enabled[id] !== false,
      keyRequired: IMAGE_SOURCE_KEY_REQUIRED[id],
      keyConfigured: keyConfigured(config, id),
      requestsPerMinute: perMinute(config, id),
    })),
  });
}

/** Providers that are toggled on in settings (key presence is handled by registry.enabled). */
export function isImageSourceEnabledInSettings(
  sqlite: Database.Database,
  providerId: string,
): boolean {
  if (!STOCK_IMAGE_PROVIDERS.includes(providerId as StockImageProvider)) return true;
  const settings = getImageSourcesSettings(sqlite);
  return settings.enabled[providerId as StockImageProvider] !== false;
}
