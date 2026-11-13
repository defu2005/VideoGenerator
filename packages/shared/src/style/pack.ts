import { z } from "zod";
import { colorDistance, parseHex, relativeLuminance, toHex, type Rgb } from "./color.js";
import { FONT_REGISTRY } from "./fonts.js";
import { BASE_STYLE_TOKENS, mergeStyleTokens, StyleTokensPatchSchema, type LayoutFamily, type StyleTokens, type StyleTokensPatch } from "./tokens.js";

/**
 * A style pack is one channel's look (TASK-106): a named, versioned patch over the base tokens.
 * Every save makes a new version; a video records the id, version and fingerprint it was
 * rendered with, so an old video can be rendered again with the look it had.
 */

export const STYLE_PACK_ORIGINS = ["preset", "choices", "llm", "brand", "manual"] as const;

export const StylePackSchema = z.object({
  schema: z.literal(1),
  id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  name: z.string().trim().min(1).max(60),
  version: z.number().int().min(1),
  origin: z.object({
    kind: z.enum(STYLE_PACK_ORIGINS),
    presetId: z.string().max(40).optional(),
    note: z.string().max(200).optional(),
  }).strict(),
  /** Seeds the channel's home values on signature axes. Defaults to the id; never changes with the version. */
  seed: z.string().max(64).optional(),
  tokens: StyleTokensPatchSchema,
}).strict();
export type StylePack = z.infer<typeof StylePackSchema>;

/** FNV-1a, 32 bits, as 8 hex digits. The same on every machine. */
export function styleHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Full tokens of a pack: the base with the pack's patch on top. */
export function stylePackTokens(pack: Pick<StylePack, "tokens">): StyleTokens {
  return mergeStyleTokens(BASE_STYLE_TOKENS, pack.tokens);
}

/** Identity of the look itself: the same tokens give the same fingerprint, whatever the name or version. */
export function stylePackFingerprint(pack: Pick<StylePack, "tokens">): string {
  const text = canonical(stylePackTokens(pack));
  return styleHash(text) + styleHash(text.split("").reverse().join(""));
}

/** A new version with `patch` applied. Returns the same pack when the look does not change. */
export function reviseStylePack(pack: StylePack, patch: StyleTokensPatch, origin?: StylePack["origin"]): StylePack {
  const tokens = mergePatches(pack.tokens, patch);
  const next: StylePack = { ...pack, tokens, origin: origin ?? pack.origin };
  if (stylePackFingerprint(next) === stylePackFingerprint(pack)) return pack;
  return StylePackSchema.parse({ ...next, version: pack.version + 1 });
}

