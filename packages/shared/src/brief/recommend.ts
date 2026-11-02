import type { AutonomyMode, ProjectSettings } from "../index.js";
import {
  DEFAULT_BRIEF_VALUES,
  PLATFORM_PRESETS,
  STYLE_KEYWORDS,
  TONE_BY_STYLE,
  WORDS_PER_MINUTE_BY_LANGUAGE,
  type BriefSettings,
} from "./presets.js";
import { detectLanguage } from "./detectLanguage.js";

export type Recommendation = {
  value: unknown;
  reason: string;
  source: "user" | "recommended";
};

export type ResolvedBrief = {
  title: string;
  mode: AutonomyMode;
  settings: BriefSettings;
};

export type RecommendBriefInput = {
  topic: string;
  title?: string;
  description?: string;
  mode?: AutonomyMode;
  settings?: Omit<Partial<ProjectSettings>, "subtitles" | "music"> & {
    subtitles?: Partial<ProjectSettings["subtitles"]>;
    music?: Partial<ProjectSettings["music"]>;
  };
};

export type RecommendBriefResult = {
  values: ResolvedBrief;
  recommendations: Record<string, Recommendation>;
  warnings: string[];
};

function normalizeText(text: string): string {
  return text.toLocaleLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d");
}

function topicTitle(topic: string): string {
  const trimmed = topic.trim();
  if (trimmed.length <= 80) return trimmed.charAt(0).toLocaleUpperCase() + trimmed.slice(1);
  const shortened = trimmed.slice(0, 80).replace(/\s+\S*$/, "").trim();
  return `${shortened || trimmed.slice(0, 80).trimEnd()}`;
}

function matchedStyle(text: string): { style: keyof typeof TONE_BY_STYLE; reason: string } {
  const normalized = normalizeText(text);
  for (const group of STYLE_KEYWORDS) {
    for (const keyword of group.keywords) {
      const matcher = typeof keyword === "string" ? normalizeText(keyword) : keyword;
      const match = normalized.match(matcher);
      if (match) {
        const label = typeof keyword === "string" ? keyword : match[0];
        return { style: group.style, reason: `Matched keyword "${label}"` };
      }
    }
  }
  return { style: "storytelling", reason: "No style keyword matched; using storytelling" };
}

