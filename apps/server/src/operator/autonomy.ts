import type Database from "better-sqlite3";
import {
  AUTONOMY_PRESETS, AutonomyOverrideSchema, AutonomySettingsSchema, defaultRepairSettings, intersectAutonomy,
  type AutonomySettings, type RepairSettings,
} from "@vg/shared";

function key(profileId?: string): string {
  return profileId ? `autonomy.profile.${profileId}` : "autonomy.app";
}

function read(sqlite: Database.Database, profileId?: string) {
  const row = sqlite.prepare("SELECT value FROM app_settings WHERE key = ?").get(key(profileId)) as { value: string } | undefined;
  if (!row) return undefined;
  try {
    return AutonomyOverrideSchema.parse(JSON.parse(row.value));
  } catch {
    return { level: "assist" as const, grants: AUTONOMY_PRESETS.assist };
  }
}

export function autonomySettings(sqlite: Database.Database, profileId?: string): AutonomySettings {
  const app = read(sqlite);
  const level = app?.level ?? "assist";
  const defaults = { level, grants: { ...AUTONOMY_PRESETS[level], ...app?.grants }, ...(app?.repair ? { repair: app.repair } : {}) };
  if (!profileId) return defaults;
  const profile = read(sqlite, profileId);
  if (!profile) return { level: "assist", grants: AUTONOMY_PRESETS.assist };
  const repair = profile.repair ?? app?.repair;
  return { level: profile.level ?? level, grants: { ...defaults.grants, ...profile.grants }, ...(repair ? { repair } : {}) };
}

/** Repair limits for one profile. Missing values fall back to the level's default. */
export function repairSettingsFor(sqlite: Database.Database, profileId?: string | null): RepairSettings {
  const settings = autonomySettings(sqlite, profileId ?? undefined);
  return settings.repair ?? defaultRepairSettings(settings.level);
}

export function saveAutonomySettings(sqlite: Database.Database, value: AutonomySettings, profileId?: string): void {
  const validated = AutonomySettingsSchema.parse(value);
  sqlite.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .run(key(profileId), JSON.stringify(validated), new Date().toISOString());
}

export function effectiveAutonomy(sqlite: Database.Database, args: unknown): AutonomySettings {
  const app = autonomySettings(sqlite);
  const input = args as {
    profileId?: string; projectId?: string; targetProfileId?: string; sourceProfileId?: string;
    body?: { accountIds?: string[] };
  };
  const ids = new Set([input.profileId, input.targetProfileId, input.sourceProfileId].filter((id): id is string => Boolean(id)));
  if (input.projectId) {
    const row = sqlite.prepare("SELECT profile_id FROM projects WHERE id = ?").get(input.projectId) as { profile_id: string | null } | undefined;
    if (row?.profile_id) ids.add(row.profile_id);
  }
  for (const accountId of input.body?.accountIds ?? []) {
    const row = sqlite.prepare("SELECT profile_id FROM platform_accounts WHERE id = ?").get(accountId) as { profile_id: string } | undefined;
    if (row) ids.add(row.profile_id);
  }
  return [...ids].reduce((current, id) => intersectAutonomy(current, autonomySettings(sqlite, id)), app);
}
