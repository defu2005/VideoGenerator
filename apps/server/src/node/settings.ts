import type Database from "better-sqlite3";
import { z } from "zod";
import {
  DEFAULT_REMOTE_RENDER, DEFAULT_REMOTE_STAGES, NodePlacementUpdateSchema, RemoteRenderSettingsSchema, RemoteStagesSettingsSchema,
  type NodePlacementSettings, type RemoteRenderSettings, type RemoteStagesSettings,
} from "@vg/shared";

const KEY = "nodes.remoteRender";

export function getRemoteRenderSettings(sqlite: Database.Database): RemoteRenderSettings {
  const row = sqlite.prepare("SELECT value FROM app_settings WHERE key = ?").get(KEY) as { value: string } | undefined;
  if (!row) return DEFAULT_REMOTE_RENDER;
  try {
    const value = typeof row.value === "string" ? JSON.parse(row.value) as unknown : row.value;
    const parsed = RemoteRenderSettingsSchema.safeParse(value);
    return parsed.success ? parsed.data : DEFAULT_REMOTE_RENDER;
  } catch {
    return DEFAULT_REMOTE_RENDER;
  }
}

export function saveRemoteRenderSettings(sqlite: Database.Database, input: unknown): RemoteRenderSettings {
  const parsed = RemoteRenderSettingsSchema.parse(input);
  sqlite.prepare(
    "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  ).run(KEY, JSON.stringify(parsed), new Date().toISOString());
  return parsed;
}

const STAGES_KEY = "nodes.remoteStages";
const LOCAL_ONLY_KEY = "nodes.localOnlyKeys";

function readJson(sqlite: Database.Database, key: string): unknown {
  const row = sqlite.prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as { value: string } | undefined;
  if (!row) return undefined;
  try {
    return typeof row.value === "string" ? JSON.parse(row.value) as unknown : row.value;
  } catch {
    return undefined;
  }
}

function writeJson(sqlite: Database.Database, key: string, value: unknown): void {
  sqlite.prepare(
    "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  ).run(key, JSON.stringify(value), new Date().toISOString());
}

/** TASK-120: placement mode of the stages beyond RENDER. Default off, so nothing leaves this machine. */
export function getRemoteStagesSettings(sqlite: Database.Database): RemoteStagesSettings {
  const parsed = RemoteStagesSettingsSchema.safeParse(readJson(sqlite, STAGES_KEY));
  return parsed.success ? parsed.data : DEFAULT_REMOTE_STAGES;
}

/** Vault key names the user marked "không gửi ra node". */
export function getLocalOnlyKeys(sqlite: Database.Database): string[] {
  const parsed = z.array(z.string().max(120)).max(100).safeParse(readJson(sqlite, LOCAL_ONLY_KEY));
  return parsed.success ? parsed.data : [];
}

export function getNodePlacement(sqlite: Database.Database): NodePlacementSettings {
  const render = getRemoteRenderSettings(sqlite);
  const stages = getRemoteStagesSettings(sqlite);
  return {
    mode: render.mode,
    remoteWaitSec: render.remoteWaitSec,
    stages: { RENDER: render.mode, VOICE: stages.VOICE, MEDIA_FETCH: stages.MEDIA_FETCH },
    localOnlyKeys: getLocalOnlyKeys(sqlite),
  };
}

export function saveNodePlacement(sqlite: Database.Database, input: unknown): NodePlacementSettings {
  const update = NodePlacementUpdateSchema.parse(input);
  if (update.mode !== undefined || update.remoteWaitSec !== undefined) {
    const current = getRemoteRenderSettings(sqlite);
    saveRemoteRenderSettings(sqlite, { mode: update.mode ?? current.mode, remoteWaitSec: update.remoteWaitSec ?? current.remoteWaitSec });
  }
  if (update.stages) writeJson(sqlite, STAGES_KEY, { ...getRemoteStagesSettings(sqlite), ...update.stages });
  if (update.localOnlyKeys) writeJson(sqlite, LOCAL_ONLY_KEY, [...new Set(update.localOnlyKeys)]);
  return getNodePlacement(sqlite);
}
