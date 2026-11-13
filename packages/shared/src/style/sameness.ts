import { z } from "zod";
import { hamming, hexToHash, PHASH_NEAR_MAX } from "../visuals/phash.js";
import { colorDistance } from "./color.js";
import type { VariantPick } from "./picker.js";
import type { ResolvedStyle } from "./resolve.js";

/**
 * Visual sameness (TASK-106): how alike two videos look, from data the render already has.
 *
 * - combos: which template variants were on screen, weighted by seconds;
 * - frames: dHash of frames sampled from the finished video (64 bits each, layout-level);
 * - kinds: the share of each shot kind;
 * - style: palette, fonts, layout family, background and motion of the two looks.
 *
 * Inside one channel the style is meant to match, so it is left out there. Between channels
 * of the same user it carries the most weight. All scores are 0 (nothing in common) to 1.
 */

const Hex16 = z.string().regex(/^[0-9a-f]{16}$/i);

export const VideoLookSchema = z.object({
  videoId: z.string().min(1),
  channelId: z.string().min(1),
  createdAt: z.string(),
  style: z.object({
    packId: z.string().nullable(),
    packVersion: z.number().int().nullable(),
    fingerprint: z.string(),
    /** bg, accent, text. */
    palette: z.array(z.string()).max(6),
    fonts: z.array(z.string()).max(4),
    layout: z.string(),
    ease: z.string(),
    caseDisplay: z.string(),
    backgrounds: z.array(z.string()),
  }).strict(),
  combos: z.array(z.object({ templateId: z.string().min(1), key: z.string(), sec: z.number().nonnegative() }).strict()),
  kindShare: z.record(z.string(), z.number().min(0).max(1)),
  frameHashes: z.array(Hex16).max(64),
}).strict();
export type VideoLook = z.infer<typeof VideoLookSchema>;

/** Builds the record a finished render stores. `shotSec` maps a shot id to its seconds on screen. */
export function buildVideoLook(input: {
  videoId: string;
  channelId: string;
  createdAt: string;
  style: ResolvedStyle;
  picks: VariantPick[];
  shotSec: Record<string, number>;
  kindShare: Record<string, number>;
  frameHashes: string[];
}): VideoLook {
  const backgrounds = [...new Set(input.picks.map((pick) => pick.axes.background).filter((value): value is string => Boolean(value)))].sort();
  return VideoLookSchema.parse({
    videoId: input.videoId,
    channelId: input.channelId,
    createdAt: input.createdAt,
    style: {
      packId: input.style.packId,
      packVersion: input.style.packVersion,
      fingerprint: input.style.fingerprint,
      palette: [input.style.color.bg, input.style.color.accent, input.style.color.text],
      fonts: [input.style.font.display.id, input.style.font.body.id],
      layout: input.style.layout.family,
      ease: input.style.tokens.motion.ease,
      caseDisplay: input.style.type.caseDisplay,
      backgrounds,
    },
    combos: input.picks.map((pick) => ({ templateId: pick.templateId, key: pick.key, sec: Math.max(0, input.shotSec[pick.shotId] ?? 0) })),
    kindShare: input.kindShare,
    frameHashes: input.frameHashes.slice(0, 64),
  });
}

function weights(look: VideoLook): Map<string, number> {
  const map = new Map<string, number>();
  for (const combo of look.combos) {
    const id = `${combo.templateId}|${combo.key}`;
    // A combination with no recorded time still counts a little.
    map.set(id, (map.get(id) ?? 0) + Math.max(combo.sec, 0.1));
  }
  return map;
}

/** Weighted Jaccard of the template variants on screen. Null when neither video has graphics. */
export function comboSimilarity(a: VideoLook, b: VideoLook): number | null {
  const wa = weights(a);
  const wb = weights(b);
  if (wa.size === 0 && wb.size === 0) return null;
  const total = (map: Map<string, number>) => [...map.values()].reduce((sum, value) => sum + value, 0) || 1;
  const ta = total(wa);
  const tb = total(wb);
  let min = 0;
  let max = 0;
  for (const id of new Set([...wa.keys(), ...wb.keys()])) {
    const x = (wa.get(id) ?? 0) / ta;
    const y = (wb.get(id) ?? 0) / tb;
    min += Math.min(x, y);
    max += Math.max(x, y);
  }
  return max > 0 ? min / max : 0;
}

