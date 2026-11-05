import type Database from "better-sqlite3";
import {
  TTS_CATALOG,
  TtsAppSettingsSchema,
  ttsPricePerMillion,
  type TtsAppSettings,
  type TtsProviderStatus,
} from "@vg/shared";

const SETTINGS_KEY = "tts";

export function ttsSecretKey(providerId: string): string {
  return `tts.${providerId}.apiKey`;
}

export function readTtsSettings(sqlite: Database.Database, envProvider: string): TtsAppSettings {
  const fallback = TtsAppSettingsSchema.parse({ defaultProvider: envProvider || "edge-tts" });
  const row = sqlite.prepare("SELECT value FROM app_settings WHERE key = ?").get(SETTINGS_KEY) as { value: string } | undefined;
  if (!row) return fallback;
  try {
    const raw = typeof row.value === "string" ? JSON.parse(row.value) as unknown : row.value;
    const parsed = TtsAppSettingsSchema.safeParse(raw);
    return parsed.success ? parsed.data : fallback;
  } catch {
    return fallback;
  }
}

export function saveTtsSettings(sqlite: Database.Database, envProvider: string, patch: Partial<TtsAppSettings>): TtsAppSettings {
  const next = TtsAppSettingsSchema.parse({ ...readTtsSettings(sqlite, envProvider), ...patch });
  sqlite.prepare(
    "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  ).run(SETTINGS_KEY, JSON.stringify(next), new Date().toISOString());
  return next;
}

export function describeTtsProviders(input: {
  settings: TtsAppSettings;
  configured: (id: string) => boolean;
  subscription?: TtsProviderStatus["subscription"];
}): TtsProviderStatus[] {
  return TTS_CATALOG.filter((entry) => entry.id !== "mock").map((entry) => ({
    id: entry.id,
    label: entry.label,
    kind: entry.kind,
    configured: input.configured(entry.id),
    paid: entry.paid,
    wordTimings: entry.wordTimings,
    pricePerMillion: ttsPricePerMillion(entry.id, input.settings.pricesPerMillion),
    languages: entry.languages,
    ...(entry.id === "gemini" ? { model: input.settings.geminiModel } : {}),
    ...(entry.id === "elevenlabs" ? { model: input.settings.elevenModel } : {}),
    ...(entry.id === "openai" ? { model: input.settings.openaiModel } : {}),
    ...(entry.id === "piper" ? { binaryPath: input.settings.piperBinary, modelsDir: input.settings.piperModelsDir } : {}),
    ...(entry.id === "vieneu" ? { commandTemplate: input.settings.vieneuTemplate } : {}),
    ...(entry.id === "elevenlabs" && input.subscription ? { subscription: input.subscription } : {}),
  }));
}
