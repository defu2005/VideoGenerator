import type Database from "better-sqlite3";
import {
  DEFAULT_OPERATOR_SETTINGS,
  OperatorSettingsSchema,
  OperatorSettingsUpdateSchema,
  type OperatorSettings,
  type OperatorSettingsUpdate,
} from "@vg/shared";

const SETTINGS_KEY = "operator";

export function getOperatorSettings(sqlite: Database.Database): OperatorSettings {
  const row = sqlite.prepare("SELECT value FROM app_settings WHERE key = ?").get(SETTINGS_KEY) as
    | { value: string }
    | undefined;
  if (!row) return OperatorSettingsSchema.parse({});
  const value = typeof row.value === "string" ? JSON.parse(row.value) as unknown : row.value;
  return OperatorSettingsSchema.parse({ ...DEFAULT_OPERATOR_SETTINGS, ...(value as object) });
}

export function saveOperatorSettings(
  sqlite: Database.Database,
  update: OperatorSettingsUpdate,
): OperatorSettings {
  const parsedUpdate = OperatorSettingsUpdateSchema.parse(update);
  const current = getOperatorSettings(sqlite);
  const next: OperatorSettings = {
    ...current,
    ...parsedUpdate,
    modelByKind: {
      ...current.modelByKind,
      ...(parsedUpdate.modelByKind ?? {}),
    },
    runtimeByChannel: { ...current.runtimeByChannel, ...parsedUpdate.runtimeByChannel },
    telegramEngine: parsedUpdate.telegramEngine === null
      ? undefined
      : parsedUpdate.telegramEngine ?? current.telegramEngine,
  };
  if (parsedUpdate.telegramEngine === null) delete next.telegramEngine;
  const saved = OperatorSettingsSchema.parse(next);
  sqlite.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(SETTINGS_KEY, JSON.stringify(saved), new Date().toISOString());
  return saved;
}
