import { z } from "zod";
import { BLACK, contrastRatio, mixRgb, parseHex, pushContrast, toHex, WHITE, type Rgb, contrastRgb } from "./color.js";

/**
 * Palette seeds and roles (TASK-106). A pack stores a few seed colours; templates only see
 * the roles, and every role pair that carries text or a readable shape is contrast-checked.
 */

const Hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/);

export const PaletteSeedSchema = z.object({
  /** dark = light ink on a dark ground (today's look). light = dark ink on a light ground. */
  mode: z.enum(["dark", "light"]),
  brand: Hex,
  accent: Hex,
  accent2: Hex.optional(),
  /** Ink colour for text. Default white on dark, near-black on light. */
  ink: Hex.optional(),
}).strict();
export type PaletteSeed = z.infer<typeof PaletteSeedSchema>;

export type PaletteRoles = {
  mode: "dark" | "light";
  /** Main ground. */
  bg: string;
  /** Raised tone: one step towards the ink. */
  bgAlt: string;
  /** Recessed tone: away from the ink. Also the text colour on an accent fill. */
  bgDeep: string;
  text: string;
  textMuted: string;
  accent: string;
  onAccent: string;
  accent2: string;
  positive: string;
  negative: string;
  series: string[];
};

/** Body text on the ground. */
export const TEXT_CONTRAST = 4.5;
/** The base tone is held higher, because glows and shapes shift it a little. */
export const BASE_CONTRAST = 5.2;
/** Shapes, icons and large secondary text (WCAG 1.4.11). */
export const SHAPE_CONTRAST = 3;

/** An ink this far from black (dark mode) or white (light mode) leaves room for every other role. */
const INK_CONTRAST = 12;

const DEFAULT_INK = { dark: WHITE, light: [17, 24, 39] as Rgb };
const POSITIVE: Rgb = [34, 197, 94];
const NEGATIVE: Rgb = [239, 68, 68];

/**
 * Seeds to roles. The ground moves away from the ink until text reads at ≥ 5.2:1 on the raised
 * tone; accents move towards the ink until they read at ≥ 4.5:1. Hue is kept, only lightness shifts.
 * For mode "dark" with a white ink this is exactly the TASK-067b `graphicColors` result.
 */
export function resolvePalette(seed: PaletteSeed): PaletteRoles {
  const dark = seed.mode === "dark";
  const away = dark ? BLACK : WHITE;
  // A custom ink must itself be light (or dark) enough to carry text: 12:1 against the far end.
  const ink = pushContrast(parseHex(seed.ink) ?? DEFAULT_INK[seed.mode], away, INK_CONTRAST, dark ? WHITE : BLACK, 0.1);
  const raise = (c: Rgb) => mixRgb(c, ink, 0.08);
  let bg = parseHex(seed.brand) ?? (dark ? [15, 23, 42] : [248, 250, 252]) as Rgb;
  for (let i = 0; i < 60 && contrastRgb(ink, raise(bg)) < BASE_CONTRAST; i += 1) bg = mixRgb(bg, away, 0.08);
  const bgAlt = raise(bg);
  const accent = pushContrast(parseHex(seed.accent) ?? [245, 197, 24], bgAlt, TEXT_CONTRAST, ink, 0.1);
  const muted = pushContrast(mixRgb(ink, bg, 0.42), bg, SHAPE_CONTRAST, ink, 0.1);
  const accent2 = seed.accent2
    ? pushContrast(parseHex(seed.accent2) ?? accent, bgAlt, SHAPE_CONTRAST, ink, 0.1)
    : mixRgb(accent, ink, 0.55);
  return {
    mode: seed.mode,
    bg: toHex(bg),
    bgAlt: toHex(bgAlt),
    bgDeep: toHex(mixRgb(bg, away, 0.45)),
    text: toHex(ink),
    textMuted: toHex(muted),
    accent: toHex(accent),
    onAccent: toHex(mixRgb(bg, away, 0.45)),
    accent2: toHex(accent2),
    positive: toHex(pushContrast(POSITIVE, bgAlt, SHAPE_CONTRAST, ink, 0.1)),
    negative: toHex(pushContrast(NEGATIVE, bgAlt, SHAPE_CONTRAST, ink, 0.1)),
    series: [accent, ink, mixRgb(accent, bg, 0.45), muted, mixRgb(accent, ink, 0.55), mixRgb(ink, bg, 0.68)].map(toHex),
  };
}

export type ContrastIssue = { pair: string; ratio: number; min: number };

const PAIRS: { fg: keyof PaletteRoles; bg: keyof PaletteRoles; min: number }[] = [
  { fg: "text", bg: "bg", min: TEXT_CONTRAST },
  { fg: "text", bg: "bgAlt", min: TEXT_CONTRAST },
  { fg: "text", bg: "bgDeep", min: TEXT_CONTRAST },
  { fg: "textMuted", bg: "bg", min: SHAPE_CONTRAST },
  { fg: "accent", bg: "bg", min: TEXT_CONTRAST },
  { fg: "accent", bg: "bgAlt", min: TEXT_CONTRAST },
  { fg: "onAccent", bg: "accent", min: TEXT_CONTRAST },
  { fg: "accent2", bg: "bgAlt", min: SHAPE_CONTRAST },
  { fg: "positive", bg: "bgAlt", min: SHAPE_CONTRAST },
  { fg: "negative", bg: "bgAlt", min: SHAPE_CONTRAST },
];

/** Role pairs below their minimum contrast. Empty for every palette `resolvePalette` returns. */
export function checkPalette(roles: PaletteRoles): ContrastIssue[] {
  const issues: ContrastIssue[] = [];
  for (const pair of PAIRS) {
    const ratio = contrastRatio(String(roles[pair.fg]), String(roles[pair.bg]));
    // Hex rounding can cost a few thousandths.
    if (ratio < pair.min - 0.05) issues.push({ pair: `${pair.fg}/${pair.bg}`, ratio: Math.round(ratio * 100) / 100, min: pair.min });
  }
  return issues;
}
