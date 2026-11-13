import { z } from "zod";
import { styleHash } from "./pack.js";
import { BACKGROUND_TREATMENTS, ENTRANCES, LAYOUT_FAMILIES, STYLE_ASPECTS, type StyleAspect, type StyleTokens } from "./tokens.js";

/**
 * Template manifests and variation axes (TASK-106).
 *
 * A template declares what can vary (its axes) and where it came from (attribution). The
 * variant engine reads only the manifest, so a new template, ours or imported, needs no
 * change in the picker, the director or the renderer.
 */

export const AXIS_ROLES = ["layout", "composition", "motion", "background", "content"] as const;
export type AxisRole = (typeof AXIS_ROLES)[number];

const Slug = z.string().regex(/^[a-z0-9_]+$/).max(40);

export const TemplateAxisSchema = z.object({
  id: Slug,
  role: z.enum(AXIS_ROLES),
  values: z.array(z.object({
    id: Slug,
    /** Layout families this value suits. Left out: suits all. */
    families: z.array(z.enum(LAYOUT_FAMILIES)).min(1).optional(),
    /** Aspect ratios this value works in. Left out: all. */
    aspects: z.array(z.enum(STYLE_ASPECTS)).min(1).optional(),
  }).strict()).min(1),
  /** The allowed values come from this token list (and are kept in its order). */
  tokenList: z.enum(["motion.entrances", "background.treatments"]).optional(),
  /** Part of the channel's identity: held inside the pack's consistency band. */
  signature: z.boolean().default(false),
  /** The same axis in every template (drawn by the shared runtime), so a channel's home values match across templates. */
  shared: z.boolean().default(false),
  /** Field of the shot source that already holds this choice when the director or the user set it. */
  sourceField: z.string().max(40).optional(),
}).strict();
export type TemplateAxis = z.infer<typeof TemplateAxisSchema>;

