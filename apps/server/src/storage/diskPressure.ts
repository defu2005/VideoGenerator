import type Database from "better-sqlite3";

const key = "storage_disk_pressure";
type Pressure = { freePercent: number; at: string; projects: Array<{ projectId: string; bytes: number }> };

export function readDiskPressure(db: Database.Database, now = new Date()): Pressure | null {
  const row = db.prepare("SELECT value FROM app_settings WHERE key=?").get(key) as { value: string } | undefined;
  if (!row) return null;
  try {
    const data = JSON.parse(row.value) as Pressure;
    if (now.getTime() - Date.parse(data.at) > 10 * 60_000 || !Number.isFinite(data.freePercent) || !Array.isArray(data.projects)) return null;
    return data;
  } catch {
    return null;
  }
}

export function writeDiskPressure(db: Database.Database, pressure: Pressure | null): void {
  if (!pressure) {
    db.prepare("DELETE FROM app_settings WHERE key=?").run(key);
    return;
  }
  db.prepare(`INSERT INTO app_settings(key,value,updated_at) VALUES (?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`)
    .run(key, JSON.stringify(pressure), pressure.at);
}
