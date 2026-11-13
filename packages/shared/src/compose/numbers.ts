import type { ComposeLangPack } from "./lang/types.js";

export type NumberUnit = "percent" | "times" | "year" | "count" | `cur:${string}` | `word:${string}`;

export type NumberMention = {
  value: number;
  unit: NumberUnit;
  raw: string;
  wordStart: number;
  wordEnd: number;
};

export type NumberGroup = {
  kind: "series" | "shares" | "same_unit";
  chart: "line" | "pie" | "bar";
  unit: NumberUnit;
  items: { value: number; mentionIndex: number; year: number | null }[];
  wordStart: number;
  wordEnd: number;
};

const TRAIL = /[,.!?;:)\]}]+$/u;
const SENTENCE_END = /[.!?…]$/u;

function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/gi, "d").toLowerCase();
}

function stripTrail(token: string): string {
  return token.replace(TRAIL, "");
}

function lookup(words: Record<string, number> | string[], token: string): string | undefined {
  const key = fold(stripTrail(token));
  const list = Array.isArray(words) ? words : Object.keys(words);
  return list.find((item) => fold(item) === key);
}

function scaleOf(lang: ComposeLangPack, token: string): number | undefined {
  const key = lookup(lang.scaleWords, token);
  return key === undefined ? undefined : lang.scaleWords[key];
}

function phraseAt(words: string[], index: number, phrases: string[]): string | null {
  const ranked = phrases.toSorted((a, b) => b.split(" ").length - a.split(" ").length);
  for (const phrase of ranked) {
    const parts = phrase.split(" ");
    const got = words.slice(index, index + parts.length).map((token) => fold(stripTrail(token)));
    if (got.length === parts.length && got.join(" ") === parts.map((part) => fold(part)).join(" ")) return phrase;
  }
  return null;
}

function parseLocalized(text: string, lang: ComposeLangPack): number | null {
  if (/^\d{1,3}(?:[.,]\d{3}){2,}$/.test(text)) return Number(text.replace(/[.,]/g, ""));
  const dot = text.includes(".");
  const comma = text.includes(",");
  if (dot && comma) {
    const normalized = text.split(lang.thousandSep).join("").replace(lang.decimalSep, ".");
    const value = Number(normalized);
    return Number.isFinite(value) ? value : null;
  }
  if (dot || comma) {
    const sep = dot ? "." : ",";
    const parts = text.split(sep);
    if (sep === lang.thousandSep && parts.slice(1).every((part) => part.length === 3)) return Number(parts.join(""));
    if (parts.length === 2 && sep === lang.decimalSep) {
      const value = Number(`${parts[0]}.${parts[1]}`);
      return Number.isFinite(value) ? value : null;
    }
    return null;
  }
  if (/^\d+$/.test(text)) return Number(text);
  return null;
}

type TokenNumber = { value: number; percent: boolean; times: boolean; currency: "usd" | "vnd" | null };

function currencyWord(token: string): "usd" | "vnd" | null {
  const raw = stripTrail(token);
  if (raw === "$") return "usd";
  if (raw === "đ" || raw === "₫") return "vnd";
  const key = fold(raw);
  if (["usd", "do", "dollar", "dollars"].includes(key)) return "usd";
  if (["vnd", "dong"].includes(key)) return "vnd";
  return null;
}

function parseNumericToken(token: string, lang: ComposeLangPack): TokenNumber | null {
  let body = stripTrail(token);
  if (!body) return null;
  let currency: "usd" | "vnd" | null = null;
  if (body.startsWith("$")) {
    currency = "usd";
    body = body.slice(1);
  } else if (body.startsWith("₫") || body.startsWith("đ")) {
    currency = "vnd";
    body = body.slice(1);
  }
  let percent = false;
  let times = false;
  let mult = 1;
  if (body.endsWith("%")) {
    percent = true;
    body = body.slice(0, -1);
  } else if (/x$/i.test(body) && /\d/.test(body.slice(0, -1))) {
    times = true;
    body = body.slice(0, -1);
  } else {
    const suffixes = Object.keys(lang.scaleWords).filter((key) => /^[a-z]+$/i.test(key)).toSorted((a, b) => b.length - a.length);
    const lower = body.toLowerCase();
    const suffix = suffixes.find((key) => lower.endsWith(key.toLowerCase()) && /\d/.test(lower.slice(0, -key.length)));
    if (suffix) {
      mult = lang.scaleWords[suffix] ?? 1;
      body = body.slice(0, -suffix.length);
    }
  }
  if (body.endsWith("$")) {
    currency = "usd";
    body = body.slice(0, -1);
  } else if (body.endsWith("₫") || body.endsWith("đ")) {
    currency = "vnd";
    body = body.slice(0, -1);
  }
  const value = parseLocalized(body, lang);
  if (value === null) return null;
  return { value: value * mult, percent, times, currency };
}