export const PERMISSIVE_LICENSES = ["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "0BSD", "CC0-1.0"] as const;

export const TemplateAttributionSchema = z.object({
  origin: z.enum(["own", "third_party"]),
  name: z.string().max(80).optional(),
  author: z.string().max(80).optional(),
  /** SPDX id. */
  license: z.string().max(40).optional(),
  sourceUrl: z.string().url().optional(),
  commit: z.string().max(64).optional(),
}).strict();

export const TemplateManifestSchema = z.object({
  /** Folder name under `apps/server/assets/compose/`. */
  id: Slug,
  /** Shot kind this template renders. */
  kind: Slug,
  version: z.number().int().min(1),
  /** tokens-v1: reads only `variables.style`. legacy: still holds fixed sizes and timings. */
  contract: z.enum(["tokens-v1", "legacy"]),
  axes: z.array(TemplateAxisSchema),
  attribution: TemplateAttributionSchema,
}).strict().superRefine((manifest, ctx) => {
  const seen = new Set<string>();
  manifest.axes.forEach((axis, index) => {
    if (seen.has(axis.id)) ctx.addIssue({ code: "custom", message: `trùng axis ${axis.id}`, path: ["axes", index, "id"] });
    seen.add(axis.id);
  });
});
export type TemplateManifest = z.infer<typeof TemplateManifestSchema>;

/** Drawn by `common.js` for every template, so every manifest carries it. */
export const BACKGROUND_AXIS: TemplateAxis = {
  id: "background",
  role: "background",
  values: BACKGROUND_TREATMENTS.map((id) => ({ id })),
  tokenList: "background.treatments",
  signature: true,
  shared: true,
};

/** Entrance of the main elements, implemented by `VG.enter` in `common.js`. */
export const ENTRANCE_AXIS: TemplateAxis = {
  id: "entrance",
  role: "motion",
  values: ENTRANCES.map((id) => ({ id })),
  tokenList: "motion.entrances",
  signature: true,
  shared: true,
};

const OWN = { origin: "own" as const };

/** Manifests of the templates in the repo. All six read tokens-v1. */
export const TEMPLATE_MANIFESTS: Record<string, TemplateManifest> = {
  kinetic_text: {
    id: "kinetic_text",
    kind: "kinetic_text",
    version: 2,
    contract: "tokens-v1",
    axes: [
      {
        id: "chrome",
        role: "composition",
        values: [{ id: "plain" }, { id: "bar" }, { id: "rule" }],
        signature: false,
        shared: false,
      },
      ENTRANCE_AXIS,
      BACKGROUND_AXIS,
    ],
    attribution: OWN,
  },
  chart: {
    id: "chart",
    kind: "chart",
    version: 2,
    contract: "tokens-v1",
    axes: [
      {
        id: "frame",
        role: "layout",
        values: [{ id: "bleed" }, { id: "card" }],
        signature: false,
        shared: false,
      },
      ENTRANCE_AXIS,
      BACKGROUND_AXIS,
    ],
    attribution: OWN,
  },
  map: {
    id: "map",
    kind: "map",
    version: 2,
    contract: "tokens-v1",
    axes: [
      {
        id: "label",
        role: "composition",
        values: [{ id: "plate" }, { id: "float" }],
        signature: false,
        shared: false,
      },
      ENTRANCE_AXIS,
      BACKGROUND_AXIS,
    ],
    attribution: OWN,
  },
  compare: {
    id: "compare",
    kind: "compare",
    version: 2,
    contract: "tokens-v1",
    axes: [
      {
        id: "layout",
        role: "layout",
        values: [
          { id: "split", aspects: ["16:9", "1:1"] },
          { id: "stack" },
        ],
        signature: false,
        shared: false,
      },
      {
        id: "join",
        role: "composition",
        values: [{ id: "badge" }, { id: "divider" }],
        signature: false,
        shared: false,
      },
      ENTRANCE_AXIS,
      BACKGROUND_AXIS,
    ],
    attribution: OWN,
  },
  quote_full: {
    id: "quote_full",
    kind: "quote_full",
    version: 2,
    contract: "tokens-v1",
    axes: [
      {
        id: "layout",
        role: "layout",
        values: [{ id: "center" }, { id: "mark" }],
        signature: false,
        shared: false,
      },
      ENTRANCE_AXIS,
      BACKGROUND_AXIS,
    ],
    attribution: OWN,
  },
  list_full: {
    id: "list_full",
    kind: "list_full",
    version: 2,
    contract: "tokens-v1",
    axes: [
      {
        id: "layout",
        role: "layout",
        values: [
          { id: "rows" },
          { id: "cards", families: ["grid", "poster", "centered"] },
          { id: "rail", families: ["editorial", "centered"] },
        ],
        signature: false,
        shared: false,
      },
      {
        id: "title",
        role: "composition",
        values: [
          { id: "bar", families: ["editorial", "grid"] },
          { id: "underline" },
          { id: "tag", families: ["poster", "grid", "centered"] },
        ],
        signature: false,
        shared: false,
      },
      { id: "highlight", role: "content", values: [{ id: "bar" }, { id: "pop" }, { id: "none" }], signature: false, shared: false, sourceField: "highlight" },
      { id: "marker", role: "content", values: [{ id: "number" }, { id: "dot" }], signature: false, shared: false, sourceField: "marker" },
      ENTRANCE_AXIS,
      BACKGROUND_AXIS,
    ],
    attribution: OWN,
  },
};

export function templateManifest(id: string, extra?: Record<string, TemplateManifest>): TemplateManifest | null {
  return extra?.[id] ?? TEMPLATE_MANIFESTS[id] ?? null;
}

export type AxisContext = { tokens: StyleTokens; aspect: StyleAspect; packSeed: string };

/** How many values a signature axis keeps: 1 at consistency 1, all at consistency 0. */
export function homeSize(count: number, consistency: number): number {
  return Math.max(1, Math.min(count, Math.round(1 + (count - 1) * (1 - consistency))));
}

/**
 * The values of one axis a channel may use, in a stable order:
 * 1. values that suit the layout family and the aspect;
 * 2. cut down to the token list when the axis has one;
 * 3. for a signature axis, the channel's home values. They are chosen by the pack seed, so
 *    two channels with the same style still settle on different homes, and one channel keeps
 *    its home for as long as its seed and tokens stay the same.
 * When a step would leave nothing, the step is skipped (`relaxed` names it).
 */
export function axisChoices(manifest: Pick<TemplateManifest, "id">, axis: TemplateAxis, ctx: AxisContext): { values: string[]; relaxed: string[] } {
  const relaxed: string[] = [];
  let values = axis.values
    .filter((value) => (!value.families || value.families.includes(ctx.tokens.layout.family)) && (!value.aspects || value.aspects.includes(ctx.aspect)))
    .map((value) => value.id);
  if (values.length === 0) {
    relaxed.push("fit");
    values = axis.values.filter((value) => !value.aspects || value.aspects.includes(ctx.aspect)).map((value) => value.id);
    if (values.length === 0) values = axis.values.map((value) => value.id);
  }
  if (axis.tokenList) {
    const list: readonly string[] = axis.tokenList === "motion.entrances" ? ctx.tokens.motion.entrances : ctx.tokens.background.treatments;
    const kept = list.filter((id) => values.includes(id));
    if (kept.length > 0) values = [...new Set(kept)];
    else relaxed.push("tokens");
  }
  if (axis.signature && values.length > 1) {
    const scope = axis.shared ? "" : manifest.id;
    const ranked = [...values].sort((a, b) => {
      const ha = styleHash(`${ctx.packSeed}|${scope}|${axis.id}|${a}`);
      const hb = styleHash(`${ctx.packSeed}|${scope}|${axis.id}|${b}`);
      return ha < hb ? -1 : ha > hb ? 1 : 0;
    });
    const home = new Set(ranked.slice(0, homeSize(values.length, ctx.tokens.consistency)));
    values = values.filter((value) => home.has(value));
  }
  return { values, relaxed };
}

/** Checks a third-party template before it may be added. An empty list means it passes. */
export function templateImportProblems(raw: unknown): string[] {
  const parsed = TemplateManifestSchema.safeParse(raw);
  if (!parsed.success) return parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  const manifest = parsed.data;
  const problems: string[] = [];
  if (manifest.contract !== "tokens-v1") problems.push("Mẫu phải đọc style token (contract tokens-v1).");
  const own = manifest.axes.filter((axis) => !axis.shared && axis.role !== "content" && axis.values.length >= 2);
  if (own.length < 1) problems.push("Mẫu phải khai báo ít nhất một trục biến thể riêng (layout hoặc composition) có từ hai giá trị.");
  if (!manifest.axes.some((axis) => axis.id === BACKGROUND_AXIS.id)) problems.push("Mẫu phải dùng nền của runtime chung (trục background).");
  const a = manifest.attribution;
  if (a.origin === "third_party") {
    if (!a.license || !(PERMISSIVE_LICENSES as readonly string[]).includes(a.license)) {
      problems.push(`Giấy phép phải là một trong: ${PERMISSIVE_LICENSES.join(", ")}.`);
    }
    if (!a.sourceUrl) problems.push("Thiếu URL nguồn.");
    if (!a.commit) problems.push("Thiếu commit hoặc phiên bản của nguồn.");
    if (!a.name || !a.author) problems.push("Thiếu tên mẫu hoặc tác giả.");
  }
  return problems;
}

/**
 * Fixed values a tokens-v1 template must not hold: hex colours, GSAP ease names, numeric tween
 * durations, numeric font weights and px font sizes. Returns one line per finding.
 * Layout ratios (a marker that is 62 % of its row) are the template's own design and are allowed.
 */
export function templateTokenLint(html: string): string[] {
  const found: string[] = [];
  const rules: [RegExp, string][] = [
    [/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![0-9a-fA-F])/g, "màu hex cố định"],
    [/\bease:\s*["'`]/g, "ease cố định"],
    [/\bduration:\s*[0-9.]+/g, "thời lượng cố định"],
    [/font-weight:\s*[0-9]+/g, "độ đậm chữ cố định"],
    [/font-size:\s*[0-9.]+px/g, "cỡ chữ px cố định"],
    [/font-family:\s*["'A-Za-z]/g, "font cố định"],
  ];
  html.split(/\r?\n/).forEach((line, index) => {
    for (const [pattern, label] of rules) {
      pattern.lastIndex = 0;
      const match = pattern.exec(line);
      if (match) found.push(`dòng ${index + 1}: ${label} (${match[0]})`);
    }
  });
  return found;
}
