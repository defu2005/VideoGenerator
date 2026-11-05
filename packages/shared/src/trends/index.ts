import {
  TREND_AUTO_APPROVE_MIN,
  TREND_FIT_MIN,
  TREND_PREFILTER_LIMIT,
  TREND_USER_AGENT,
  type TrendIdea,
  type TrendItem,
  type TrendUrgency,
} from "../schemas/trends.js";
import {
  normalizeIso,
  pickNextFreePublishSlot,
  type PlannedSlot,
} from "../automation/slots.js";
import type { ProfileAutomation } from "../schemas/automation.js";

const STOPWORDS = new Set([
  "and", "the", "for", "with", "from", "that", "this", "của", "và", "cho", "các", "một", "những", "trong", "với", "được", "khi", "như", "theo",
]);

/** Descriptive UA for public APIs. Must never contain an email address. */
export function trendUserAgent(): string {
  return TREND_USER_AGENT;
}

export function userAgentHasEmail(value: string): boolean {
  return value.includes("@");
}

const SENSITIVE_PATTERNS: RegExp[] = [
  /động đất|sóng thần|lũ lụt|thảm họa|cháy lớn|bão lớn/i,
  /earthquake|tsunami|wildfire|disaster/i,
  /tử vong|qua đời|thiệt mạng|killed|murder/i,
  /hiếp dâm|bắt cóc|giết người/i,
  /bầu cử|tranh cử|\belection\b/i,
  /chữa khỏi|thần dược|miracle cure/i,
];

export function directionCoversNews(direction: string): boolean {
  return /tin tức|thời sự|\bnews\b|báo chí|current events|breaking news/i.test(direction);
}

export function isSensitiveText(text: string): boolean {
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(text));
}

export function tokenizeKeywords(text: string): string[] {
  const seen = new Set<string>();
  const words: string[] = [];
  for (const raw of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    const word = raw.trim();
    if (word.length < 2 || STOPWORDS.has(word) || seen.has(word)) continue;
    seen.add(word);
    words.push(word);
  }
  return words;
}

export function directionKeywords(input: {
  direction?: string | null;
  learnedNotes?: string | null;
  topicAngles?: string[];
}): string[] {
  return tokenizeKeywords([
    input.direction ?? "",
    input.learnedNotes ?? "",
    ...(input.topicAngles ?? []),
  ].join(" "));
}

export function keywordOverlap(title: string, keywords: readonly string[]): number {
  if (keywords.length === 0) return 0;
  const haystack = title.toLowerCase();
  let count = 0;
  for (const keyword of keywords) {
    if (haystack.includes(keyword)) count += 1;
  }
  return count;
}

/** Keep items that share a direction keyword, highest overlap then score, at most 40. */
export function keywordPrefilter(
  items: readonly TrendItem[],
  keywords: readonly string[],
  limit = TREND_PREFILTER_LIMIT,
): TrendItem[] {
  const ranked = items.map((item) => ({
    item,
    overlap: keywords.length === 0 ? 1 : keywordOverlap(item.title, keywords),
  }));
  return ranked
    .filter((row) => row.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap || b.item.score - a.item.score || a.item.title.localeCompare(b.item.title))
    .slice(0, limit)
    .map((row) => row.item);
}

export function buildTrendMatchPrompt(input: {
  direction: string;
  learnedNotes?: string | null;
  language: string;
  items: TrendItem[];
}): { system: string; prompt: string } {
  return {
    system: [
      "You match trending items to one channel.",
      "Do not invent facts.",
      "whyNow must cite the source item titles.",
      "Return at most 8 ideas.",
      "Mark sensitive true for disasters, deaths, crimes against named private people, elections, or health claims.",
      "Reply with JSON only.",
    ].join(" "),
    prompt: JSON.stringify({
      direction: input.direction,
      learnedNotes: input.learnedNotes ?? "",
      language: input.language,
      items: input.items.map((item) => ({
        title: item.title,
        source: item.source,
        url: item.url ?? null,
        category: item.category ?? null,
      })),
    }),
  };
}

export type SkippedTrend = { title: string; reason: string };

export function acceptTrendIdeas(ideas: readonly TrendIdea[], coversNews: boolean): {
  kept: TrendIdea[];
  skipped: SkippedTrend[];
} {
  const kept: TrendIdea[] = [];
  const skipped: SkippedTrend[] = [];
  for (const idea of ideas.slice(0, 8)) {
    if (idea.fitScore < TREND_FIT_MIN) {
      skipped.push({ title: idea.title, reason: "fit" });
      continue;
    }
    const sensitive = idea.sensitive || isSensitiveText(`${idea.title} ${idea.whyNow} ${idea.angle}`);
    if (sensitive && !coversNews) {
      skipped.push({ title: idea.title, reason: "sensitive" });
      continue;
    }
    kept.push({ ...idea, sensitive });
  }
  return { kept, skipped };
}

export function trendTopicStatus(fitScore: number, autoApproveTopics: boolean): "PENDING" | "APPROVED" {
  return autoApproveTopics && fitScore >= TREND_AUTO_APPROVE_MIN ? "APPROVED" : "PENDING";
}

export type ScheduledTopicRef = {
  id: string;
  scheduledFor: string | null;
  urgency: TrendUrgency | null;
};

/**
 * "today" ideas take the earliest free publish slot.
 * When every slot in the window is held by an older non-today topic, take that
 * earliest slot and move the other topic forward. Never drops a topic.
 */
export function planTodaySlot(input: {
  now: Date;
  automation: Pick<ProfileAutomation, "enabled" | "timezone" | "publishTimes" | "videosPerDay">;
  existing: readonly ScheduledTopicRef[];
  daysAhead?: number;
}): { scheduledFor: string | null; displaced: { id: string; scheduledFor: string | null } | null } {
  if (!input.automation.enabled) return { scheduledFor: null, displaced: null };
  const daysAhead = input.daysAhead ?? 14;
  const assigned = input.existing
    .map((topic) => topic.scheduledFor)
    .filter((iso): iso is string => Boolean(iso));
  const free: PlannedSlot | null = pickNextFreePublishSlot({
    now: input.now,
    automation: input.automation,
    assignedSlotIsos: assigned,
    minAheadMs: 60_000,
    daysAhead,
  });
  if (free) return { scheduledFor: free.at.toISOString(), displaced: null };

  const holders = input.existing
    .filter((topic) => topic.scheduledFor && topic.urgency !== "today")
    .sort((a, b) => Date.parse(a.scheduledFor!) - Date.parse(b.scheduledFor!));
  const victim = holders[0];
  if (!victim?.scheduledFor) return { scheduledFor: null, displaced: null };
  const stolen = victim.scheduledFor;
  const rest = assigned.filter((iso) => normalizeIso(iso) !== normalizeIso(stolen));
  const next = pickNextFreePublishSlot({
    now: input.now,
    automation: input.automation,
    assignedSlotIsos: [...rest, stolen],
    minAheadMs: 60_000,
    daysAhead: daysAhead + 7,
  });
  return {
    scheduledFor: stolen,
    displaced: { id: victim.id, scheduledFor: next?.at.toISOString() ?? null },
  };
}

export function urgencyFromNotes(notes: string | null | undefined): TrendUrgency | null {
  if (!notes) return null;
  try {
    const parsed = JSON.parse(notes) as { urgency?: string };
    if (parsed.urgency === "today" || parsed.urgency === "this_week" || parsed.urgency === "evergreen") {
      return parsed.urgency;
    }
  } catch {
    return null;
  }
  return null;
}
