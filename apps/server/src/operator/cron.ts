type Matcher = (value: number) => boolean;
const zoneFormatters = new Map<string, Intl.DateTimeFormat>();

function parseField(expr: string, min: number, max: number): Matcher {
  const matchers = expr.split(",").map((part) => {
    const [baseRaw, stepRaw] = part.split("/");
    const base = baseRaw?.trim() || "*";
    const step = stepRaw === undefined ? 1 : Number(stepRaw);
    if (!Number.isInteger(step) || step <= 0) return () => false;
    let start = min;
    let end = max;
    if (base !== "*") {
      if (base.includes("-")) {
        const [from, to] = base.split("-");
        start = Number(from);
        end = Number(to);
      } else {
        start = Number(base);
        end = Number(base);
      }
    }
    if (!Number.isFinite(start) || !Number.isFinite(end)) return () => false;
    return (value: number) => value >= start && value <= end && (value - start) % step === 0;
  });
  return (value: number) => matchers.some((match) => match(value));
}

export function zonedParts(date: Date, timeZone = "Asia/Ho_Chi_Minh"): {
  year: number;
  minute: number;
  hour: number;
  day: number;
  month: number;
  weekday: number;
} {
  let fmt = zoneFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23", weekday: "short", year: "numeric",
      month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    });
    if (zoneFormatters.size < 32) zoneFormatters.set(timeZone, fmt);
  }
  const map: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) map[part.type] = part.value;
  const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  let hour = Number(map.hour);
  if (hour === 24) hour = 0;
  return {
    year: Number(map.year),
    minute: Number(map.minute),
    hour,
    day: Number(map.day),
    month: Number(map.month),
    weekday: weekdays[map.weekday ?? ""] ?? 0,
  };
}

/** Standard 5-field cron in Asia/Ho_Chi_Minh. */
export function cronMatches(expr: string, date: Date, timeZone = "Asia/Ho_Chi_Minh"): boolean {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const parts = zonedParts(date, timeZone);
  const checks: Array<[string, number, number, number]> = [
    [fields[0]!, 0, 59, parts.minute],
    [fields[1]!, 0, 23, parts.hour],
    [fields[2]!, 1, 31, parts.day],
    [fields[3]!, 1, 12, parts.month],
    [fields[4]!, 0, 6, parts.weekday],
  ];
  return checks.every(([field, min, max, value]) => parseField(field, min, max)(value));
}

export function localMinuteKey(date: Date, timeZone = "Asia/Ho_Chi_Minh"): string {
  const parts = zonedParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}-${parts.hour}-${parts.minute}`;
}

export function isCronDue(expr: string, now: Date, lastFiredAt: string | null): boolean {
  if (!cronMatches(expr, now)) return false;
  if (!lastFiredAt) return true;
  const last = new Date(lastFiredAt);
  if (Number.isNaN(last.getTime())) return true;
  return localMinuteKey(now) !== localMinuteKey(last);
}

export const CRON_CATCHUP_MS = 6 * 60 * 60_000;

/** Latest missed minute only. Never scan an unbounded outage. */
export function latestMissedCron(
  expr: string, now: Date, lastHeartbeatAt: string, lastFiredAt: string | null, configuredAt?: string,
): Date | undefined {
  const heartbeat = Date.parse(lastHeartbeatAt);
  if (!Number.isFinite(heartbeat) || heartbeat >= now.getTime()) return undefined;
  const last = lastFiredAt ? Date.parse(lastFiredAt) : Number.NaN;
  const configured = configuredAt ? Date.parse(configuredAt) : Number.NaN;
  const lower = Math.max(heartbeat, Number.isFinite(last) ? last : 0, Number.isFinite(configured) ? configured : 0);
  const horizon = now.getTime() - CRON_CATCHUP_MS;
  for (let time = Math.floor(now.getTime() / 60_000) * 60_000; time > lower && time >= horizon; time -= 60_000) {
    const occurrence = new Date(time);
    if (isCronDue(expr, occurrence, lastFiredAt)) return occurrence;
  }
  return undefined;
}
