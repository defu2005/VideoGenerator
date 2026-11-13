import { z } from "zod";
import { findContrastWord } from "./numbers.js";
import { getLangPack } from "./lang/index.js";

/** Same window as schema.ts MIN/MAX_GRAPHIC_SHOT_SEC. Kept here to avoid a cycle. */
const KINETIC_MIN_SEC = 1.5;
const KINETIC_MAX_SEC = 6;

/**
 * Schemas for the four TASK-070 templates. Length limits are the hard caps in
 * docs/compose/templates-070.md. `fitGraphicPayload` returns null when the
 * model exceeds them, so the caller can use a kinetic card or a still.
 */

const GEO_MAX_BYTES = 150 * 1024;

const position = z.tuple([
  z.number().finite().min(-180).max(180),
  z.number().finite().min(-90).max(90),
]);
const ring = z.array(position).min(4);
const polygon = z.object({ type: z.literal("Polygon"), coordinates: z.array(ring).min(1) }).strict();
const multiPolygon = z.object({
  type: z.literal("MultiPolygon"),
  coordinates: z.array(z.array(ring).min(1)).min(1),
}).strict();

const MapFeatureSchema = z.object({
  type: z.literal("Feature"),
  properties: z.object({
    id: z.string().trim().min(1).max(32),
    name: z.string().trim().min(1).max(80),
    name_en: z.string().trim().max(80).optional(),
    name_vi: z.string().trim().max(80).optional(),
    level: z.union([z.literal(0), z.literal(1)]).optional(),
    parent: z.string().trim().max(32).optional(),
    label: position.optional(),
  }).strict(),
  geometry: z.discriminatedUnion("type", [polygon, multiPolygon]),
}).strict();

export const MapGeoSchema = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(MapFeatureSchema).max(220),
}).strict().superRefine((geo, ctx) => {
  const bytes = new TextEncoder().encode(JSON.stringify(geo)).length;
  if (bytes > GEO_MAX_BYTES) ctx.addIssue({ code: "custom", message: "geo quá 150 KB", path: ["features"] });
});

const box = z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]);

export const MapSourceSchema = z.object({
  kind: z.literal("map"),
  focus: z.string().trim().min(1).max(32).optional(),
  pin: position.optional(),
  /** One line at 24; two lines up to 40. Longer than that is rejected. */
  label: z.string().trim().max(40).optional(),
  sublabel: z.string().trim().max(30).optional(),
  from: z.union([z.string().trim().min(1).max(32), box]).optional(),
  zoomFrom: z.number().positive().max(20).optional(),
  minSpanDeg: z.number().positive().max(180).optional(),
  spanDeg: z.number().positive().max(180).optional(),
  zoom: z.enum(["push", "fly", "static"]).optional(),
  highlight: z.enum(["fill", "outline", "glow"]).optional(),
  neighbours: z.boolean().optional(),
  geo: MapGeoSchema.optional(),
}).strict().superRefine((value, ctx) => {
  if (!value.focus && !value.pin && !value.geo) {
    ctx.addIssue({ code: "custom", message: "map cần focus, pin hoặc geo", path: ["focus"] });
  }
});

const compareSide = z.object({
  label: z.string().trim().max(16),
  text: z.string().trim().min(1).max(40),
}).strict();

export const CompareSourceSchema = z.object({
  kind: z.literal("compare"),
  left: compareSide,
  right: compareSide,
  style: z.enum(["versus", "before_after", "myth_fact"]).optional(),
  rightAt: z.number().nonnegative().optional(),
  reveal: z.enum(["sequence", "together"]).optional(),
  winner: z.enum(["left", "right", "none"]).optional(),
  badge: z.string().trim().max(3).optional(),
  wordTimes: z.array(z.number().nonnegative()).optional(),
}).strict();

export function quoteWords(quote: string): string[] {
  return quote.trim().replace(/^["“«„]+|["”»]+$/u, "").split(/\s+/).filter(Boolean);
}

