import type { ComposeLangPack, NumberGroup, NumberMention, NumberUnit, ShotSource } from "@vg/shared";

/** Chart payloads for R1, built only from words the scene says (TASK-067b part 1). */

export type ChartPayload = Extract<ShotSource, { kind: "chart" }>;

export type ChartPick = {
  payload: ChartPayload;
  /** Words the chart must cover: the numbers and the label words before them. */
  wordStart: number;
  wordEnd: number;
  /** First word of the first number; an earlier graphic may not reach past it. */
  firstNumberWord: number;
};

/** Fewest and most slices or bars that still read well on a phone. */
export const CHART_MIN_ITEMS = 2;
export const CHART_MAX_ITEMS = 6;
export const LINE_MAX_POINTS = 8;
const LABEL_MAX_CHARS = 24;
const TITLE_MAX_WORDS = 5;

/**
 * Words that sit between a label and its number ("Chrome chiếm 62%") or open a clause.
 * They are cut from both ends of a label. An unknown language has none, so only the position rule applies.
 */
const EDGE_WORDS: Record<string, string[]> = {
  vi: [
    "là", "đạt", "chiếm", "có", "còn", "chỉ", "khoảng", "hơn", "gần", "tới", "đến", "lên", "xuống", "từ", "và", "với",
    "thì", "ở", "trong", "vào", "mức", "tăng", "giảm", "được", "đã", "sẽ", "so", "năm", "của", "mất", "tốn", "cần", "dùng",
  ],
  en: [
    "is", "was", "are", "were", "has", "have", "had", "at", "about", "around", "over", "nearly", "almost", "and", "of",
    "in", "by", "the", "a", "an", "with", "than", "reached", "only", "up", "down", "to", "from", "for", "just", "while", "use", "uses",
  ],
};

