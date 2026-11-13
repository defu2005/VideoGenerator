import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { appProviderForOmniroute, type LlmQuotaUnit, type OmniRouteSyncStatus } from "@vg/shared";

export const OMNIROUTE_SYNC_KEY = "omnirouteQuotaSync";
export const OMNIROUTE_MANAGEMENT_TOKEN_KEY = "omniroute.managementToken";
export const NONE_QUOTA_KEY = "__none__";

export type QuotaSnapshot = {
  connectionId: string;
  omnirouteProvider: string;
  label: string;
  maskedAccount: string | null;
  quotaKey: string;
  used: number | null;
  total: number | null;
  remaining: number | null;
  remainingPct: number | null;
  resetAt: string | null;
  unlimited: boolean;
  fractionReported: boolean | null;
  unit: LlmQuotaUnit;
  expiresAt: string | null;
  fetchedAt: string;
  error: string | null;
  active: boolean;
  rateLimitNote: string | null;
};

export type OmniRouteSyncState = {
  status: OmniRouteSyncStatus;
  fetchedAt: string | null;
  message: string | null;
  dashboardUrl: string;
};

type SnapshotSql = {
  connection_id: string;
  omniroute_provider: string;
  label: string;
  masked_account: string | null;
  quota_key: string;
  used: number | null;
  total: number | null;
  remaining: number | null;
  remaining_pct: number | null;
  reset_at: string | null;
  unlimited: number;
  fraction_reported: number | null;
  unit: string;
  expires_at: string | null;
  fetched_at: string;
  error: string | null;
  active: number;
  rate_limit_note: string | null;
};

function bit(value: number | null): boolean | null {
  if (value == null) return null;
  return value !== 0;
}

function asUnit(value: string): LlmQuotaUnit {
  if (value === "tokens" || value === "credits_usd" || value === "credits") return value;
  return "requests";
}

function mapRow(row: SnapshotSql): QuotaSnapshot {
  return {
    connectionId: row.connection_id,
    omnirouteProvider: row.omniroute_provider,
    label: row.label,
    maskedAccount: row.masked_account,
    quotaKey: row.quota_key,
    used: row.used,
    total: row.total,
    remaining: row.remaining,
    remainingPct: row.remaining_pct,
    resetAt: row.reset_at,
    unlimited: row.unlimited !== 0,
    fractionReported: bit(row.fraction_reported),
    unit: asUnit(row.unit),
    expiresAt: row.expires_at,
    fetchedAt: row.fetched_at,
    error: row.error,
    active: row.active !== 0,
    rateLimitNote: row.rate_limit_note,
  };
}

const SELECT_SNAPSHOTS = `SELECT connection_id, omniroute_provider, label, masked_account, quota_key,
  used, total, remaining, remaining_pct, reset_at, unlimited, fraction_reported, unit, expires_at,
  fetched_at, error, active, rate_limit_note
  FROM llm_provider_quota_snapshots`;

export function loadQuotaSnapshots(sqlite: Database.Database): QuotaSnapshot[] {
  return (sqlite.prepare(SELECT_SNAPSHOTS).all() as SnapshotSql[]).map(mapRow);
}

