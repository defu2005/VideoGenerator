import { z } from "zod";
import { GuidelineRuleSchema } from "../guidelines/schema.js";

export const MarketCodeSchema = z.string().regex(/^[A-Z]{2}$/);
const text = z.string().trim().min(1);
const url = z.url({ protocol: /^https?$/ });
const timezone = text.refine((zone) => {
  try { new Intl.DateTimeFormat("vi", { timeZone: zone }); return true; }
  catch { return false; }
}, "Múi giờ IANA không hợp lệ.");
const postingHours = z.array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)).nullable();
const platform = z.object({ available: z.boolean().nullable(), note: z.string().optional() });
const rpmRange = z.tuple([z.number().nonnegative(), z.number().nonnegative()])
  .refine(([min, max]) => min <= max).nullable();

export const MarketPackSchema = z.looseObject({
  code: MarketCodeSchema,
  name: z.object({ en: text, vi: text.nullish() }),
  languages: z.array(z.object({ code: text.refine((code) => {
    try { new Intl.Locale(code); return true; }
    catch { return false; }
  }), share: text })).min(1),
  timezones: z.array(timezone).min(1),
  defaultTimezone: timezone,
  currency: z.string().regex(/^[A-Z]{3}$/),
  platforms: z.object({ youtube: platform, tiktok: platform, facebook: platform, instagram: platform }),
  monetization: z.record(z.string(), z.union([z.boolean(), text, z.null()])),
  rpmUsd: z.object({ youtubeLong: rpmRange, youtubeShorts: rpmRange, estimate: z.literal(true) }),
  bestPostingHours: z.object({
    youtube: postingHours, tiktok: postingHours, facebook: postingHours, instagram: postingHours, estimate: z.literal(true),
  }),
  trends: z.object({ youtubeRegionCode: MarketCodeSchema.nullable(), wikipediaProject: text.nullable(), rssSuggestions: z.array(url) }),
  tts: z.object({
    edge: z.array(text).nullable(), google: text.nullable(), elevenlabs: text.nullable(),
    openai: text.nullable(), piper: z.array(text).nullable(),
  }),
  rules: z.array(GuidelineRuleSchema.extend({ source: url })).max(40),
  sensitiveTopics: z.array(text),
  seasonalEvents: z.array(z.object({ name: text, date: text, type: text })),
  formats: z.object({ decimal: z.string().min(1), thousands: z.string(), date: text, measurement: z.enum(["metric", "imperial", "mixed"]) }),
  sources: z.array(url).min(1),
  checkedAt: z.iso.date(),
  watch: z.array(z.object({ url, kind: z.enum(["policy_page", "changelog", "rss", "api_revision"]) })).optional(),
  volatility: z.record(z.string(), z.enum(["stable", "yearly", "quarterly", "monthly", "weekly"])).optional(),
});

export type MarketPack = z.infer<typeof MarketPackSchema>;

export const MarketDefaultFieldSchema = z.enum(["language", "timezone", "publishTimes", "trendSettings.region", "trendSettings.language"]);
export type MarketDefaultField = z.infer<typeof MarketDefaultFieldSchema>;
export const ApplyMarketDefaultsSchema = z.object({
  code: MarketCodeSchema,
  fields: z.array(MarketDefaultFieldSchema).max(MarketDefaultFieldSchema.options.length),
  previewToken: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict();