export const QuoteSourceSchema = z.object({
  kind: z.literal("quote_full"),
  quote: z.string().trim().min(1).max(160),
  speaker: z.string().trim().max(32).optional(),
  role: z.string().trim().max(32).optional(),
  wordTimes: z.array(z.number().nonnegative()).optional(),
  emphasis: z.array(z.number().int().nonnegative()).max(3).optional(),
  reveal: z.enum(["ghost", "appear", "block"]).optional(),
  speakerAt: z.number().nonnegative().optional(),
}).strict().superRefine((value, ctx) => {
  const count = quoteWords(value.quote).length;
  if (count < 6 || count > 28) ctx.addIssue({ code: "custom", message: "trích dẫn cần 6–28 từ", path: ["quote"] });
  if (value.emphasis?.some((index) => index >= count)) {
    ctx.addIssue({ code: "custom", message: "emphasis vượt số từ", path: ["emphasis"] });
  }
});

export const ListSourceSchema = z.object({
  kind: z.literal("list_full"),
  items: z.array(z.string().trim().min(1).max(36)).min(3).max(6),
  title: z.string().trim().max(40).optional(),
  itemTimes: z.array(z.number().nonnegative()).optional(),
  wordTimes: z.array(z.number().nonnegative()).optional(),
  highlight: z.enum(["bar", "pop", "none"]).optional(),
  marker: z.enum(["number", "dot"]).optional(),
  settle: z.boolean().optional(),
}).strict();

export const GRAPHIC_KINDS = ["kinetic_text", "chart", "map", "compare", "quote_full", "list_full"] as const;
export type GraphicKind = (typeof GRAPHIC_KINDS)[number];

export function isGraphicKind(kind: string): kind is GraphicKind {
  return (GRAPHIC_KINDS as readonly string[]).includes(kind);
}

type BoundsSource = { kind?: string; reveal?: string; items?: unknown[] };

export function graphicDurationBounds(kind: string, source?: BoundsSource): { min: number; max: number } | null {
  if (kind === "kinetic_text" || kind === "chart") return { min: KINETIC_MIN_SEC, max: KINETIC_MAX_SEC };
  if (kind === "map") return { min: 2.5, max: 7 };
  if (kind === "compare") return { min: source?.reveal === "together" ? 2 : 2.5, max: 6 };
  if (kind === "quote_full") return { min: 3, max: 10 };
  if (kind === "list_full") {
    const count = Array.isArray(source?.items) ? source.items.length : 3;
    return { min: 0.8 * Math.max(3, count) + 0.8, max: 12 };
  }
  return null;
}

const graphicSchemas = {
  map: MapSourceSchema,
  compare: CompareSourceSchema,
  quote_full: QuoteSourceSchema,
  list_full: ListSourceSchema,
} as const;

function asRecord(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

/** Null means the payload cannot be shown. The seventh list item is dropped, not rejected. */
export function fitGraphicPayload(kind: string, raw: unknown): z.infer<typeof MapSourceSchema> | z.infer<typeof CompareSourceSchema> | z.infer<typeof QuoteSourceSchema> | z.infer<typeof ListSourceSchema> | null {
  const schema = graphicSchemas[kind as keyof typeof graphicSchemas];
  if (!schema) return null;
  const record = asRecord(raw) ?? {};
  const next: Record<string, unknown> = { ...record, kind };
  if (kind === "list_full" && Array.isArray(next.items) && next.items.length > 6) {
    next.items = next.items.slice(0, 6);
    if (Array.isArray(next.itemTimes)) next.itemTimes = next.itemTimes.slice(0, 6);
  }
  if (kind === "compare" && next.badge === "") delete next.badge;
  const parsed = schema.safeParse(next);
  return parsed.success ? parsed.data : null;
}

function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/gi, "d").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function clampTime(value: number, durationSec: number): number {
  const last = Math.max(0, durationSec - 0.2);
  return Math.round(Math.max(0, Math.min(last, value)) * 1000) / 1000;
}

type Spoken = { text: string; startSec: number };