export function replaceConnectionSnapshots(
  sqlite: Database.Database,
  rows: QuotaSnapshot[],
): void {
  if (rows.length === 0) return;
  const connectionId = rows[0]!.connectionId;
  const insert = sqlite.prepare(
    `INSERT INTO llm_provider_quota_snapshots (
      id, connection_id, omniroute_provider, label, masked_account, quota_key,
      used, total, remaining, remaining_pct, reset_at, unlimited, fraction_reported,
      unit, expires_at, fetched_at, error, active, rate_limit_note
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const tx = sqlite.transaction(() => {
    sqlite.prepare("DELETE FROM llm_provider_quota_snapshots WHERE connection_id = ?").run(connectionId);
    for (const row of rows) {
      insert.run(
        randomUUID(),
        row.connectionId,
        row.omnirouteProvider,
        row.label,
        row.maskedAccount,
        row.quotaKey,
        row.used,
        row.total,
        row.remaining,
        row.remainingPct,
        row.resetAt,
        row.unlimited ? 1 : 0,
        row.fractionReported == null ? null : row.fractionReported ? 1 : 0,
        row.unit,
        row.expiresAt,
        row.fetchedAt,
        row.error,
        row.active ? 1 : 0,
        row.rateLimitNote,
      );
    }
  });
  tx();
}

export function keepConnectionError(
  sqlite: Database.Database,
  input: { connectionId: string; omnirouteProvider: string; label: string; maskedAccount: string | null; active: boolean; error: string; fetchedAt: string },
): void {
  const existing = sqlite.prepare(
    "SELECT id FROM llm_provider_quota_snapshots WHERE connection_id = ?",
  ).all(input.connectionId) as { id: string }[];
  if (existing.length > 0) {
    sqlite.prepare(
      "UPDATE llm_provider_quota_snapshots SET error = ?, fetched_at = ? WHERE connection_id = ?",
    ).run(input.error, input.fetchedAt, input.connectionId);
    return;
  }
  replaceConnectionSnapshots(sqlite, [{
    connectionId: input.connectionId,
    omnirouteProvider: input.omnirouteProvider,
    label: input.label,
    maskedAccount: input.maskedAccount,
    quotaKey: NONE_QUOTA_KEY,
    used: null,
    total: null,
    remaining: null,
    remainingPct: null,
    resetAt: null,
    unlimited: false,
    fractionReported: null,
    unit: "requests",
    expiresAt: null,
    fetchedAt: input.fetchedAt,
    error: input.error,
    active: input.active,
    rateLimitNote: null,
  }]);
}

export function setRateLimitNotes(sqlite: Database.Database, connectionId: string, note: string | null): void {
  sqlite.prepare(
    "UPDATE llm_provider_quota_snapshots SET rate_limit_note = ? WHERE connection_id = ?",
  ).run(note, connectionId);
}

export function readSyncState(sqlite: Database.Database): OmniRouteSyncState {
  const row = sqlite.prepare("SELECT value FROM app_settings WHERE key = ?").get(OMNIROUTE_SYNC_KEY) as { value: string } | undefined;
  if (!row) return { status: "idle", fetchedAt: null, message: null, dashboardUrl: "http://127.0.0.1:20128" };
  try {
    const value = JSON.parse(row.value) as Partial<OmniRouteSyncState>;
    const status = value.status === "connected" || value.status === "needs_token" || value.status === "unreachable" || value.status === "idle"
      ? value.status
      : "idle";
    return {
      status,
      fetchedAt: typeof value.fetchedAt === "string" ? value.fetchedAt : null,
      message: typeof value.message === "string" ? value.message : null,
      dashboardUrl: typeof value.dashboardUrl === "string" && value.dashboardUrl ? value.dashboardUrl : "http://127.0.0.1:20128",
    };
  } catch {
    return { status: "idle", fetchedAt: null, message: null, dashboardUrl: "http://127.0.0.1:20128" };
  }
}

export function writeSyncState(sqlite: Database.Database, state: OmniRouteSyncState, now: Date): void {
  sqlite.prepare(
    "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  ).run(OMNIROUTE_SYNC_KEY, JSON.stringify(state), now.toISOString());
}

export function managementTokenSaved(sqlite: Database.Database): boolean {
  const row = sqlite.prepare("SELECT 1 AS ok FROM app_secrets WHERE key = ?").get(OMNIROUTE_MANAGEMENT_TOKEN_KEY) as { ok: number } | undefined;
  return Boolean(row);
}

export function latestSnapshotFetchedAt(sqlite: Database.Database, provider: string, model: string): string | null {
  const rows = loadQuotaSnapshots(sqlite).filter((row) => row.quotaKey !== NONE_QUOTA_KEY || row.fetchedAt);
  const relevant = rows.filter((row) => {
    if (provider === "omniroute") {
      const slash = model.indexOf("/");
      return slash > 0 && row.omnirouteProvider.toLowerCase() === model.slice(0, slash).toLowerCase();
    }
    const mapped = appProviderForOmniroute(row.omnirouteProvider);
    return mapped !== null && mapped === provider;
  });
  const pool = relevant.length > 0 ? relevant : [];
  let latest: string | null = null;
  for (const row of pool) {
    if (!latest || row.fetchedAt > latest) latest = row.fetchedAt;
  }
  return latest;
}
