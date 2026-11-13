import { KNOWLEDGE_SNAPSHOT, snapshotKnowledge } from "../knowledge/snapshot.js";
import type { PlatformId } from "../schemas/profile.js";
import { MarketPackSchema, type MarketPack } from "./schema.js";

export * from "./schema.js";

const regionNames = new Intl.DisplayNames("vi", { type: "region" });
const platformKeys = {
  youtube: "youtube", tiktok: "tiktok", facebook_reels: "facebook", instagram_reels: "instagram", mock: null,
} as const;

export function marketName(pack: MarketPack): string {
  return pack.name.vi ?? regionNames.of(pack.code) ?? pack.name.en;
}

export function listMarkets(packs = KNOWLEDGE_SNAPSHOT.filter((entry) => entry.kind === "market").map((entry) => MarketPackSchema.parse(entry.value))) {
  return packs.map((pack) => ({ code: pack.code, name: marketName(pack) }))
    .sort((a, b) => a.name.localeCompare(b.name, "vi"));
}

export function marketPack(code: string): MarketPack | null {
  return MarketPackSchema.safeParse(snapshotKnowledge(`market.${code}`)?.value).data ?? null;
}

export function marketPlatform(pack: MarketPack, platform: PlatformId) {
  const key = platformKeys[platform];
  return key ? pack.platforms[key] : undefined;
}

export function marketDefaults(input: string | MarketPack, platforms: readonly PlatformId[] = [], videosPerDay = 1) {
  const pack = typeof input === "string" ? marketPack(input) : input;
  if (!pack) return null;
  const voiceLocale = pack.languages[0]!.code;
  const language = new Intl.Locale(voiceLocale).language;
  const times = platforms.flatMap((platform) => {
    const key = platformKeys[platform];
    return key && pack.platforms[key].available !== false ? pack.bestPostingHours[key] ?? [] : [];
  });
  return {
    language,
    timezone: pack.defaultTimezone,
    publishTimes: times.length ? [...new Set(times)].slice(0, videosPerDay).sort() : null,
    trendSettings: { region: pack.trends.youtubeRegionCode, language },
    voiceLocale,
    guidelinePackId: `market:${pack.code}`,
  };
}

export function marketVoiceLocale(pack: MarketPack | null, language: string): string {
  if (!pack || language.includes("-") || language.includes("_")) return language;
  return pack.languages.find(({ code }) => new Intl.Locale(code).language === language.toLowerCase())?.code ?? language;
}

const dayMs = 86_400_000;
const weekday = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const month = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

function dateInYear(rule: string, year: number): string | null {
  const exact = /^\d{4}-\d{2}-\d{2}$/.test(rule);
  const annual = /^\d{2}-\d{2}$/.test(rule);
  if (exact || annual) {
    const date = exact ? rule : `${year}-${rule}`;
    return date.startsWith(`${year}-`) && Number.isFinite(Date.parse(date)) &&
      new Date(date).toISOString().slice(0, 10) === date ? date : null;
  }
  const pattern = /^(last|[1-5](?:st|nd|rd|th)) ([a-z]+) of ([a-z]+)$/i.exec(rule);
  if (!pattern) return null;
  const [, ordinal, weekdayName, monthName] = pattern.map((value) => value.toLowerCase());
  const m = month.indexOf(monthName);
  const w = weekday.indexOf(weekdayName);
  if (m < 0 || w < 0) return null;
  const anchor = ordinal === "last" ? new Date(Date.UTC(year, m + 1, 0)) : new Date(Date.UTC(year, m, 1));
  const offset = ordinal === "last" ? -((anchor.getUTCDay() - w + 7) % 7)
    : (w - anchor.getUTCDay() + 7) % 7 + (Number(ordinal[0]) - 1) * 7;
  anchor.setUTCDate(anchor.getUTCDate() + offset);
  return anchor.getUTCMonth() === m ? anchor.toISOString().slice(0, 10) : null;
}

export function upcomingEvents(input: string | MarketPack, from: Date, days = 45) {
  const pack = typeof input === "string" ? marketPack(input) : input;
  if (!pack || !Number.isFinite(days) || days < 0 || Number.isNaN(from.getTime())) return [];
  const start = from.toISOString().slice(0, 10);
  const end = new Date(Date.parse(start) + days * dayMs);
  if (Number.isNaN(end.getTime())) return [];
  const last = end.toISOString().slice(0, 10);
  const events: MarketPack["seasonalEvents"] = [];
  for (let year = from.getUTCFullYear(); year <= end.getUTCFullYear(); year++) {
    for (const event of pack.seasonalEvents) {
      const date = dateInYear(event.date, year);
      if (date && date >= start && date <= last) events.push({ ...event, date });
    }
  }
  return events.sort((a, b) => a.date.localeCompare(b.date));
}
