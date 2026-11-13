import { quoteWords, type RenderTarget, type Shot, type StylePack } from "@vg/shared";
import { styleForShot, type VideoGraphicStyle } from "./graphicStyle.js";
import { prepareMapGeo } from "./mapGeo.js";

/** Pure helpers that turn a graphic shot into template variables (TASK-067b part 2). */

type Rgb = [number, number, number];

const DEFAULT_BRAND = "#0F172A";
const DEFAULT_ACCENT = "#F5C518";
const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];
/** Text contrast the guide asks for. */
export const MIN_CONTRAST = 4.5;
/** The base tone is held to a stricter value, because glows and shapes lighten it a little. */
const BASE_CONTRAST = 5.2;
/** Every animation is over this long before the shot ends. */
export const END_HOLD_SEC = 0.2;
/** The longest entrance tween in the templates. */
const ENTER_SEC = 0.4;

function parseHex(value: string | undefined): Rgb | null {
  const hex = (value ?? "").trim().replace(/^#/, "");
  const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as Rgb;
}

function toHex(rgb: Rgb): string {
  return "#" + rgb.map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0")).join("").toUpperCase();
}

function mix(a: Rgb, b: Rgb, amount: number): Rgb {
  return a.map((n, i) => n + ((b[i] ?? 0) - n) * amount) as Rgb;
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((n) => {
    const s = n / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(parseHex(a) ?? BLACK);
  const lb = luminance(parseHex(b) ?? BLACK);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export type GraphicColors = {
  bg: string;
  bgLight: string;
  bgDark: string;
  text: string;
  accent: string;
  muted: string;
  series: string[];
};

/**
 * White text on the brand colour. A brand colour that is too light is darkened (hue kept)
 * until white reads at ≥ 4.5:1 on the lightest background tone; the accent is lightened the same way.
 */
export function graphicColors(brandColor?: string, accentColor?: string): GraphicColors {
  let bg = parseHex(brandColor) ?? parseHex(DEFAULT_BRAND)!;
  const light = (c: Rgb) => mix(c, WHITE, 0.08);
  const ratio = (a: Rgb, b: Rgb) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
  for (let i = 0; i < 60 && ratio(WHITE, light(bg)) < BASE_CONTRAST; i++) bg = mix(bg, BLACK, 0.08);
  const bgLight = light(bg);
  let accent = parseHex(accentColor) ?? parseHex(DEFAULT_ACCENT)!;
  for (let i = 0; i < 60 && ratio(accent, bgLight) < MIN_CONTRAST; i++) accent = mix(accent, WHITE, 0.1);
  const muted = mix(WHITE, bg, 0.42);
  return {
    bg: toHex(bg),
    bgLight: toHex(bgLight),
    bgDark: toHex(mix(bg, BLACK, 0.45)),
    text: toHex(WHITE),
    accent: toHex(accent),
    muted: toHex(muted),
    series: [accent, WHITE, mix(accent, bg, 0.45), muted, mix(accent, WHITE, 0.55), mix(WHITE, bg, 0.68)].map(toHex),
  };
}

/** `hash(projectId + shotId) % 3`, FNV-1a so it is the same on every machine. */
export function graphicVariant(projectId: string | undefined, shotId: string): 0 | 1 | 2 {
  let hash = 0x811c9dc5;
  for (const ch of `${projectId ?? ""}${shotId}`) {
    hash ^= ch.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return (hash % 3) as 0 | 1 | 2;
}

export type SafeZone = { top: number; right: number; bottom: number; left: number };

/** Fractions of the frame that stay free: subtitles at the bottom, platform buttons on the right of 9:16. */
export function graphicSafeZone(target: Pick<RenderTarget, "width" | "height">): { safe: SafeZone; maxLines: number } {
  const portrait = target.height > target.width;
  return {
    safe: { top: 0.06, left: 0.06, right: portrait ? 0.12 : 0.06, bottom: portrait ? 0.3 : 0.22 },
    maxLines: portrait ? 3 : 2,
  };
}

/**
 * Shot-relative start time of every word. Uses `wordTimes` when it matches the words,
 * otherwise spreads the words evenly. Always leaves room for the entrance and the end hold.
 */
export function kineticWordTimes(count: number, durationSec: number, wordTimes?: number[]): number[] {
  const last = Math.max(0, durationSec - END_HOLD_SEC - ENTER_SEC);
  const valid = wordTimes && wordTimes.length === count && wordTimes.every((t) => Number.isFinite(t) && t >= 0);
  if (valid) {
    const first = wordTimes[0] ?? 0;
    let prev = 0;
    // The first word opens the shot, so the frame is never empty while the voice is already speaking.
    return wordTimes.map((t) => (prev = Math.max(prev, Math.min(last, t - first))));
  }
  const spread = Math.min(last, durationSec * 0.6);
  return Array.from({ length: count }, (_, i) => (count <= 1 ? 0 : (i / (count - 1)) * spread));
}

function legacyStyle(source: object): string | undefined {
  const value = (source as { style?: unknown }).style;
  return typeof value === "string" ? value : undefined;
}

/** Keeps a string `style` (kinetic, compare) on `shotStyle` so the token object can use `style`. */
function deliver(body: Record<string, unknown>, source: object): Record<string, unknown> {
  const shotStyle = legacyStyle(source);
  return shotStyle ? { ...body, shotStyle } : body;
}

export function graphicVariables(
  shot: Shot,
  durationSec: number,
  target: Pick<RenderTarget, "width" | "height">,
  ctx: {
    brandColor?: string;
    accentColor?: string;
    projectId?: string;
    profileId?: string | null;
    recipeId?: string | null;
    language?: string;
    grain?: boolean;
    stylePack?: StylePack | null;
    videoStyle?: VideoGraphicStyle;
  },
): Record<string, unknown> {
  const colors = graphicColors(ctx.brandColor, ctx.accentColor);
  // Always present, so a tokens-v1 template never has to invent a look.
  // A missing video plan resolves this shot alone: genre + brand pack, or the base tokens.
  const style = styleForShot(shot, target, ctx);
  const common = {
    safe: { top: style.safe.top, right: style.safe.right, bottom: style.safe.bottom, left: style.safe.left },
    maxLines: style.maxLines,
    colors,
    brandColor: colors.bg,
    accentColor: colors.accent,
    variant: graphicVariant(ctx.projectId, shot.id),
    durationSec,
    language: ctx.language ?? "vi",
    ...(ctx.grain === false ? { grain: false } : ctx.grain === true ? { grain: true } : {}),
    style,
  };
  if (shot.source.kind === "chart") return deliver({ ...shot.source, ...common }, shot.source);
  if (shot.source.kind === "map") {
    const prepared = prepareMapGeo(shot.source);
    const { geo: _geo, pin: _pin, ...source } = shot.source;
    return deliver({ ...source, geo: prepared.geo, ...(prepared.pin ? { pin: prepared.pin } : {}), ...common }, source);
  }
  if (shot.source.kind === "compare") return deliver({ ...shot.source, ...common }, shot.source);
  if (shot.source.kind === "quote_full") {
    const texts = quoteWords(shot.source.quote);
    const times = kineticWordTimes(texts.length, durationSec, shot.source.wordTimes);
    const words = texts.map((text, index) => ({ text, t: Math.round((times[index] ?? 0) * 1000) / 1000 }));
    const { wordTimes: _wordTimes, ...source } = shot.source;
    return deliver({ ...source, words, ...common }, source);
  }
  if (shot.source.kind === "list_full") {
    const { wordTimes: _wordTimes, ...source } = shot.source;
    return deliver({ ...source, ...common }, source);
  }
  if (shot.source.kind !== "kinetic_text") return common;
  const { wordTimes, ...source } = shot.source;
  const texts = source.lines.join(" ").split(/\s+/).filter(Boolean);
  const times = kineticWordTimes(texts.length, durationSec, wordTimes);
  const words = texts.map((text, index) => ({ text, t: Math.round((times[index] ?? 0) * 1000) / 1000 }));
  return deliver({ ...source, words, ...common }, source);
}