/** 1 minus the total variation distance of the shot-kind shares. */
export function kindSimilarity(a: VideoLook, b: VideoLook): number {
  const kinds = new Set([...Object.keys(a.kindShare), ...Object.keys(b.kindShare)]);
  let diff = 0;
  for (const kind of kinds) diff += Math.abs((a.kindShare[kind] ?? 0) - (b.kindShare[kind] ?? 0));
  return Math.max(0, 1 - diff / 2);
}

function matchShare(from: string[], to: string[], max: number): number {
  const others = to.map(hexToHash);
  let hit = 0;
  for (const hex of from) {
    const hash = hexToHash(hex);
    if (others.some((other) => hamming(hash, other) <= max)) hit += 1;
  }
  return hit / from.length;
}

/**
 * Share of sampled frames that have a near-identical frame in the other video, averaged both
 * ways. dHash is coarse, so two frames with the same layout and different words match: that is
 * the sameness a viewer and a platform reviewer see. Null when either video has no frames.
 */
export function frameSimilarity(a: VideoLook, b: VideoLook, max = PHASH_NEAR_MAX): number | null {
  if (a.frameHashes.length === 0 || b.frameHashes.length === 0) return null;
  return (matchShare(a.frameHashes, b.frameHashes, max) + matchShare(b.frameHashes, a.frameHashes, max)) / 2;
}

function jaccard(a: string[], b: string[]): number {
  const left = new Set(a);
  const right = new Set(b);
  const union = new Set([...left, ...right]);
  if (union.size === 0) return 1;
  return [...left].filter((value) => right.has(value)).length / union.size;
}

/** How alike two looks are as designs: palette 0.5, fonts 0.15, layout 0.15, backgrounds 0.1, motion 0.05, case 0.05. */
export function styleSimilarity(a: VideoLook["style"], b: VideoLook["style"]): number {
  if (a.fingerprint && a.fingerprint === b.fingerprint) return 1;
  const count = Math.max(a.palette.length, b.palette.length);
  let palette = 0;
  for (let i = 0; i < count; i += 1) {
    // A colour distance of 0.35 or more reads as a different colour.
    palette += a.palette[i] && b.palette[i] ? Math.max(0, 1 - colorDistance(a.palette[i]!, b.palette[i]!) / 0.35) : 0;
  }
  palette = count > 0 ? palette / count : 1;
  return 0.5 * palette
    + 0.15 * jaccard(a.fonts, b.fonts)
    + 0.15 * (a.layout === b.layout ? 1 : 0)
    + 0.1 * jaccard(a.backgrounds, b.backgrounds)
    + 0.05 * (a.ease === b.ease ? 1 : 0)
    + 0.05 * (a.caseDisplay === b.caseDisplay ? 1 : 0);
}

export type SamenessParts = { combos: number | null; frames: number | null; kinds: number; style: number };

const WEIGHTS = {
  /** Same channel: the style is supposed to match, so it is not counted. */
  channel: { combos: 0.45, frames: 0.4, kinds: 0.15, style: 0 },
  /** Two channels of one user: the same look is the main sign of mass production. */
  cross: { combos: 0.2, frames: 0.3, kinds: 0.1, style: 0.4 },
} as const;

/** One score for two videos. Parts without evidence drop out and the rest is rescaled. */
export function visualSameness(a: VideoLook, b: VideoLook, scope: "channel" | "cross"): { score: number; parts: SamenessParts } {
  const parts: SamenessParts = {
    combos: comboSimilarity(a, b),
    frames: frameSimilarity(a, b),
    kinds: kindSimilarity(a, b),
    style: styleSimilarity(a.style, b.style),
  };
  const w = WEIGHTS[scope];
  let sum = 0;
  let total = 0;
  for (const key of ["combos", "frames", "kinds", "style"] as const) {
    const value = parts[key];
    if (value === null || w[key] === 0) continue;
    sum += w[key] * value;
    total += w[key];
  }
  return { score: total > 0 ? sum / total : 0, parts };
}

