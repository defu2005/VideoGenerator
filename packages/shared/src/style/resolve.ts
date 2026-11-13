import { fontStack, resolveFont, type FontIssue, type FontSpec } from "./fonts.js";
import { checkPalette, resolvePalette, type ContrastIssue, type PaletteRoles } from "./palette.js";
import { stylePackFingerprint, type StylePack } from "./pack.js";
import {
  BASE_STYLE_TOKENS,
  mergeStyleTokens,
  type BackgroundTreatment,
  type EaseFamily,
  type Entrance,
  type StyleAspect,
  type StyleSafeZone,
  type StyleTokens,
  type StyleTokensPatch,
} from "./tokens.js";

/**
 * Token resolver (TASK-106). Layers are applied in this order, later wins:
 *
 *   base → genre default → channel pack → per-video override → shot edit
 *
 * The result holds concrete values for one frame size: pixels, seconds, hex colours and GSAP
 * ease names. Templates read these and nothing else.
 */

export type StyleLayers = {
  /** `GenrePack.style`. */
  genre?: StyleTokensPatch | null;
  /** The channel's pack. */
  pack?: Pick<StylePack, "id" | "version" | "tokens" | "seed"> | null;
  /** Saved on the project: this video only. */
  video?: StyleTokensPatch | null;
  /** Saved on a shot the user edited. */
  shot?: StyleTokensPatch | null;
};

export type StyleFrame = { width: number; height: number };

const EASES: Record<EaseFamily, { enter: string; move: string; exit: string }> = {
  smooth: { enter: "power3.out", move: "power2.out", exit: "power2.in" },
  snappy: { enter: "expo.out", move: "power4.out", exit: "power3.in" },
  bouncy: { enter: "back.out(1.7)", move: "power3.out", exit: "power2.in" },
  gentle: { enter: "sine.out", move: "sine.inOut", exit: "sine.in" },
};

export type ResolvedStyle = {
  v: 1;
  packId: string | null;
  packVersion: number | null;
  /** Identity of the merged tokens; goes into cache keys and the video's look record. */
  fingerprint: string;
  aspect: StyleAspect;
  tokens: StyleTokens;
  color: PaletteRoles;
  font: {
    display: { family: string; weight: number; id: string };
    body: { family: string; weight: number; id: string };
  };
  /** Sizes in px for this frame. */
  type: {
    xs: number; sm: number; md: number; lg: number; xl: number; xxl: number;
    lineHeight: number; lineHeightTight: number;
    trackDisplay: number; trackCaps: number;
    caseDisplay: "none" | "upper";
  };
  /** Durations in seconds, eases as GSAP names, distance in px. */
  motion: {
    fast: number; base: number; slow: number;
    enter: string; move: string; exit: string; emphasis: string;
    entrances: Entrance[];
    distance: number;
    drift: number;
  };
  layout: { family: StyleTokens["layout"]["family"]; align: "start" | "center"; density: number; radius: number; stroke: number };
  /** Spacing unit in px (the body size times the density). */
  space: number;
  background: { treatments: BackgroundTreatment[]; grain: boolean; intensity: number };
  safe: StyleSafeZone;
  maxLines: number;
  issues: { contrast: ContrastIssue[]; fonts: FontIssue[] };
};

export function styleAspect(frame: StyleFrame): StyleAspect {
  const ratio = frame.width / Math.max(1, frame.height);
  if (ratio > 1.2) return "16:9";
  if (ratio < 0.84) return "9:16";
  return "1:1";
}

/** Merged tokens of the layers, without resolving them for a frame. */
export function layeredTokens(layers: StyleLayers): StyleTokens {
  return mergeStyleTokens(BASE_STYLE_TOKENS, layers.genre, layers.pack?.tokens, layers.video, layers.shot);
}

const round = (value: number, digits = 3) => Math.round(value * 10 ** digits) / 10 ** digits;

export function resolveStyle(layers: StyleLayers, frame: StyleFrame, fonts?: Record<string, FontSpec>): ResolvedStyle {
  const tokens = layeredTokens(layers);
  const aspect = styleAspect(frame);
  const tall = aspect === "9:16";
  const color = resolvePalette(tokens.palette);
  const display = resolveFont(tokens.type.display, fonts);
  const body = resolveFont(tokens.type.body, fonts);
  const short = Math.min(frame.width, frame.height);
  const base = short * (tall ? tokens.type.base.tall : tokens.type.base.wide);
  const step = (n: number) => Math.round(base * tokens.type.ratio ** n);
  const ease = EASES[tokens.motion.ease];
  const speed = tokens.motion.speed;
  return {
    v: 1,
    packId: layers.pack?.id ?? null,
    packVersion: layers.pack?.version ?? null,
    fingerprint: stylePackFingerprint({ tokens }),
    aspect,
    tokens,
    color,
    font: {
      display: { family: fontStack(display.spec), weight: display.weight, id: display.spec.id },
      body: { family: fontStack(body.spec), weight: body.weight, id: body.spec.id },
    },
    type: {
      xs: step(-1), sm: step(0), md: step(1), lg: step(2), xl: step(3), xxl: step(4),
      lineHeight: tokens.type.lineHeight,
      lineHeightTight: tokens.type.lineHeightTight,
      trackDisplay: tokens.type.trackDisplay,
      trackCaps: tokens.type.trackCaps,
      caseDisplay: tokens.type.caseDisplay,
    },
    motion: {
      fast: round(0.25 / speed),
      base: round(0.32 / speed),
      slow: round(0.45 / speed),
      enter: ease.enter,
      move: ease.move,
      exit: ease.exit,
      emphasis: tokens.motion.overshoot > 0 ? `back.out(${round(tokens.motion.overshoot, 2)})` : ease.enter,
      entrances: [...tokens.motion.entrances],
      distance: Math.round(base * tokens.motion.distance),
      drift: tokens.motion.drift,
    },
    layout: { ...tokens.layout },
    space: Math.round(base * tokens.layout.density),
    background: { treatments: [...tokens.background.treatments], grain: tokens.background.grain, intensity: tokens.background.intensity },
    safe: { ...tokens.safe[aspect] },
    maxLines: tall ? 3 : 2,
    issues: { contrast: checkPalette(color), fonts: [...display.issues, ...body.issues] },
  };
}

/**
 * What a template receives as `variables.style`: the resolved values plus the variant the
 * picker chose for this shot. The token source and the issue list stay on the server.
 */
export type TemplateStyle = Omit<ResolvedStyle, "tokens" | "issues"> & { axes: Record<string, string> };

export function templateStyle(resolved: ResolvedStyle, axes: Record<string, string> = {}): TemplateStyle {
  const { tokens: _tokens, issues: _issues, ...rest } = resolved;
  return { ...rest, axes: { ...axes } };
}

/** Shot-length band multiplier and edit preset the pacing code should use for this style. */
export function styleRhythm(tokens: StyleTokens): { preset: StyleTokens["rhythm"]["preset"]; paceScale: number } {
  return { preset: tokens.rhythm.preset, paceScale: tokens.rhythm.paceScale };
}