function mergePatches(base: StyleTokensPatch, patch: StyleTokensPatch): StyleTokensPatch {
  const next = structuredClone(base) as Record<string, unknown>;
  for (const [group, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (group === "consistency") next[group] = value;
    else next[group] = { ...(next[group] as object | undefined), ...structuredClone(value as object) };
  }
  return StyleTokensPatchSchema.parse(next);
}

export type StylePreset = { id: string; nameVi: string; descriptionVi: string; tokens: StyleTokensPatch };

/**
 * Starting points. They are data: a new preset is a new entry, and a channel's pack is a preset
 * plus the user's choices. The looks borrow ideas (not values or code) from the HyperFrames
 * frame presets, Apache-2.0.
 */
export const STYLE_PRESETS: StylePreset[] = [
  {
    id: "classic",
    nameVi: "Cổ điển",
    descriptionVi: "Nền tối, chữ trắng, điểm nhấn vàng. Giao diện từ trước tới nay.",
    tokens: {},
  },
  {
    id: "newsroom",
    nameVi: "Bản tin",
    descriptionVi: "Xanh đậm và đỏ, chữ in hoa, chuyển động dứt khoát, nền kẻ ô.",
    tokens: {
      palette: { mode: "dark", brand: "#0B1F3A", accent: "#FF4D4D" },
      type: { caseDisplay: "upper", trackDisplay: 0.02, ratio: 1.25 },
      motion: { speed: 1.3, ease: "snappy", entrances: ["slide", "fade"], overshoot: 0, distance: 0.8, drift: 0.5 },
      rhythm: { preset: "news", paceScale: 1 },
      layout: { family: "grid", align: "start", density: 0.9, radius: 0.1, stroke: 1.5 },
      background: { treatments: ["grid", "flat"], grain: false, intensity: 0.8 },
      subtitles: { style: "box", uppercase: false, highlight: "accent" },
    },
  },
  {
    id: "paper",
    nameVi: "Trang giấy",
    descriptionVi: "Nền kem sáng, chữ xanh mực, chuyển động chậm, bố cục như trang báo.",
    tokens: {
      palette: { mode: "light", brand: "#F6F1E7", accent: "#C2410C", ink: "#1E293B" },
      type: { ratio: 1.35, trackDisplay: -0.02 },
      motion: { speed: 0.85, ease: "gentle", entrances: ["rise", "fade"], overshoot: 0, distance: 0.7, drift: 0.4 },
      rhythm: { preset: "story", paceScale: 1.1 },
      layout: { family: "editorial", align: "start", density: 1.15, radius: 0.15, stroke: 0.8 },
      background: { treatments: ["flat", "shapes"], grain: true, intensity: 0.6 },
      subtitles: { style: "clean", uppercase: false, highlight: "accent" },
    },
  },
  {
    id: "neon",
    nameVi: "Neon",
    descriptionVi: "Nền tím than, điểm nhấn xanh neon, chữ lớn, chuyển động nảy.",
    tokens: {
      palette: { mode: "dark", brand: "#160B2E", accent: "#39FFB6", accent2: "#FF4FD8" },
      type: { ratio: 1.4, caseDisplay: "upper", trackDisplay: 0 },
      motion: { speed: 1.4, ease: "bouncy", entrances: ["scale", "rise"], overshoot: 3.2, distance: 1.4, drift: 1.4 },
      rhythm: { preset: "energetic", paceScale: 0.9 },
      layout: { family: "poster", align: "center", density: 0.85, radius: 1, stroke: 1.6 },
      background: { treatments: ["shapes", "glow"], grain: false, intensity: 1.3 },
      subtitles: { style: "pop", uppercase: true, highlight: "accent" },
    },
  },
  {
    id: "studio",
    nameVi: "Studio",
    descriptionVi: "Nền xám sáng, một màu nhấn, canh giữa, gọn và ít trang trí.",
    tokens: {
      palette: { mode: "light", brand: "#EEF1F5", accent: "#2563EB", ink: "#0F172A" },
      type: { ratio: 1.3, trackDisplay: -0.015 },
      motion: { speed: 1.1, ease: "smooth", entrances: ["fade", "scale"], overshoot: 1.2, distance: 0.6, drift: 0.3 },
      rhythm: { preset: "calm", paceScale: 1 },
      layout: { family: "centered", align: "center", density: 1.1, radius: 0.6, stroke: 1 },
      background: { treatments: ["flat", "glow"], grain: false, intensity: 0.5 },
      subtitles: { style: "clean", uppercase: false, highlight: "accent" },
    },
  },
];

export function stylePreset(id: string | null | undefined): StylePreset | null {
  return STYLE_PRESETS.find((preset) => preset.id === id) ?? null;
}

const ENERGY: Record<"calm" | "balanced" | "lively", StyleTokensPatch["motion"]> = {
  calm: { speed: 0.85, drift: 0.5 },
  balanced: {},
  lively: { speed: 1.35, drift: 1.3 },
};

/** Path 1: a pack from a few user choices on top of a preset. */
export function stylePackFromChoices(input: {
  id: string;
  name: string;
  presetId?: string;
  brand?: string;
  accent?: string;
  mode?: "dark" | "light";
  energy?: "calm" | "balanced" | "lively";
  layout?: LayoutFamily;
}): StylePack {
  const preset = stylePreset(input.presetId) ?? STYLE_PRESETS[0]!;
  const palette: NonNullable<StyleTokensPatch["palette"]> = { ...preset.tokens.palette };
  if (parseHex(input.brand)) palette.brand = toHex(parseHex(input.brand)!);
  if (parseHex(input.accent)) palette.accent = toHex(parseHex(input.accent)!);
  if (input.mode && input.mode !== palette.mode) {
    palette.mode = input.mode;
    // The preset's ink belongs to the other mode.
    delete palette.ink;
  }
  const tokens: StyleTokensPatch = {
    ...structuredClone(preset.tokens),
    ...(Object.keys(palette).length ? { palette } : {}),
    ...(input.energy && input.energy !== "balanced" ? { motion: { ...preset.tokens.motion, ...ENERGY[input.energy] } } : {}),
    ...(input.layout ? { layout: { ...preset.tokens.layout, family: input.layout } } : {}),
  };
  return StylePackSchema.parse({
    schema: 1,
    id: input.id,
    name: input.name,
    version: 1,
    origin: { kind: "choices", presetId: preset.id },
    tokens,
  });
}

/**
 * Path 2: a pack from an LLM proposal. The proposal is only data: each group is validated on its
 * own, a group that does not parse is dropped (and listed), and unknown fonts are removed so the
 * base font stays. The caller shows `dropped` to the user before saving.
 */
export function stylePackFromProposal(raw: unknown, meta: { id: string; name: string; note?: string }): { pack: StylePack; dropped: string[] } {
  const dropped: string[] = [];
  const tokens: Record<string, unknown> = {};
  const record = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  for (const [group, schema] of Object.entries(StyleTokensPatchSchema.shape)) {
    if (record[group] === undefined) continue;
    const parsed = schema.safeParse(record[group]);
    if (parsed.success && parsed.data !== undefined) tokens[group] = parsed.data;
    else dropped.push(group);
  }
  for (const key of Object.keys(record)) {
    if (!(key in StyleTokensPatchSchema.shape)) dropped.push(key);
  }
  const type = tokens.type as { display?: { family: string }; body?: { family: string } } | undefined;
  for (const slot of ["display", "body"] as const) {
    const family = type?.[slot]?.family;
    if (type && family && !FONT_REGISTRY[family]) {
      delete type[slot];
      dropped.push(`type.${slot}`);
    }
  }
  const palette = tokens.palette as { mode?: string; brand?: string } | undefined;
  if (palette?.brand && !palette.mode) palette.mode = relativeLuminance(parseHex(palette.brand)!) > 0.35 ? "light" : "dark";
  const pack = StylePackSchema.parse({
    schema: 1,
    id: meta.id,
    name: meta.name,
    version: 1,
    origin: { kind: "llm", ...(meta.note ? { note: meta.note.slice(0, 200) } : {}) },
    tokens,
  });
  return { pack, dropped };
}

function chroma(rgb: Rgb): number {
  return (Math.max(...rgb) - Math.min(...rgb)) / 255;
}

/**
 * Path 3: a pack from colours already used by a channel (one brand colour, or the dominant
 * colours of its thumbnails, most frequent first). The first colour becomes the ground; the
 * accent is the most saturated colour that is far enough from it. Contrast is fixed later by
 * `resolvePalette`, so any input is safe.
 */
export function stylePackFromBrand(input: { id: string; name: string; colors: string[]; presetId?: string }): StylePack {
  const colors = input.colors.map(parseHex).filter((c): c is Rgb => c !== null);
  const preset = stylePreset(input.presetId) ?? STYLE_PRESETS[0]!;
  if (colors.length === 0) {
    return StylePackSchema.parse({ schema: 1, id: input.id, name: input.name, version: 1, origin: { kind: "brand", presetId: preset.id }, tokens: preset.tokens });
  }
  const brand = colors[0]!;
  const brandHex = toHex(brand);
  const mode = relativeLuminance(brand) > 0.35 ? "light" : "dark";
  const rest = colors.slice(1).filter((c) => colorDistance(toHex(c), brandHex) >= 0.15);
  rest.sort((a, b) => chroma(b) * colorDistance(toHex(b), brandHex) - chroma(a) * colorDistance(toHex(a), brandHex));
  const accent = rest[0];
  const palette: NonNullable<StyleTokensPatch["palette"]> = { mode, brand: brandHex };
  if (accent) palette.accent = toHex(accent);
  else if (preset.tokens.palette?.accent) palette.accent = preset.tokens.palette.accent;
  if (rest[1]) palette.accent2 = toHex(rest[1]);
  return StylePackSchema.parse({
    schema: 1,
    id: input.id,
    name: input.name,
    version: 1,
    origin: { kind: "brand", presetId: preset.id },
    tokens: { ...structuredClone(preset.tokens), palette },
  });
}