export const VisualSamenessSettingsSchema = z.object({
  /** A new video this close to one earlier video of its channel is flagged. */
  maxChannelSameness: z.number().min(0).max(1).default(0.85),
  /** Typical closeness to another channel's recent videos that is flagged. */
  maxCrossChannelSameness: z.number().min(0).max(1).default(0.7),
  /** Earlier videos compared per channel. */
  window: z.number().int().min(1).max(50).default(10),
}).strict();
export type VisualSamenessSettings = z.infer<typeof VisualSamenessSettingsSchema>;
export const DEFAULT_VISUAL_SAMENESS_SETTINGS = VisualSamenessSettingsSchema.parse({});

export type VisualSamenessScores = {
  /** Closest earlier video of the same channel. */
  channel: { videoId: string; similarity: number } | null;
  /** Mean closeness to the channel's earlier videos. */
  channelMean: number | null;
  /** The other channel this video looks most like (median over that channel's recent videos). */
  crossChannel: { channelId: string; similarity: number } | null;
  comparedVideos: number;
};

function median(values: number[]): number {
  const sorted = [...values].sort((x, y) => x - y);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Compares a video with earlier ones. `earlier` may hold videos of any channel of the same
 * user, newest first; the video itself is skipped.
 */
export function compareVisualSameness(current: VideoLook, earlier: VideoLook[], settings: VisualSamenessSettings = DEFAULT_VISUAL_SAMENESS_SETTINGS): VisualSamenessScores {
  const others = earlier.filter((look) => look.videoId !== current.videoId);
  const own = others.filter((look) => look.channelId === current.channelId).slice(0, settings.window);
  let channel: VisualSamenessScores["channel"] = null;
  const ownScores: number[] = [];
  for (const look of own) {
    const { score } = visualSameness(current, look, "channel");
    ownScores.push(score);
    if (!channel || score > channel.similarity) channel = { videoId: look.videoId, similarity: score };
  }
  const byChannel = new Map<string, VideoLook[]>();
  for (const look of others) {
    if (look.channelId === current.channelId) continue;
    const list = byChannel.get(look.channelId) ?? [];
    if (list.length < settings.window) list.push(look);
    byChannel.set(look.channelId, list);
  }
  let crossChannel: VisualSamenessScores["crossChannel"] = null;
  let compared = own.length;
  for (const [channelId, looks] of byChannel) {
    compared += looks.length;
    const similarity = median(looks.map((look) => visualSameness(current, look, "cross").score));
    if (!crossChannel || similarity > crossChannel.similarity) crossChannel = { channelId, similarity };
  }
  return {
    channel,
    channelMean: ownScores.length ? ownScores.reduce((sum, value) => sum + value, 0) / ownScores.length : null,
    crossChannel,
    comparedVideos: compared,
  };
}

/** Same shape as `OriginalityIssue` in originality/checks.ts, so the report can append these. */
export function visualSamenessIssues(scores: VisualSamenessScores, settings: VisualSamenessSettings = DEFAULT_VISUAL_SAMENESS_SETTINGS): { ruleId: string; text: string }[] {
  const issues: { ruleId: string; text: string }[] = [];
  const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
  if (scores.channel && scores.channel.similarity > settings.maxChannelSameness) {
    issues.push({
      ruleId: "ORIG_VISUAL_SAME_CHANNEL",
      text: `Hình ảnh giống video trước của kênh (${scores.channel.videoId}) ${pct(scores.channel.similarity)}, vượt ngưỡng nội bộ ${pct(settings.maxChannelSameness)}. Đổi biến thể hoặc bố cục của vài cảnh đồ hoạ.`,
    });
  }
  if (scores.crossChannel && scores.crossChannel.similarity > settings.maxCrossChannelSameness) {
    issues.push({
      ruleId: "ORIG_VISUAL_CROSS_CHANNEL",
      text: `Giao diện giống kênh khác của bạn (${scores.crossChannel.channelId}) ${pct(scores.crossChannel.similarity)}, vượt ngưỡng nội bộ ${pct(settings.maxCrossChannelSameness)}. Hai kênh nên có style pack khác nhau.`,
    });
  }
  return issues;
}