const EDGE_PUNCT = /^[\s"'“”‘’(\[]+|[\s"'“”‘’)\],.;:!?…]+$/gu;
const CLAUSE_END = /[,;:.!?…]$/u;

function clean(token: string): string {
  return token.replace(EDGE_PUNCT, "");
}

function trimEdges(tokens: string[], lang: ComposeLangPack): string[] {
  const stop = new Set(EDGE_WORDS[lang.code] ?? []);
  const isEdge = (token: string) => !/\p{L}/u.test(token) || stop.has(token.toLowerCase());
  let start = 0;
  let end = tokens.length;
  while (start < end && isEdge(tokens[start]!)) start += 1;
  while (end > start && isEdge(tokens[end - 1]!)) end -= 1;
  return tokens.slice(start, end);
}

function unitLabel(unit: NumberUnit, lang: ComposeLangPack): string | undefined {
  if (unit === "percent") return "%";
  if (unit === "times") return lang.timesWords.after[0] ?? "×";
  if (unit === "cur:usd") return "$";
  if (unit === "cur:vnd") return "₫";
  if (unit.startsWith("word:")) return unit.slice(5);
  return undefined;
}

function clauseStart(words: string[], index: number): number {
  for (let i = index - 1; i >= 0; i -= 1) if (CLAUSE_END.test(words[i]!)) return i + 1;
  return 0;
}

function clauseEnd(words: string[], index: number): number {
  for (let i = Math.max(0, index - 1); i < words.length; i += 1) if (CLAUSE_END.test(words[i]!)) return i + 1;
  return words.length;
}

type Label = { text: string; start: number; end: number };

function labelFrom(words: string[], start: number, end: number, lang: ComposeLangPack, side: "before" | "after"): Label | null {
  const raw = words.slice(start, end).map(clean);
  const kept = trimEdges(raw, lang);
  if (kept.length === 0) return null;
  // A long run of words is a sentence, not a label: keep the two words nearest the number.
  const picked = kept.length <= 3 ? kept : side === "before" ? kept.slice(-2) : kept.slice(0, 2);
  const text = picked.join(" ");
  if (!text || text.length > LABEL_MAX_CHARS) return null;
  const first = side === "before" ? raw.lastIndexOf(picked[0]!) : raw.indexOf(picked[0]!);
  return { text, start: start + Math.max(0, first), end };
}

function labelsFor(words: string[], mentions: NumberMention[], items: NumberMention[], lang: ComposeLangPack, side: "before" | "after"): Label[] | null {
  const labels: Label[] = [];
  for (const item of items) {
    const index = mentions.indexOf(item);
    const label = side === "before"
      ? labelFrom(words, Math.max(mentions[index - 1]?.wordEnd ?? 0, clauseStart(words, item.wordStart)), item.wordStart, lang, side)
      : labelFrom(words, item.wordEnd, Math.min(mentions[index + 1]?.wordStart ?? words.length, clauseEnd(words, item.wordEnd)), lang, side);
    if (!label) return null;
    labels.push(label);
  }
  const distinct = new Set(labels.map((label) => label.text.toLowerCase()));
  return distinct.size === labels.length ? labels : null;
}

function titleFrom(words: string[], start: number, end: number, lang: ComposeLangPack): string {
  const kept = trimEdges(words.slice(Math.max(start, 0), Math.max(end, start)).map(clean), lang);
  return kept.slice(0, TITLE_MAX_WORDS).join(" ");
}

function sentenceStart(words: string[], index: number): number {
  for (let i = index - 1; i >= 0; i -= 1) if (/[.!?…]$/u.test(words[i]!)) return i + 1;
  return 0;
}

/** Returns null when the labels are unclear: the rule is skipped rather than showing a guess. */
export function chartForGroup(group: NumberGroup, mentions: NumberMention[], words: string[], lang: ComposeLangPack): ChartPick | null {
  const values = group.items.map((item) => item.value);
  if (values.some((value) => !Number.isFinite(value) || value < 0)) return null;
  const unit = unitLabel(group.unit, lang);
  const base = { kind: "chart" as const, chart: group.chart, values, ...(unit ? { unit } : {}) };
  const opening = sentenceStart(words, group.wordStart);

  if (group.kind === "series") {
    if (values.length < CHART_MIN_ITEMS || values.length > LINE_MAX_POINTS) return null;
    if (group.items.some((item) => item.year === null)) return null;
    return {
      payload: { ...base, title: titleFrom(words, opening, group.wordStart, lang), labels: group.items.map((item) => String(item.year)) },
      wordStart: group.wordStart,
      wordEnd: group.wordEnd,
      firstNumberWord: group.wordStart,
    };
  }

  if (values.length < CHART_MIN_ITEMS || values.length > CHART_MAX_ITEMS) return null;
  if (group.chart === "pie" && values.some((value) => value <= 0)) return null;
  if (group.chart === "bar" && values.every((value) => value === values[0])) return null;
  const items = group.items.map((item) => mentions[item.mentionIndex]!);
  const before = labelsFor(words, mentions, items, lang, "before");
  const labels = before ?? labelsFor(words, mentions, items, lang, "after");
  if (!labels) return null;
  const first = labels[0]!;
  const title = before
    ? titleFrom(words, Math.max(opening, clauseStart(words, first.start)), first.start, lang)
    : titleFrom(words, opening, group.wordStart, lang);
  return {
    payload: { ...base, title, labels: labels.map((label) => label.text) },
    wordStart: before ? Math.min(group.wordStart, first.start) : group.wordStart,
    wordEnd: before ? group.wordEnd : Math.max(group.wordEnd, labels[labels.length - 1]!.end),
    firstNumberWord: group.wordStart,
  };
}

const CHART_RANK: Record<NumberGroup["chart"], number> = { line: 0, pie: 1, bar: 2 };

/**
 * One chart per scene. A series over time tells the most, then shares of a whole, then a plain comparison;
 * among equals the group with more numbers wins, then the earlier one.
 */
export function pickChart(groups: NumberGroup[], mentions: NumberMention[], words: string[], lang: ComposeLangPack): ChartPick | null {
  const ranked = groups
    .map((group) => ({ group, pick: chartForGroup(group, mentions, words, lang) }))
    .filter((item): item is { group: NumberGroup; pick: ChartPick } => item.pick !== null)
    .sort((a, b) => CHART_RANK[a.group.chart] - CHART_RANK[b.group.chart]
      || b.group.items.length - a.group.items.length
      || a.group.wordStart - b.group.wordStart);
  return ranked[0]?.pick ?? null;
}
