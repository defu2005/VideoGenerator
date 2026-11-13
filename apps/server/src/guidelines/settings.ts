import {
  GuidelineProfilesSchema,
  GuidelineSettingsSchema,
  SaveGuidelinePacksInputSchema,
  type GuidelinePack,
  type GuidelineProfiles,
  type GuidelineSettings,
  type GuidelineSettingsInput,
} from "@vg/shared";
import type Database from "better-sqlite3";

const PACKS_KEY = "guidelinePacks";
const PROFILES_KEY = "guidelineProfiles";

function readJson(sqlite: Database.Database, key: string): unknown {
  const row = sqlite.prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as { value: string } | undefined;
  if (!row) return undefined;
  return typeof row.value === "string" ? JSON.parse(row.value) as unknown : row.value;
}

function writeJson(sqlite: Database.Database, key: string, value: unknown): void {
  sqlite.prepare(
    "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  ).run(key, JSON.stringify(value), new Date().toISOString());
}

export function getGuidelinePacks(sqlite: Database.Database): GuidelinePack[] {
  const value = readJson(sqlite, PACKS_KEY);
  if (value === undefined) return [];
  return SaveGuidelinePacksInputSchema.parse(value).packs;
}

export function saveGuidelinePacks(sqlite: Database.Database, packs: GuidelinePack[]): void {
  const parsed = SaveGuidelinePacksInputSchema.parse({ packs });
  writeJson(sqlite, PACKS_KEY, parsed);
}

export function getGuidelineProfiles(sqlite: Database.Database): GuidelineProfiles {
  const value = readJson(sqlite, PROFILES_KEY);
  if (value === undefined) return { profiles: [], defaultProfileId: null };
  return GuidelineProfilesSchema.parse(value);
}

export function saveGuidelineProfiles(sqlite: Database.Database, profiles: GuidelineProfiles): void {
  writeJson(sqlite, PROFILES_KEY, GuidelineProfilesSchema.parse(profiles));
}

/** Merges a partial guidelines update onto the stored settings. Null clears an optional choice. */
export function normalizeGuidelineSettings(input: GuidelineSettingsInput, base?: GuidelineSettings): GuidelineSettings {
  const platformPack = input.platformPack === undefined ? base?.platformPack ?? "auto" : input.platformPack;
  const customRules = input.customRules ?? base?.customRules ?? [];
  const channelPacks = input.channelPacks === undefined
    ? base?.channelPacks
    : input.channelPacks === null ? undefined : input.channelPacks;
  const strictness = input.strictness === undefined
    ? base?.strictness
    : input.strictness === null ? undefined : input.strictness;
  return GuidelineSettingsSchema.parse({
    ...(input.originality ?? base?.originality ? { originality: input.originality ?? base?.originality } : {}),
    platformPack,
    customRules,
    ...(channelPacks !== undefined ? { channelPacks } : {}),
    ...(strictness !== undefined ? { strictness } : {}),
  });
}
