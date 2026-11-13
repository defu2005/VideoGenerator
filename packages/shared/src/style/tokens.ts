import { z } from "zod";
import { EditPresetIdSchema, SubtitleStyleIdSchema } from "../edit/plan.js";
import { PaletteSeedSchema } from "./palette.js";

/**
 * Style tokens (TASK-106): everything a channel's look is made of, in units that do not depend
 * on the frame size. `resolveStyle` turns them into pixels, seconds and colours for one frame.
 *
 * A layer (genre default, channel pack, per-video override, shot edit) is a `StyleTokensPatch`:
 * any group, and any field inside a group, may be left out to inherit the layer below.
 */

export const ENTRANCES = ["slide", "rise", "scale", "fade"] as const;
export type Entrance = (typeof ENTRANCES)[number];

export const BACKGROUND_TREATMENTS = ["glow", "beam", "shapes", "flat", "grid"] as const;
export type BackgroundTreatment = (typeof BACKGROUND_TREATMENTS)[number];

export const EASE_FAMILIES = ["smooth", "snappy", "bouncy", "gentle"] as const;
export type EaseFamily = (typeof EASE_FAMILIES)[number];

export const LAYOUT_FAMILIES = ["editorial", "centered", "poster", "grid"] as const;
export type LayoutFamily = (typeof LAYOUT_FAMILIES)[number];

export const STYLE_ASPECTS = ["16:9", "9:16", "1:1"] as const;
export type StyleAspect = (typeof STYLE_ASPECTS)[number];

export const SafeZoneSchema = z.object({
  top: z.number().min(0).max(0.45),
  right: z.number().min(0).max(0.45),
  bottom: z.number().min(0).max(0.45),
  left: z.number().min(0).max(0.45),
}).strict();
export type StyleSafeZone = z.infer<typeof SafeZoneSchema>;

const FontRefSchema = z.object({
  /** Id in the font registry (`fonts.ts`). */
  family: z.string().min(1).max(40),
  weight: z.number().int().min(100).max(900),
}).strict();
export type FontRef = z.infer<typeof FontRefSchema>;

const TypeSchema = z.object({
  display: FontRefSchema,
  body: FontRefSchema,
  /** Body size as a share of the frame's short side. `wide` is 16:9 and 1:1, `tall` is 9:16. */
  base: z.object({ wide: z.number().min(0.025).max(0.07), tall: z.number().min(0.025).max(0.07) }).strict(),
  /** Modular scale ratio between steps (sm → md → lg → xl → xxl). */
  ratio: z.number().min(1.1).max(1.6),
  caseDisplay: z.enum(["none", "upper"]),
  /** Letter spacing in em. */
  trackDisplay: z.number().min(-0.04).max(0.12),
  trackCaps: z.number().min(0).max(0.2),
  /** Vietnamese stacked diacritics need room: never below 1.25 for running text, 1.2 for display. */
  lineHeight: z.number().min(1.25).max(1.6),
  lineHeightTight: z.number().min(1.2).max(1.4),
}).strict();

const MotionSchema = z.object({
  /** 1 is today's timing; 2 is twice as fast. */
  speed: z.number().min(0.5).max(2),
  ease: z.enum(EASE_FAMILIES),
  /** Entrance types this channel uses. The variant engine picks among them. */
  entrances: z.array(z.enum(ENTRANCES)).min(1),
  /** Overshoot of emphasis moves (GSAP back amount). 0 turns it off. */
  overshoot: z.number().min(0).max(4),
  /** Entrance travel in body-size units. */
  distance: z.number().min(0).max(3),
  /** Background drift. 0 is a still background, 1 is today's. */
  drift: z.number().min(0).max(2),
}).strict();

const RhythmSchema = z.object({
  preset: EditPresetIdSchema,
  /** Multiplies the preset's shot-length band: below 1 cuts faster. */
  paceScale: z.number().min(0.6).max(1.5),
}).strict();

const LayoutSchema = z.object({
  family: z.enum(LAYOUT_FAMILIES),
  align: z.enum(["start", "center"]),
  /** Multiplies gaps and padding: below 1 is tighter. */
  density: z.number().min(0.7).max(1.4),
  /** 0 is square corners, 1 is a full pill. */
  radius: z.number().min(0).max(1),
  /** Multiplies rule and outline thickness. */
  stroke: z.number().min(0.5).max(3),
}).strict();

const BackgroundSchema = z.object({
  /** Treatments this channel uses. The variant engine picks among them. */
  treatments: z.array(z.enum(BACKGROUND_TREATMENTS)).min(1),
  grain: z.boolean(),
  /** Strength of glows, beams and shapes. 0 leaves the plain ground. */
  intensity: z.number().min(0).max(1.5),
}).strict();

const SubtitlesSchema = z.object({
  style: SubtitleStyleIdSchema,
  uppercase: z.boolean(),
  /** Which palette role highlights the spoken word. */
  highlight: z.enum(["accent", "accent2", "text"]),
}).strict();