export function recommendBrief(input: RecommendBriefInput): RecommendBriefResult {
  const provided = input.settings ?? {};
  const inferredUserSet = [
    ...(input.title === undefined ? [] : ["title"]),
    ...Object.keys(provided).filter((field) => field !== "userSet" && field !== "subtitles" && field !== "music"),
    ...Object.keys(provided.subtitles ?? {}).map((field) => `subtitles.${field}`),
    ...Object.keys(provided.music ?? {}).map((field) => `music.${field}`),
  ];
  const userSet = new Set(provided.userSet ?? inferredUserSet);
  const recommendations: Record<string, Recommendation> = {};
  const warnings: string[] = [];
  const values: ResolvedBrief = {
    title: input.title?.trim() || topicTitle(input.topic),
    mode: input.mode ?? "ASSISTED" as const,
    settings: {
      platform: DEFAULT_BRIEF_VALUES.platform,
      style: DEFAULT_BRIEF_VALUES.style,
      tone: DEFAULT_BRIEF_VALUES.tone,
      audience: DEFAULT_BRIEF_VALUES.audience,
      language: DEFAULT_BRIEF_VALUES.language,
      targetDurationSec: DEFAULT_BRIEF_VALUES.targetDurationSec,
      aspectRatio: DEFAULT_BRIEF_VALUES.aspectRatio,
      wordsPerMinute: DEFAULT_BRIEF_VALUES.wordsPerMinute,
      sceneDurationSec: DEFAULT_BRIEF_VALUES.sceneDurationSec,
      visualStyle: DEFAULT_BRIEF_VALUES.visualStyle,
      subtitles: { ...DEFAULT_BRIEF_VALUES.subtitles },
      music: { ...DEFAULT_BRIEF_VALUES.music },
      userSet: [...userSet],
    },
  };

  function resolve<T>(path: string, value: T | undefined, recommendation: T, reason: string): T {
    const isUser = userSet.has(path);
    const resolved = isUser && value !== undefined ? value : recommendation;
    recommendations[path] = {
      value: resolved,
      reason: isUser ? "Set by user" : reason,
      source: isUser ? "user" : "recommended",
    };
    return resolved;
  }

  const text = `${input.topic}\n${input.description ?? ""}`;
  const detected = detectLanguage(text);
  const language = resolve("language", provided.language, detected.language, detected.reason);
  const aspectWasSet = userSet.has("aspectRatio");
  const platformDefault = aspectWasSet && provided.aspectRatio === "9:16" ? "youtube_shorts" : "youtube";
  const platform = resolve("platform", provided.platform, platformDefault,
    platformDefault === "youtube_shorts" ? "Inferred from your 9:16 aspect ratio" : "Default platform");
  const preset = PLATFORM_PRESETS[platform];
  const styleResult = matchedStyle(input.topic);
  const style = resolve("style", provided.style, styleResult.style, styleResult.reason);
  const tone = resolve("tone", provided.tone, TONE_BY_STYLE[style], `Default tone for ${style}`);

  const normalizedTopic = normalizeText(input.topic);
  const audienceDefault = /tre em|kids/.test(normalizedTopic)
    ? "kids"
    : /sinh vien|hoc sinh|students/.test(normalizedTopic)
      ? "students"
      : "general";
  const audienceReason = audienceDefault === "general"
    ? "No audience keyword matched; using general"
    : `Matched audience keyword for ${audienceDefault}`;
  const audience = resolve("audience", provided.audience, audienceDefault, audienceReason);

  const platformDuration = preset.durationSec;
  const targetDurationSec = resolve("targetDurationSec", provided.targetDurationSec, platformDuration,
    `Default duration for ${platform.replaceAll("_", " ")}`);
  if (targetDurationSec < preset.minDurationSec || targetDurationSec > preset.maxDurationSec) {
    warnings.push(
      `Duration ${targetDurationSec}s is outside the ${platform.replaceAll("_", " ")} range (${preset.minDurationSec}-${preset.maxDurationSec}s); the user value was kept.`,
    );
  }

  const aspectRatio = resolve("aspectRatio", provided.aspectRatio, preset.aspectRatio,
    `Default aspect ratio for ${platform.replaceAll("_", " ")}`);
  const sceneDurationSec = resolve("sceneDurationSec", provided.sceneDurationSec, preset.sceneDurationSec,
    `Default scene duration for ${platform.replaceAll("_", " ")}`);
  const subtitleEnabled = resolve("subtitles.enabled", provided.subtitles?.enabled, true, "Subtitles are enabled by default");
  const subtitleMaxChars = resolve("subtitles.maxCharsPerLine", provided.subtitles?.maxCharsPerLine,
    preset.subtitleChars, `Default subtitle line length for ${platform.replaceAll("_", " ")}`);
  const wordsDefault = (WORDS_PER_MINUTE_BY_LANGUAGE[language] ?? 150) - (audience === "kids" ? 15 : 0);
  const wordsPerMinute = resolve("wordsPerMinute", provided.wordsPerMinute, wordsDefault,
    audience === "kids" ? `Default ${language} speaking pace, reduced for kids` : `Default speaking pace for ${language}`);
  const visualDefault = style === "documentary" || style === "news"
    ? "photo"
    : audience === "kids" ? "illustration" : "mixed";
  const visualStyle = resolve("visualStyle", provided.visualStyle, visualDefault, `Default visual style for ${style} and ${audience}`);
  const musicEnabled = resolve("music.enabled", provided.music?.enabled, true, "Music is enabled by default");
  const musicVolume = resolve("music.volume", provided.music?.volume, style === "news" ? 0.08 : 0.15,
    style === "news" ? "Lower background volume for news" : "Default background music volume");
  const title = resolve("title", input.title, topicTitle(input.topic), "Derived from the topic");

  values.title = title;
  values.settings = {
    platform,
    style,
    tone,
    audience,
    language,
    targetDurationSec,
    aspectRatio,
    wordsPerMinute,
    sceneDurationSec,
    visualStyle,
    subtitles: { enabled: subtitleEnabled, maxCharsPerLine: subtitleMaxChars },
    music: { enabled: musicEnabled, volume: musicVolume },
    userSet: [...userSet],
  };

  return { values, recommendations, warnings };
}
