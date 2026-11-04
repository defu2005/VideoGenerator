import type { ProfileAutomation } from "../schemas/automation.js";

export type PlannedSlot = {
  /** UTC instant of the publish time. */
  at: Date;
  /** Local calendar date YYYY-MM-DD in the profile timezone. */
  localDate: string;
};

export type ProductionPick = {
  slot: PlannedSlot;
  /** True when the original intended slot was in the past and we moved forward. */
  rescheduled: boolean;
};

/** Format a Date as YYYY-MM-DD in the given IANA timezone. */
export function localDateString(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** Add calendar days to a YYYY-MM-DD string (UTC noon math; date-only). */
export function addLocalDays(localDate: string, days: number): string {
  const [y, m, d] = localDate.split("-").map(Number);
  const base = new Date(Date.UTC(y!, m! - 1, d! + days, 12, 0, 0));
  return base.toISOString().slice(0, 10);
}

/**
 * Convert a local date + HH:mm in `timeZone` to a UTC Date.
 * Uses a short binary search against Intl offset (no extra deps).
 */
export function zonedLocalToUtc(localDate: string, hhmm: string, timeZone: string): Date {
  const [year, month, day] = localDate.split("-").map(Number);
  const [hour, minute] = hhmm.split(":").map(Number);
  // Initial guess: treat as UTC then refine with the zone offset.
  let guess = Date.UTC(year!, month! - 1, day!, hour!, minute!, 0);
  for (let i = 0; i < 4; i += 1) {
    const parts = zonedParts(new Date(guess), timeZone);
    const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const wanted = Date.UTC(year!, month! - 1, day!, hour!, minute!, 0);
    const delta = wanted - asUtc;
    if (delta === 0) break;
    guess += delta;
  }
  return new Date(guess);
}

function zonedParts(date: Date, timeZone: string): {
  year: number; month: number; day: number; hour: number; minute: number; second: number;
} {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const map: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

/** Enumerate publish slots from today (local) through `daysAhead - 1` more days. */
export function enumerateSlots(
  now: Date,
  automation: Pick<ProfileAutomation, "timezone" | "publishTimes">,
  daysAhead = 7,
): PlannedSlot[] {
  const times = [...automation.publishTimes].sort();
  const start = localDateString(now, automation.timezone);
  const slots: PlannedSlot[] = [];
  for (let i = 0; i < daysAhead; i += 1) {
    const localDate = addLocalDays(start, i);
    for (const time of times) {
      slots.push({
        at: zonedLocalToUtc(localDate, time, automation.timezone),
        localDate,
      });
    }
  }
  return slots;
}

/**
 * Pick the next publish slot that should start production now.
 * - Skips slots already assigned (by ISO string match, second precision).
 * - Never schedules publishAt in the past: past free slots are skipped and
 *   capacity rolls to the next free future slot ("missed slot" reschedule).
 * - Respects videosPerDay for the local day of production start (today).
 * - Starts when now >= publishAt - leadTimeHours (and publishAt is still in the future).
 */
export function pickNextProductionSlot(input: {
  now: Date;
  automation: ProfileAutomation;
  /** ISO strings of slots that already have a topic assigned. */
  assignedSlotIsos: readonly string[];
  /** Projects/topics started by automation today (local) for this profile. */
  productionsStartedToday: number;
  daysAhead?: number;
}): ProductionPick | null {
  const { now, automation, assignedSlotIsos, productionsStartedToday } = input;
  if (!automation.enabled) return null;
  if (productionsStartedToday >= automation.videosPerDay) return null;

  const assigned = new Set(assignedSlotIsos.map((iso) => normalizeIso(iso)));
  const slots = enumerateSlots(now, automation, input.daysAhead ?? 7);
  const leadMs = automation.leadTimeHours * 60 * 60 * 1000;
  const nowMs = now.getTime();

  let hadMissed = false;
  for (const slot of slots) {
    const key = normalizeIso(slot.at.toISOString());
    if (assigned.has(key)) continue;
    // Missed: publish time already passed → skip; next free future slot absorbs it.
    if (slot.at.getTime() <= nowMs) {
      hadMissed = true;
      continue;
    }
    // Too early to start production for this slot (and later slots are later).
    if (nowMs < slot.at.getTime() - leadMs) return null;
    // Within lead window and still before publish time.
    return { slot, rescheduled: hadMissed };
  }
  return null;
}

/** How many free future slots remain in the next `days` local days (for autoSuggest). */
export function countFreeFutureSlots(input: {
  now: Date;
  automation: ProfileAutomation;
  assignedSlotIsos: readonly string[];
  days: number;
}): number {
  const assigned = new Set(input.assignedSlotIsos.map((iso) => normalizeIso(iso)));
  const nowMs = input.now.getTime();
  return enumerateSlots(input.now, input.automation, input.days)
    .filter((slot) => slot.at.getTime() > nowMs && !assigned.has(normalizeIso(slot.at.toISOString())))
    .length;
}

/**
 * Next free publish slot at least `minAheadMs` ahead of `now`.
 * Skips slots already assigned to other topics and caps per local day by `videosPerDay`.
 */
export function pickNextFreePublishSlot(input: {
  now: Date;
  automation: Pick<ProfileAutomation, "timezone" | "publishTimes" | "videosPerDay">;
  assignedSlotIsos: readonly string[];
  minAheadMs?: number;
  daysAhead?: number;
}): PlannedSlot | null {
  const minAheadMs = input.minAheadMs ?? 5 * 60 * 1000;
  const assigned = new Set(input.assignedSlotIsos.map((iso) => normalizeIso(iso)));
  const perDay = new Map<string, number>();
  for (const iso of assigned) {
    const ms = Date.parse(iso);
    if (Number.isNaN(ms)) continue;
    const localDate = localDateString(new Date(ms), input.automation.timezone);
    perDay.set(localDate, (perDay.get(localDate) ?? 0) + 1);
  }
  const threshold = input.now.getTime() + minAheadMs;
  for (const slot of enumerateSlots(input.now, input.automation, input.daysAhead ?? 14)) {
    if (slot.at.getTime() < threshold) continue;
    const key = normalizeIso(slot.at.toISOString());
    if (assigned.has(key)) continue;
    if ((perDay.get(slot.localDate) ?? 0) >= input.automation.videosPerDay) continue;
    return slot;
  }
  return null;
}

export function normalizeIso(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  return new Date(ms).toISOString();
}

/** Token-overlap similarity in [0, 1]. */
export function topicSimilarity(a: string, b: string): number {
  const left = tokenize(a);
  const right = tokenize(b);
  if (left.size === 0 || right.size === 0) return 0;
  let overlap = 0;
  for (const token of left) {
    if (right.has(token)) overlap += 1;
  }
  return overlap / Math.max(left.size, right.size);
}

export function normalizeTopicText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text: string): Set<string> {
  const normalized = normalizeTopicText(text);
  if (!normalized) return new Set();
  return new Set(normalized.split(" ").filter((token) => token.length > 1));
}

/** Drop suggestions that match past topics (exact normalised or overlap > 0.7). */
export function dedupeTopicSuggestions<T extends { topic: string }>(
  suggestions: readonly T[],
  pastTopics: readonly string[],
  overlapThreshold = 0.7,
): { kept: T[]; rejected: number } {
  const pastNormalized = pastTopics.map(normalizeTopicText).filter(Boolean);
  const kept: T[] = [];
  let rejected = 0;
  const seen = new Set<string>();
  for (const item of suggestions) {
    const norm = normalizeTopicText(item.topic);
    if (!norm || seen.has(norm)) {
      rejected += 1;
      continue;
    }
    // Within this batch: exact normalised only (variants like "góc 1/2" stay).
    // Against history: exact or token-overlap > threshold.
    const duplicate = pastNormalized.some((past) => (
      past === norm || topicSimilarity(item.topic, past) > overlapThreshold
    ));
    if (duplicate) {
      rejected += 1;
      continue;
    }
    seen.add(norm);
    kept.push(item);
  }
  return { kept, rejected };
}
