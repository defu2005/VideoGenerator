import type Database from "better-sqlite3";

const SETTINGS_KEY = "youtubeQuota";

export type YoutubeQuotaState = {
  /** Calendar date in America/Los_Angeles (YYYY-MM-DD). */
  date: string;
  used: number;
};

/** Pacific (America/Los_Angeles) calendar date for YouTube quota reset. */
export function pacificDateKey(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * Next midnight Pacific Time as an ISO string (UTC).
 * YouTube daily quotas reset at midnight PT.
 */
export function nextPacificMidnightIso(now: Date = new Date()): string {
  const today = pacificDateKey(now);
  let lo = now.getTime();
  let hi = now.getTime() + 36 * 3600_000;
  while (pacificDateKey(new Date(hi)) === today) {
    hi += 12 * 3600_000;
  }
  // Earliest UTC instant whose PT calendar date is after `today`
  while (hi - lo > 500) {
    const mid = Math.floor((lo + hi) / 2);
    if (pacificDateKey(new Date(mid)) === today) lo = mid;
    else hi = mid;
  }
  const midnight = new Date(hi);
  midnight.setUTCMilliseconds(0);
  return midnight.toISOString();
}

export class YoutubeQuotaTracker {
  constructor(
    private readonly sqlite: Database.Database,
    private readonly dailyLimit: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  getLimit(): number {
    return this.dailyLimit;
  }

  getState(): YoutubeQuotaState {
    const today = pacificDateKey(this.now());
    const row = this.sqlite.prepare("SELECT value FROM app_settings WHERE key = ?").get(SETTINGS_KEY) as
      | { value: string }
      | undefined;
    if (!row) return { date: today, used: 0 };
    try {
      const parsed = JSON.parse(row.value) as YoutubeQuotaState;
      if (parsed.date !== today) return { date: today, used: 0 };
      return { date: today, used: Number(parsed.used) || 0 };
    } catch {
      return { date: today, used: 0 };
    }
  }

  /** True when charging `units` would exceed the daily budget. */
  wouldExceed(units: number): boolean {
    const { used } = this.getState();
    return used + units > this.dailyLimit;
  }

  remaining(): number {
    return Math.max(0, this.dailyLimit - this.getState().used);
  }

  record(units: number): void {
    const today = pacificDateKey(this.now());
    const current = this.getState();
    const used = (current.date === today ? current.used : 0) + units;
    const value = JSON.stringify({ date: today, used } satisfies YoutubeQuotaState);
    const nowIso = this.now().toISOString();
    this.sqlite.prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).run(SETTINGS_KEY, value, nowIso);
  }

  /** Test helper. */
  setUsed(used: number, date = pacificDateKey(this.now())): void {
    const value = JSON.stringify({ date, used } satisfies YoutubeQuotaState);
    this.sqlite.prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).run(SETTINGS_KEY, value, this.now().toISOString());
  }
}
