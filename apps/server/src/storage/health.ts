import type Database from "better-sqlite3";
import type { StorageTransferStat } from "@vg/shared";

const KEY = "storage_provider_health";
const WINDOW = 30 * 60_000;
const COOLDOWN = 10 * 60_000;

type Bucket = { minute: number; direct: number; control: number; fallback: number };
type State = { lastOk?: string; lastError?: string; suspendedUntil?: number; buckets: Bucket[] };

function read(db: Database.Database): State {
  const row = db.prepare("SELECT value FROM app_settings WHERE key=?").get(KEY) as { value: string } | undefined;
  if (row) {
    try {
      const state = JSON.parse(row.value) as State;
      if (Array.isArray(state.buckets)) return state;
    } catch { /* Invalid persisted counters are discarded. */ }
  }
  return { buckets: [] };
}

export function storageHealth(db: Database.Database, now = new Date()) {
  const state = read(db);
  const cutoff = now.getTime() - WINDOW;
  const recent = state.buckets.filter((bucket) => bucket.minute > cutoff);
  const fallback = recent.reduce((n, row) => n + row.fallback, 0);
  const direct = recent.reduce((n, row) => n + row.direct, 0);
  const control = recent.reduce((n, row) => n + row.control, 0);
  return {
    lastOk: state.lastOk ?? null,
    lastError: state.lastError ?? null,
    suspendedUntil: state.suspendedUntil && state.suspendedUntil > now.getTime() ? new Date(state.suspendedUntil).toISOString() : null,
    fallback, direct, control,
    failureRate: direct + fallback ? fallback / (direct + fallback) : 0,
  };
}

export function recordStorageHealth(db: Database.Database, transfers: readonly StorageTransferStat[], now = new Date(), check?: "passed" | "failed") {
  if (!transfers.length && !check) return;
  db.transaction(() => {
    const state = read(db);
    const time = now.getTime();
    const minute = Math.floor(time / 60_000) * 60_000;
    state.buckets = state.buckets.filter((bucket) => bucket.minute > time - WINDOW);
    let bucket = state.buckets.find((item) => item.minute === minute);
    if (!bucket) {
      bucket = { minute, direct: 0, control: 0, fallback: 0 };
      state.buckets.push(bucket);
    }
    let failed = false;
    for (const stat of transfers) {
      if (stat.route === "direct" && !stat.error) {
        bucket.direct += stat.count;
        state.lastOk = now.toISOString();
      } else if (stat.route === "control") {
        bucket.control += stat.count;
        if (stat.error) {
          bucket.fallback += stat.count;
          failed = true;
        }
      }
    }
    if (check === "passed") state.lastOk = now.toISOString();
    if (failed || check === "failed") state.lastError = now.toISOString();
    if (check === "failed" || (failed && state.buckets.reduce((n, item) => n + item.fallback, 0) > 3)) {
      state.suspendedUntil = time + COOLDOWN;
    }
    db.prepare(`INSERT INTO app_settings(key,value,updated_at) VALUES (?,?,?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`).run(KEY, JSON.stringify(state), now.toISOString());
  }).immediate();
}
