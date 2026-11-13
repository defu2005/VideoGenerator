import { z } from "zod";

/**
 * Font registry (TASK-106). A style pack names a font by id. A font is usable only when it is
 * in the registry, ships a Vietnamese subset and has the weight as a file.
 *
 * Only Be Vietnam Pro is installed today, and the renderer copies its 400 and 700 files.
 * Adding a family means: a Fontsource package (all OFL), one entry here, and the renderer
 * copying the files it lists. Nothing in the templates changes.
 */

export const FontSpecSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  /** CSS family name used in the templates. */
  css: z.string().min(1),
  /** npm package that holds the woff2 files. */
  pkg: z.string().min(1),
  license: z.string().min(1),
  subsets: z.array(z.string().min(1)).min(1),
  /** Weights that have a file the renderer loads. */
  weights: z.array(z.number().int().min(100).max(900)).min(1),
  role: z.enum(["sans", "serif", "display", "mono"]),
}).strict();
export type FontSpec = z.infer<typeof FontSpecSchema>;

export const FONT_REGISTRY: Record<string, FontSpec> = {
  "be-vietnam-pro": {
    id: "be-vietnam-pro",
    css: "Be Vietnam Pro",
    pkg: "@fontsource/be-vietnam-pro",
    license: "OFL-1.1",
    subsets: ["vietnamese", "latin", "latin-ext"],
    weights: [400, 700],
    role: "sans",
  },
};

export const DEFAULT_FONT_ID = "be-vietnam-pro";

/** Glyphs outside the font fall through to these, in this order. */
export const FONT_FALLBACK_STACK = ['"Noto Sans"', '"Noto Sans CJK SC"', '"Noto Sans Arabic"', '"Noto Sans Devanagari"', '"Noto Sans Thai"', "sans-serif"];

export type FontIssue = { family: string; weight: number; reason: "unknown_family" | "no_vietnamese" | "missing_weight" };

/**
 * The font to really use for a requested family and weight, plus what was wrong with the request.
 * An unknown family or one without Vietnamese falls back to the default font; a missing weight
 * snaps to the nearest weight that has a file.
 */
export function resolveFont(
  ref: { family: string; weight: number },
  registry: Record<string, FontSpec> = FONT_REGISTRY,
): { spec: FontSpec; weight: number; issues: FontIssue[] } {
  const issues: FontIssue[] = [];
  let spec: FontSpec | undefined = registry[ref.family];
  if (!spec) {
    issues.push({ family: ref.family, weight: ref.weight, reason: "unknown_family" });
  } else if (!spec.subsets.includes("vietnamese")) {
    issues.push({ family: ref.family, weight: ref.weight, reason: "no_vietnamese" });
    spec = undefined;
  }
  const used = spec ?? registry[DEFAULT_FONT_ID] ?? FONT_REGISTRY[DEFAULT_FONT_ID]!;
  let weight = ref.weight;
  if (!used.weights.includes(weight)) {
    if (spec) issues.push({ family: ref.family, weight: ref.weight, reason: "missing_weight" });
    weight = used.weights.reduce((best, w) => (Math.abs(w - ref.weight) < Math.abs(best - ref.weight) ? w : best), used.weights[0]!);
  }
  return { spec: used, weight, issues };
}

/** CSS font-family value: the font, then the fallbacks. */
export function fontStack(spec: FontSpec): string {
  return [`"${spec.css}"`, ...FONT_FALLBACK_STACK].join(",");
}
