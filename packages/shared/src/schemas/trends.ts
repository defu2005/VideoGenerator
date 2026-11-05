import { z } from "zod";

export const TrendSourceIdSchema = z.enum(["youtube_popular", "wikimedia_top", "rss"]);
export type TrendSourceId = z.infer<typeof TrendSourceIdSchema>;

export const TrendItemSchema = z.object({
  title: z.string().min(1).max(500),
  url: z.string().optional(),
  source: z.string().min(1).max(80),
  score: z.number().nonnegative(),
  publishedAt: z.string().optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).max(30).optional(),
}).strict();
export type TrendItem = z.infer<typeof TrendItemSchema>;

export const TrendUrgencySchema = z.enum(["today", "this_week", "evergreen"]);
export type TrendUrgency = z.infer<typeof TrendUrgencySchema>;

export const TrendIdeaSchema = z.object({
  title: z.string().min(1).max(500),
  angle: z.string().min(1).max(500),
  whyNow: z.string().min(1).max(500),
  sourceTitles: z.array(z.string().min(1)).min(1).max(8),
  urgency: TrendUrgencySchema,
  fitScore: z.number().min(0).max(100),
  sensitive: z.boolean(),
}).strict();
export type TrendIdea = z.infer<typeof TrendIdeaSchema>;

/** Raw LLM output for trendMatch. */
export const TrendMatchOutputSchema = z.object({
  ideas: z.array(TrendIdeaSchema).max(8),
}).strict();
export type TrendMatchOutput = z.infer<typeof TrendMatchOutputSchema>;

const httpUrl = z.string().trim().min(8).max(500).refine((value) => /^https?:\/\//i.test(value), {
  message: "Feed URL must start with http:// or https://",
});

export const ProfileTrendSettingsSchema = z.object({
  youtubePopular: z.boolean().default(false),
  wikimediaTop: z.boolean().default(false),
  rss: z.boolean().default(false),
  region: z.string().trim().min(2).max(8).default("VN"),
  language: z.string().trim().min(2).max(16).default("vi"),
  youtubeCategoryId: z.string().trim().max(8).default(""),
  feeds: z.array(httpUrl).max(20).default([]),
  /** Extra evergreen/meta page titles to drop from Wikimedia (exact, underscores or spaces). */
  metaPages: z.array(z.string().trim().min(1).max(200)).max(100).default([]),
}).strict();
export type ProfileTrendSettings = z.infer<typeof ProfileTrendSettingsSchema>;

export const DEFAULT_PROFILE_TREND_SETTINGS: ProfileTrendSettings = ProfileTrendSettingsSchema.parse({});

export const ProfileTrendSettingsInputSchema = ProfileTrendSettingsSchema.partial();
export type ProfileTrendSettingsInput = z.infer<typeof ProfileTrendSettingsInputSchema>;

export const TrendRefreshResponseSchema = z.object({
  items: z.array(TrendItemSchema).max(200),
  ideas: z.array(TrendIdeaSchema).max(8),
  skipped: z.array(z.object({
    title: z.string(),
    reason: z.string(),
  }).strict()).max(80),
}).strict();
export type TrendRefreshResponse = z.infer<typeof TrendRefreshResponseSchema>;

export const AddTrendTopicBodySchema = z.object({
  idea: TrendIdeaSchema,
}).strict();
export type AddTrendTopicBody = z.infer<typeof AddTrendTopicBodySchema>;

export const TrendIdeaCardSchema = z.object({
  profileId: z.string().uuid(),
  profileName: z.string(),
  title: z.string(),
  angle: z.string(),
  urgency: TrendUrgencySchema,
  fitScore: z.number(),
}).strict();
export type TrendIdeaCard = z.infer<typeof TrendIdeaCardSchema>;

export const TREND_CACHE_TTL_MS = 2 * 60 * 60 * 1000;
export const TREND_USER_AGENT = "VideoAgent/1.0 (local app)";
export const TREND_PREFILTER_LIMIT = 40;
export const TREND_FIT_MIN = 60;
export const TREND_AUTO_APPROVE_MIN = 80;

export function isTrendCacheFresh(fetchedAt: string, now: Date, ttlMs = TREND_CACHE_TTL_MS): boolean {
  const ms = Date.parse(fetchedAt);
  if (Number.isNaN(ms)) return false;
  return now.getTime() - ms < ttlMs;
}
