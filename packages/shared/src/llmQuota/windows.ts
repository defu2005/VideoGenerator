import type { LlmQuotaWindow } from "../schemas/llmQuota.js";

const ROLLING_5H_MS = 5 * 60 * 60 * 1000;

type ZonedParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function zonedParts(date: Date, timeZone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const map: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) map[part.type] = part.value;
  let hour = Number(map.hour);
  let day = Number(map.day);
  let month = Number(map.month);
  let year = Number(map.year);
  if (hour === 24) hour = 0;
  return {
    year,
    month,
    day,
    hour,
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

function offsetMs(date: Date, timeZone: string): number {
  const parts = zonedParts(date, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - date.getTime();
}

function zonedToUtc(year: number, month: number, day: number, hour: number, minute: number, second: number, timeZone: string): Date {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  let instant = utcGuess - offsetMs(new Date(utcGuess), timeZone);
  instant = utcGuess - offsetMs(new Date(instant), timeZone);
  return new Date(instant);
}

function addDays(year: number, month: number, day: number, days: number): { year: number; month: number; day: number } {
  const utc = new Date(Date.UTC(year, month - 1, day + days));
  return { year: utc.getUTCFullYear(), month: utc.getUTCMonth() + 1, day: utc.getUTCDate() };
}

function nextMonthStart(year: number, month: number): { year: number; month: number } {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

const LIFETIME_START = new Date(0);

/** Start of the quota window that contains `now`. For `rolling_5h` this is `now` minus 5 hours. Lifetime never resets. */
export function currentWindowStart(window: LlmQuotaWindow, now: Date, timeZone: string): Date {
  if (window === "lifetime") return LIFETIME_START;
  if (window === "rolling_5h") return new Date(now.getTime() - ROLLING_5H_MS);
  const parts = zonedParts(now, timeZone);
  if (window === "minute") return zonedToUtc(parts.year, parts.month, parts.day, parts.hour, parts.minute, 0, timeZone);
  if (window === "day") return zonedToUtc(parts.year, parts.month, parts.day, 0, 0, 0, timeZone);
  return zonedToUtc(parts.year, parts.month, 1, 0, 0, 0, timeZone);
}

/** Instant the current window ends. Lifetime has no reset; callers use `expiresAt` when a trial ends. */
export function nextReset(window: LlmQuotaWindow, now: Date, timeZone: string): Date {
  if (window === "lifetime") return new Date(now.getTime());
  if (window === "rolling_5h") return new Date(now.getTime() + ROLLING_5H_MS);
  const parts = zonedParts(now, timeZone);
  if (window === "minute") return new Date(currentWindowStart(window, now, timeZone).getTime() + 60_000);
  if (window === "day") {
    const next = addDays(parts.year, parts.month, parts.day, 1);
    return zonedToUtc(next.year, next.month, next.day, 0, 0, 0, timeZone);
  }
  const next = nextMonthStart(parts.year, parts.month);
  return zonedToUtc(next.year, next.month, 1, 0, 0, 0, timeZone);
}

export function formatHourMinute(date: Date, timeZone: string): string {
  const parts = zonedParts(date, timeZone);
  return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

export function localDateKey(date: Date, timeZone: string): string {
  const parts = zonedParts(date, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}