function isPlainWord(token: string, lang: ComposeLangPack): boolean {
  const clean = stripTrail(token);
  if (!/^[\p{L}]+$/u.test(clean)) return false;
  if (scaleOf(lang, clean) !== undefined) return false;
  if (phraseAt([clean], 0, lang.percentWords)) return false;
  if (phraseAt([clean], 0, lang.timesWords.before) || phraseAt([clean], 0, lang.timesWords.after)) return false;
  if (currencyWord(clean)) return false;
  if (phraseAt([clean], 0, lang.yearMarkers)) return false;
  return true;
}

function isYearValue(value: number, scaled: boolean): boolean {
  return !scaled && Number.isInteger(value) && value >= 1900 && value <= 2100;
}

export function parseNumbers(words: string[], lang: ComposeLangPack): NumberMention[] {
  const mentions: NumberMention[] = [];
  let index = 0;
  while (index < words.length) {
    const parsed = parseNumericToken(words[index] ?? "", lang);
    if (!parsed) {
      index += 1;
      continue;
    }
    let start = index;
    let end = index + 1;
    let value = parsed.value;
    let scaled = false;
    const nextScale = scaleOf(lang, words[end] ?? "");
    if (nextScale !== undefined) {
      value *= nextScale;
      scaled = true;
      end += 1;
    }
    let unit: NumberUnit = "count";
    const percentPhrase = phraseAt(words, end, lang.percentWords);
    if (parsed.percent || percentPhrase) {
      unit = "percent";
      if (percentPhrase) end += percentPhrase.split(" ").length;
    } else if (parsed.times) {
      unit = "times";
    } else {
      const before = start > 0 ? fold(stripTrail(words[start - 1] ?? "")) : "";
      const afterPhrase = phraseAt(words, end, lang.timesWords.after);
      const beforeTimes = lang.timesWords.before.some((word) => fold(word) === before);
      if (beforeTimes && afterPhrase) {
        start -= 1;
        end += afterPhrase.split(" ").length;
        unit = "times";
      } else if (afterPhrase) {
        end += afterPhrase.split(" ").length;
        unit = "times";
      }
    }
    if (unit === "count") {
      const leading = start > 0 ? currencyWord(words[start - 1] ?? "") : null;
      const trailing = currencyWord(words[end] ?? "");
      const currency = parsed.currency ?? trailing ?? leading;
      if (currency) {
        unit = `cur:${currency}`;
        if (trailing) end += 1;
        else if (leading) start -= 1;
      }
    }
    if (unit === "count") {
      const marker = start > 0 && lang.yearMarkers.some((word) => fold(word) === fold(stripTrail(words[start - 1] ?? "")));
      // A clause mark after the number ("120 tỷ, quý hai…") ends it: the next word is not its unit.
      const clauseEnds = /[,.!?;:…]$/u.test(words[end - 1] ?? "");
      const followedByWord = !clauseEnds && isPlainWord(words[end] ?? "", lang);
      if (marker && isYearValue(value, scaled)) {
        start -= 1;
        unit = "year";
      } else if (followedByWord) {
        unit = `word:${stripTrail(words[end] ?? "").toLowerCase()}`;
        end += 1;
      } else if (isYearValue(value, scaled)) {
        unit = "year";
      }
    }
    mentions.push({
      value,
      unit,
      raw: words.slice(start, end).join(" "),
      wordStart: start,
      wordEnd: end,
    });
    index = end;
  }
  return mentions;
}

function clauseOf(mentions: NumberMention[]): NumberMention[][] {
  const clauses: NumberMention[][] = [];
  let current: NumberMention[] = [];
  for (const mention of mentions) {
    current.push(mention);
    if (SENTENCE_END.test(mention.raw.trim())) {
      clauses.push(current);
      current = [];
    }
  }
  if (current.length) clauses.push(current);
  return clauses;
}

function groupSpan(items: NumberMention[]): { wordStart: number; wordEnd: number } {
  return {
    wordStart: Math.min(...items.map((item) => item.wordStart)),
    wordEnd: Math.max(...items.map((item) => item.wordEnd)),
  };
}

