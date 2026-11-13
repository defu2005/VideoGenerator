import type { AspectRatio, ProjectSettings } from "../index.js";

export const PLATFORM_PRESETS = {
  youtube: {
    aspectRatio: "16:9",
    durationSec: 180,
    minDurationSec: 60,
    maxDurationSec: 1800,
    sceneDurationSec: 7,
    subtitleChars: 42,
  },
  youtube_shorts: {
    aspectRatio: "9:16",
    durationSec: 50,
    minDurationSec: 15,
    maxDurationSec: 60,
    sceneDurationSec: 3,
    subtitleChars: 18,
  },
  tiktok: {
    aspectRatio: "9:16",
    durationSec: 45,
    minDurationSec: 15,
    maxDurationSec: 180,
    sceneDurationSec: 3,
    subtitleChars: 18,
  },
  facebook_reels: {
    aspectRatio: "9:16",
    durationSec: 45,
    minDurationSec: 15,
    maxDurationSec: 90,
    sceneDurationSec: 3,
    subtitleChars: 42,
  },
  custom: {
    aspectRatio: "16:9",
    durationSec: 120,
    minDurationSec: 30,
    maxDurationSec: 1800,
    sceneDurationSec: 6,
    subtitleChars: 42,
  },
} as const satisfies Record<string, {
  aspectRatio: AspectRatio;
  durationSec: number;
  minDurationSec: number;
  maxDurationSec: number;
  sceneDurationSec: number;
  subtitleChars: number;
}>;

export const STYLE_KEYWORDS = [
  { style: "documentary", keywords: ["lịch sử", "history", /\b1[0-9]{3}\b/, /\b20[0-9]{2}\b/, "chiến tranh", "war"] },
  { style: "explainer", keywords: ["cách", "làm sao", "là gì", "vì sao", "tại sao", "how to", "what is", "why"] },
  { style: "listicle", keywords: [/top\s+\d+/, /\d+\s+(?:dieu|cach|su that)/, /\d+\s+things/] },
  { style: "news", keywords: ["tin", "news", "mới nhất"] },
] as const;

export const TONE_BY_STYLE = {
  documentary: "serious",
  explainer: "neutral",
  storytelling: "dramatic",
  listicle: "inspiring",
  news: "neutral",
} as const;

export const WORDS_PER_MINUTE_BY_LANGUAGE: Record<string, number> = {
  vi: 160,
  en: 150,
};

export const DEFAULT_BRIEF_VALUES = {
  budget: { mode: "BALANCED" },
  platform: "youtube",
  style: "storytelling",
  tone: "dramatic",
  audience: "general",
  language: "en",
  targetDurationSec: 180,
  aspectRatio: "16:9",
  wordsPerMinute: 150,
  sceneDurationSec: 7,
  visualStyle: "mixed",
  subtitles: { enabled: true, maxCharsPerLine: 42 },
  music: { enabled: true, volume: 0.15 },
} as const;

export type PlatformPreset = typeof PLATFORM_PRESETS[keyof typeof PLATFORM_PRESETS];
export type BriefSettings = Pick<ProjectSettings,
  | "budget"
  | "platform"
  | "style"
  | "tone"
  | "audience"
  | "language"
  | "targetDurationSec"
  | "aspectRatio"
  | "wordsPerMinute"
  | "sceneDurationSec"
  | "visualStyle"
  | "subtitles"
  | "music"
  | "userSet"
  | "edit"
  | "motionGraphics"
  | "format"
>;
