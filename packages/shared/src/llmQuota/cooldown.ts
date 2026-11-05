const BACKOFF_STEPS_MS = [60_000, 5 * 60_000, 30 * 60_000, 6 * 60 * 60_000] as const;
const BACKOFF_CAP_MS = 6 * 60 * 60_000;

export function isDailyQuotaMessage(message: string): boolean {
  return /per day|\brpd\b|\bdaily\b|quota exceeded for metric[\s\S]{0,120}per day/i.test(message);
}

export function nextBackoffMs(previousDurationMs: number | null): number {
  if (previousDurationMs == null) return BACKOFF_STEPS_MS[0];
  const index = BACKOFF_STEPS_MS.findIndex((step) => previousDurationMs <= step * 1.25);
  if (index < 0) return BACKOFF_CAP_MS;
  return BACKOFF_STEPS_MS[Math.min(index + 1, BACKOFF_STEPS_MS.length - 1)] ?? BACKOFF_CAP_MS;
}

export function chooseCooldown(input: {
  now: Date;
  message: string;
  retryAfterMs?: number;
  previous: { untilMs: number; setAtMs: number } | null;
  nextDayReset: Date;
}): { until: Date; reason: string } {
  if (input.retryAfterMs !== undefined && Number.isFinite(input.retryAfterMs)) {
    return { until: new Date(input.now.getTime() + Math.max(0, input.retryAfterMs)), reason: "retry-after" };
  }
  if (isDailyQuotaMessage(input.message)) {
    const until = input.nextDayReset.getTime() <= input.now.getTime()
      ? new Date(input.now.getTime() + 60_000)
      : input.nextDayReset;
    return { until, reason: "daily-reset" };
  }
  const previousDuration = input.previous ? input.previous.untilMs - input.previous.setAtMs : null;
  const expiredLongAgo = input.previous != null
    && input.previous.untilMs < input.now.getTime()
    && input.now.getTime() - input.previous.setAtMs > BACKOFF_CAP_MS;
  const waitMs = nextBackoffMs(expiredLongAgo ? null : previousDuration);
  const reason = waitMs <= 60_000 ? "backoff:1m"
    : waitMs <= 5 * 60_000 ? "backoff:5m"
      : waitMs <= 30 * 60_000 ? "backoff:30m"
        : "backoff:6h";
  return { until: new Date(input.now.getTime() + waitMs), reason };
}