export function comparableGroups(mentions: NumberMention[]): NumberGroup[] {
  const used = new Set<number>();
  const groups: NumberGroup[] = [];
  const indexOf = new Map(mentions.map((mention, index) => [mention, index]));

  for (const clause of clauseOf(mentions)) {
    const pairs: { year: NumberMention; value: NumberMention }[] = [];
    const taken = new Set<NumberMention>();
    const years = clause.filter((mention) => mention.unit === "year");
    for (let yearIndex = 0; yearIndex < years.length; yearIndex += 1) {
      const year = years[yearIndex]!;
      const nextYear = years[yearIndex + 1];
      const after = clause.find((mention) =>
        mention.wordStart >= year.wordEnd
        && (!nextYear || mention.wordStart < nextYear.wordStart)
        && mention.unit !== "year"
        && !taken.has(mention));
      const before = [...clause].reverse().find((mention) =>
        mention.wordEnd <= year.wordStart
        && mention.unit !== "year"
        && !taken.has(mention));
      // "2 million in 2020 and 5 million in 2023": when the clause opens with a value, each value sits before its year.
      const value = clause[0]?.unit !== "year" ? before ?? after : after ?? before;
      if (!value) continue;
      taken.add(year);
      taken.add(value);
      pairs.push({ year, value });
    }
    const sameUnit = pairs.length >= 2 && pairs.every((pair) => pair.value.unit === pairs[0]!.value.unit);
    const increasing = pairs.every((pair, index) => index === 0 || pair.year.value > pairs[index - 1]!.year.value);
    if (sameUnit && increasing) {
      const members = pairs.flatMap((pair) => [pair.year, pair.value]);
      for (const member of members) used.add(indexOf.get(member)!);
      groups.push({
        kind: "series",
        chart: "line",
        unit: pairs[0]!.value.unit,
        items: pairs.map((pair) => ({
          value: pair.value.value,
          mentionIndex: indexOf.get(pair.value)!,
          year: pair.year.value,
        })),
        ...groupSpan(members),
      });
    }
  }

  const percents = mentions.filter((mention, index) => mention.unit === "percent" && !used.has(index));
  const percentSum = percents.reduce((sum, mention) => sum + mention.value, 0);
  if (percents.length >= 2 && percentSum >= 95 && percentSum <= 105) {
    percents.forEach((mention) => used.add(indexOf.get(mention)!));
    groups.push({
      kind: "shares",
      chart: "pie",
      unit: "percent",
      items: percents.map((mention) => ({ value: mention.value, mentionIndex: indexOf.get(mention)!, year: null })),
      ...groupSpan(percents),
    });
  }

  let run: NumberMention[] = [];
  const flush = () => {
    if (run.length >= 2) {
      groups.push({
        kind: "same_unit",
        chart: "bar",
        unit: run[0]!.unit,
        items: run.map((mention) => ({ value: mention.value, mentionIndex: indexOf.get(mention)!, year: null })),
        ...groupSpan(run),
      });
      run.forEach((mention) => used.add(indexOf.get(mention)!));
    }
    run = [];
  };
  mentions.forEach((mention, index) => {
    if (used.has(index) || mention.unit === "year") {
      flush();
      return;
    }
    if (run.length > 0 && run[0]!.unit !== mention.unit) flush();
    if (!used.has(index)) run.push(mention);
  });
  flush();
  return groups;
}

export function startsWithOrdinal(words: string[], lang: ComposeLangPack): boolean {
  const first = words[0]?.trim() ?? "";
  if (/^\d{1,3}[.)]$/.test(first)) return true;
  const cleaned = words.slice(0, 3).map((word) => fold(stripTrail(word)));
  const phrases = new Set(lang.ordinals.map((item) => item.split(" ").map((part) => fold(part)).join(" ")));
  for (let size = Math.min(3, cleaned.length); size >= 1; size -= 1) {
    if (phrases.has(cleaned.slice(0, size).join(" "))) return true;
  }
  return false;
}

export function findContrastWord(words: string[], lang: ComposeLangPack): { word: string; index: number } | null {
  const phrases = lang.contrastWords.toSorted((a, b) => b.split(" ").length - a.split(" ").length);
  for (let index = 0; index < words.length; index += 1) {
    for (const phrase of phrases) {
      const parts = phrase.split(" ");
      const slice = words.slice(index, index + parts.length);
      if (slice.length !== parts.length) continue;
      const got = slice.map((token) => fold(stripTrail(token))).join(" ");
      if (got !== parts.map((part) => fold(part)).join(" ")) continue;
      return { word: slice.map((token) => stripTrail(token).toLowerCase()).join(" "), index };
    }
  }
  return null;
}