const GraphicsSchema = z.object({
  /** Upper share of the runtime that may be full-screen graphics (the variety rule V3). */
  maxShare: z.number().min(0).max(0.6),
}).strict();

const SafeSchema = z.object({ "16:9": SafeZoneSchema, "9:16": SafeZoneSchema, "1:1": SafeZoneSchema }).strict();

export const StyleTokensSchema = z.object({
  palette: PaletteSeedSchema,
  type: TypeSchema,
  motion: MotionSchema,
  rhythm: RhythmSchema,
  layout: LayoutSchema,
  background: BackgroundSchema,
  subtitles: SubtitlesSchema,
  graphics: GraphicsSchema,
  /** Room kept free of graphics: subtitles at the bottom, platform buttons on the right of 9:16. */
  safe: SafeSchema,
  /**
   * Brand consistency band, 0 to 1. At 1 the channel keeps one value on every signature axis
   * (background, entrance); at 0 it may use every value its style allows.
   */
  consistency: z.number().min(0).max(1),
}).strict();
export type StyleTokens = z.infer<typeof StyleTokensSchema>;

export const StyleTokensPatchSchema = z.object({
  palette: PaletteSeedSchema.partial(),
  type: TypeSchema.partial(),
  motion: MotionSchema.partial(),
  rhythm: RhythmSchema.partial(),
  layout: LayoutSchema.partial(),
  background: BackgroundSchema.partial(),
  subtitles: SubtitlesSchema.partial(),
  graphics: GraphicsSchema.partial(),
  safe: SafeSchema.partial(),
  consistency: z.number().min(0).max(1),
}).partial().strict();
export type StyleTokensPatch = z.infer<typeof StyleTokensPatchSchema>;

/** The look the app had before TASK-106. Every layer falls back to it. */
export const BASE_STYLE_TOKENS: StyleTokens = {
  palette: { mode: "dark", brand: "#0F172A", accent: "#F5C518" },
  type: {
    display: { family: "be-vietnam-pro", weight: 700 },
    body: { family: "be-vietnam-pro", weight: 400 },
    base: { wide: 0.042, tall: 0.04 },
    ratio: 1.3,
    caseDisplay: "none",
    trackDisplay: -0.01,
    trackCaps: 0.08,
    lineHeight: 1.3,
    lineHeightTight: 1.22,
  },
  motion: { speed: 1, ease: "smooth", entrances: ["slide"], overshoot: 2.6, distance: 1.2, drift: 1 },
  rhythm: { preset: "calm", paceScale: 1 },
  layout: { family: "editorial", align: "start", density: 1, radius: 0.4, stroke: 1 },
  background: { treatments: ["glow", "beam", "shapes"], grain: true, intensity: 1 },
  subtitles: { style: "karaoke", uppercase: false, highlight: "accent" },
  graphics: { maxShare: 0.3 },
  safe: {
    "16:9": { top: 0.06, right: 0.06, bottom: 0.22, left: 0.06 },
    "9:16": { top: 0.06, right: 0.12, bottom: 0.3, left: 0.06 },
    "1:1": { top: 0.06, right: 0.06, bottom: 0.22, left: 0.06 },
  },
  consistency: 0.6,
};

const GROUPS = ["palette", "type", "motion", "rhythm", "layout", "background", "subtitles", "graphics", "safe"] as const;

/**
 * Applies layers in order: a later layer wins, field by field inside each group. Arrays and
 * nested objects (a font, a safe zone) are replaced whole. `undefined` never overwrites.
 */
export function mergeStyleTokens(base: StyleTokens, ...layers: (StyleTokensPatch | null | undefined)[]): StyleTokens {
  const next = structuredClone(base) as StyleTokens;
  for (const layer of layers) {
    if (!layer) continue;
    for (const group of GROUPS) {
      const patch = layer[group] as Record<string, unknown> | undefined;
      if (!patch) continue;
      const target = next[group] as Record<string, unknown>;
      for (const [key, value] of Object.entries(patch)) {
        if (value !== undefined) target[key] = structuredClone(value);
      }
    }
    if (layer.consistency !== undefined) next.consistency = layer.consistency;
  }
  return StyleTokensSchema.parse(next);
}

/** The fields of `tokens` that differ from `base`, as a patch. Used to store a pack compactly. */
export function diffStyleTokens(base: StyleTokens, tokens: StyleTokens): StyleTokensPatch {
  const patch: Record<string, unknown> = {};
  for (const group of GROUPS) {
    const from = base[group] as Record<string, unknown>;
    const to = tokens[group] as Record<string, unknown>;
    const changed: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(to)) {
      if (JSON.stringify(value) !== JSON.stringify(from[key])) changed[key] = value;
    }
    if (Object.keys(changed).length > 0) patch[group] = changed;
  }
  if (tokens.consistency !== base.consistency) patch.consistency = tokens.consistency;
  return patch as StyleTokensPatch;
}