/** Fills rightAt, quote wordTimes and list itemTimes from the words spoken in the shot. */
export function applyGraphicTiming<T extends { kind: string }>(
  source: T,
  words: Spoken[],
  shotStart: number,
  durationSec: number,
  language: string,
): T & { rightAt?: number; wordTimes?: number[]; itemTimes?: number[] } {
  if (source.kind === "compare") {
    const current = source as T & { rightAt?: number };
    if (current.rightAt != null && Number.isFinite(current.rightAt)) return source;
    const found = findContrastWord(words.map((word) => word.text), getLangPack(language));
    if (!found) return source;
    const at = words[found.index]?.startSec;
    if (at == null) return source;
    return { ...source, rightAt: clampTime(at - shotStart, durationSec) };
  }
  if (source.kind === "quote_full") {
    const current = source as T & { quote?: string; wordTimes?: number[] };
    if (current.wordTimes && current.wordTimes.length > 0) return source;
    const count = quoteWords(String(current.quote ?? "")).length;
    if (count === 0 || words.length !== count) return source;
    return { ...source, wordTimes: words.map((word) => clampTime(word.startSec - shotStart, durationSec)) };
  }
  if (source.kind === "list_full") {
    const current = source as T & { items?: string[]; itemTimes?: number[] };
    if (current.itemTimes && current.itemTimes.length === current.items?.length) return source;
    const items = current.items ?? [];
    let cursor = 0;
    const times: number[] = [];
    for (const item of items) {
      const first = fold(item.split(/\s+/).find(Boolean) ?? "");
      if (!first) return source;
      let found = -1;
      for (let index = cursor; index < words.length; index += 1) {
        if (fold(words[index]!.text) === first) { found = index; break; }
      }
      if (found < 0) return source;
      times.push(clampTime(words[found]!.startSec - shotStart, durationSec));
      cursor = found + 1;
    }
    return times.length === items.length ? { ...source, itemTimes: times } : source;
  }
  return source;
}

type VariantShot = { id: string; kind: string; source: { kind: string } & Record<string, unknown> };

export function shotVariantParams<K extends string>(shot: { id: string; kind: K; source: VariantShot["source"] }): {
  shotId: string;
  kind: K;
  params: Record<string, string | number | boolean>;
} {
  const source = shot.source;
  const params: Record<string, string | number | boolean> = {};
  if (source.kind === "kinetic_text" && typeof source.style === "string") params.style = source.style;
  if (source.kind === "chart" && typeof source.chart === "string") params.chart = source.chart;
  if (source.kind === "still" && typeof source.motion === "string") params.motion = source.motion;
  if (source.kind === "map") {
    params.zoom = typeof source.zoom === "string" ? source.zoom : "push";
    params.highlight = typeof source.highlight === "string" ? source.highlight : "fill";
    params.neighbours = source.neighbours !== false;
    params.sublabel = typeof source.sublabel === "string" && source.sublabel.length > 0;
    if (typeof source.from === "string") params.from = source.from;
    else if (Array.isArray(source.from)) params.from = "box";
  }
  if (source.kind === "compare") {
    params.style = typeof source.style === "string" ? source.style : "versus";
    params.reveal = typeof source.reveal === "string" ? source.reveal : "sequence";
    const fallbackWinner = params.style === "versus" ? "none" : "right";
    params.winner = typeof source.winner === "string" ? source.winner : fallbackWinner;
  }
  if (source.kind === "quote_full") {
    params.reveal = typeof source.reveal === "string" ? source.reveal : "ghost";
    params.emphasis = Array.isArray(source.emphasis) && source.emphasis.length > 0;
    params.role = typeof source.role === "string" && source.role.length > 0;
  }
  if (source.kind === "list_full") {
    params.highlight = typeof source.highlight === "string" ? source.highlight : "bar";
    params.marker = typeof source.marker === "string" ? source.marker : "number";
    params.settle = source.settle !== false;
    params.title = typeof source.title === "string" && source.title.length > 0;
    params.items = Array.isArray(source.items) ? source.items.length : 0;
  }
  return { shotId: shot.id, kind: shot.kind, params };
}
