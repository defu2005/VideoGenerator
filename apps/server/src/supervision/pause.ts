import type Database from "better-sqlite3";
import { currentDuty, lastDutyAt } from "./duty.js";

export const MAX_HERMES_PAUSE_MIN = 360;
export const HERMES_OFFLINE_LIFT_MS = 10 * 60 * 1000;
export const USER_STOP_PAUSE_MIN = 60;
const KEY = "operator.pause";

export type OperatorPause = { by: string; until: string; reason: string; since: string };

export function getOperatorPause(sqlite: Database.Database, now = new Date()): OperatorPause | null {
  const row = sqlite.prepare("SELECT value FROM app_settings WHERE key = ?").get(KEY) as { value: string } | undefined;
  if (!row) return null;
  try {
    const pause = JSON.parse(row.value) as OperatorPause;
    return pause.until > now.toISOString() ? pause : null;
  } catch { return null; }
}

function write(sqlite: Database.Database, pause: OperatorPause | null, now: Date): void {
  if (!pause) {
    sqlite.prepare("DELETE FROM app_settings WHERE key = ?").run(KEY);
    return;
  }
  sqlite.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(KEY, JSON.stringify(pause), now.toISOString());
}

export function pauseByHermes(
  sqlite: Database.Database, instance: string, minutes: number, reason: string, now = new Date(),
): { ok: true; pause: OperatorPause } | { ok: false; message: string } {
  const current = getOperatorPause(sqlite, now);
  if (current && !current.by.startsWith("hermes/")) return { ok: false, message: "Người dùng đã dừng operator, Hermes không ghi đè." };
  const capped = Math.max(1, Math.min(MAX_HERMES_PAUSE_MIN, Math.floor(minutes)));
  const pause = { by: instance, until: new Date(now.getTime() + capped * 60_000).toISOString(), reason: reason.slice(0, 300), since: now.toISOString() };
  write(sqlite, pause, now);
  return { ok: true, pause };
}

/** A user /stop: the operator stays quiet for an hour and Hermes cannot undo it. */
export function pauseByUser(sqlite: Database.Database, now = new Date(), minutes = USER_STOP_PAUSE_MIN): OperatorPause {
  const pause = { by: "user", until: new Date(now.getTime() + minutes * 60_000).toISOString(), reason: "Người dùng bấm dừng", since: now.toISOString() };
  write(sqlite, pause, now);
  return pause;
}

export function clearPauseBy(sqlite: Database.Database, by: "hermes" | "user", now = new Date()): { ok: boolean; message?: string } {
  const current = getOperatorPause(sqlite, now);
  if (!current) return { ok: true };
  if (by === "hermes" && !current.by.startsWith("hermes/")) return { ok: false, message: "Chỉ người dùng được bỏ lệnh dừng do người dùng đặt." };
  write(sqlite, null, now);
  return { ok: true };
}

/** Fail-safe: a Hermes pause is lifted once no supervisor has been on duty for 10 minutes. */
export function liftOrphanedHermesPause(sqlite: Database.Database, now = new Date()): OperatorPause | null {
  const pause = getOperatorPause(sqlite, now);
  if (!pause || !pause.by.startsWith("hermes/")) return null;
  if (currentDuty(sqlite, now)) return null;
  const last = lastDutyAt(sqlite);
  const quietSince = Math.max(Date.parse(last ?? "") || 0, Date.parse(pause.since));
  if (now.getTime() - quietSince < HERMES_OFFLINE_LIFT_MS) return null;
  write(sqlite, null, now);
  return pause;
}
