const HOUR = 3600_000;
const DAY = 24 * HOUR;

/**
 * How often to re-sync metrics for a publication based on age since publish.
 * - under 48h: every 2h
 * - under 14d: every 12h
 * - under 90d: daily
 * - older: weekly
 */
export function syncIntervalMs(publishedAt: Date, now: Date): number {
  const age = Math.max(0, now.getTime() - publishedAt.getTime());
  if (age < 48 * HOUR) return 2 * HOUR;
  if (age < 14 * DAY) return 12 * HOUR;
  if (age < 90 * DAY) return DAY;
  return 7 * DAY;
}

export function isDue(
  publishedAt: Date,
  lastSyncedAt: Date | null | undefined,
  now: Date,
): boolean {
  if (!lastSyncedAt) return true;
  // D4 needs one real observation at 48 h before the normal cadence slows to 12 h.
  const at48h = publishedAt.getTime() + 48 * HOUR;
  if (now.getTime() >= at48h && now.getTime() <= at48h + 2 * HOUR && lastSyncedAt.getTime() < at48h) return true;
  const elapsed = now.getTime() - lastSyncedAt.getTime();
  return elapsed >= syncIntervalMs(publishedAt, now);
}
