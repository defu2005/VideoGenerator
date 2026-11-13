import { z } from "zod";
import { AspectRatioSchema, type AspectRatio } from "../enums.js";
import { EditPresetIdSchema, MotionPresetSchema, type EditPresetId } from "../edit/plan.js";
import { CompareSourceSchema, graphicDurationBounds, ListSourceSchema, MapSourceSchema, QuoteSourceSchema } from "./graphicKind.js";

export const COMPOSE_VERSION = 1;
/** Bump when compose templates, fonts or common.js change, so scene clips are not reused. */
export const COMPOSE_RENDER_VERSION = 2;
export const SHOT_KINDS = ["still", "footage", "kinetic_text", "chart", "map", "compare", "quote_full", "list_full"] as const;
export const ShotKindSchema = z.enum(SHOT_KINDS);
export type ShotKind = z.infer<typeof ShotKindSchema>;
export const MIN_SHOT_SEC = 0.8;
export const MIN_GRAPHIC_SHOT_SEC = 1.5;
export const MAX_GRAPHIC_SHOT_SEC = 6;

export const FootageLicenseSchema = z.object({
  provider: z.enum(["pexels", "pixabay"]),
  clipId: z.string().min(1),
  author: z.string().min(1),
  licenseName: z.string().min(1),
  pageUrl: z.string().min(1),
}).strict();
export type FootageLicense = z.infer<typeof FootageLicenseSchema>;

export const ShotSourceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("still"),
    candidateId: z.string().nullable(),
    path: z.string().nullable(),
    motion: MotionPresetSchema,
  }).strict(),
  z.object({
    kind: z.literal("footage"),
    clipId: z.string().min(1),
    path: z.string().nullable(),
    inSec: z.number().nonnegative(),
    license: FootageLicenseSchema,
  }).strict(),
  z.object({
    kind: z.literal("kinetic_text"),
    lines: z.array(z.string()),
    emphasis: z.array(z.number().int().nonnegative()),
    style: z.enum(["bold", "typewriter", "stack"]),
    /** Shot-relative start of each word in seconds; optional, old plans have none. */
    wordTimes: z.array(z.number().nonnegative()).optional(),
  }).strict(),
  z.object({
    kind: z.literal("chart"),
    chart: z.enum(["bar", "line", "pie"]),
    title: z.string(),
    labels: z.array(z.string()),
    values: z.array(z.number()),
    unit: z.string().optional(),
  }).strict(),
  MapSourceSchema,
  CompareSourceSchema,
  QuoteSourceSchema,
  ListSourceSchema,
]);
export type ShotSource = z.infer<typeof ShotSourceSchema>;

export const ShotSchema = z.object({
  id: z.string().min(1),
  kind: ShotKindSchema,
  startSec: z.number().nonnegative(),
  endSec: z.number().positive(),
  wordRange: z.object({
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
  }).strict().optional(),
  source: ShotSourceSchema,
  reason: z.string(),
  /** Kept as-is the next time the plan is built. */
  locked: z.boolean().optional(),
}).strict();
export type Shot = z.infer<typeof ShotSchema>;

export const KindSpanSchema = z.object({
  kind: ShotKindSchema,
  wordStart: z.number().int().nonnegative(),
  wordEnd: z.number().int().nonnegative(),
  reason: z.string(),
  payload: ShotSourceSchema.optional(),
}).strict();
export type KindSpan = z.infer<typeof KindSpanSchema>;

export const ScenePlanSchema = z.object({
  sceneId: z.string().min(1),
  durationSec: z.number().positive(),
  durationFrames: z.number().int().positive(),
  fps: z.number().int().positive(),
  shots: z.array(ShotSchema),
  warnings: z.array(z.string()),
}).strict();
export type ScenePlan = z.infer<typeof ScenePlanSchema>;

export const BeatGridSchema = z.object({
  bpm: z.number().positive(),
  beatsSec: z.array(z.number().nonnegative()),
  confidence: z.number().min(0).max(1),
}).strict();
export type BeatGrid = z.infer<typeof BeatGridSchema>;

export const ComposeStatsSchema = z.object({
  shotsPerMin: z.number().nonnegative(),
  meanShotSec: z.number().nonnegative(),
  stdevShotSec: z.number().nonnegative(),
  kindShare: z.object({
    still: z.number().nonnegative(),
    footage: z.number().nonnegative(),
    kinetic_text: z.number().nonnegative(),
    chart: z.number().nonnegative(),
    map: z.number().nonnegative().default(0),
    compare: z.number().nonnegative().default(0),
    quote_full: z.number().nonnegative().default(0),
    list_full: z.number().nonnegative().default(0),
  }).strict(),
  kindEntropyBits: z.number().nonnegative(),
  maxSameKindRun: z.number().int().nonnegative(),
  wordGapCutPct: z.number().min(0).max(1),
  beatCutPct: z.number().min(0).max(1).nullable(),
  /** Variant choices for the learning loop. Old plans parse as an empty list. */
  shotVariants: z.array(z.object({
    shotId: z.string().min(1),
    kind: ShotKindSchema,
    params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  }).strict()).default([]),
}).strict();
export type ComposeStats = z.infer<typeof ComposeStatsSchema>;

export const LlmVariantChoiceSchema = z.object({
  sceneId: z.string().min(1),
  n: z.number().int().nonnegative(),
  templateId: z.string().min(1),
  key: z.string().min(1),
}).strict();
export type LlmVariantChoice = z.infer<typeof LlmVariantChoiceSchema>;

export const ComposePlanSchema = z.object({
  version: z.literal(1),
  engine: z.literal("compose"),
  preset: EditPresetIdSchema,
  aspect: AspectRatioSchema,
  scenes: z.array(ScenePlanSchema),
  beatGrid: BeatGridSchema.optional(),
  stats: ComposeStatsSchema,
  /** Every ranked footage hit for this plan: kept clips and the ones left unused. */
  footageNotes: z.array(z.object({
    sceneId: z.string().min(1),
    clipId: z.string().min(1),
    relevance: z.number(),
    fit: z.number(),
    kept: z.boolean(),
    author: z.string().optional(),
    licenseName: z.string().optional(),
    pageUrl: z.string().optional(),
  }).strict()).optional(),
  /**
   * TASK-112: graphic shots whose look the QUALITY director's LLM chose among the offered variants.
   * `n` is the position among the graphic shots of the scene. Missing on every other plan.
   */
  llmVariantChoices: z.array(LlmVariantChoiceSchema).optional(),
}).strict();
export type ComposePlan = z.infer<typeof ComposePlanSchema>;
export type { AspectRatio, EditPresetId };

export function shotFrames(plan: Pick<ScenePlan, "fps" | "shots">): number[] {
  return plan.shots.map((shot) => Math.round(shot.endSec * plan.fps) - Math.round(shot.startSec * plan.fps));
}

export function validateScenePlan(
  plan: ScenePlan,
  words: Array<{ startSec: number; endSec: number }>,
): string[] {
  const errors: string[] = [];
  const shots = plan.shots;
  if (shots.length === 0) errors.push("không có cảnh quay");
  let cursor = 0;
  for (const shot of shots) {
    if (Math.abs(shot.startSec - cursor) > 0.001) errors.push(`khoảng trống hoặc chồng tại ${shot.startSec}`);
    if (shot.endSec <= shot.startSec) errors.push(`cảnh quay ${shot.id} có độ dài âm`);
    cursor = shot.endSec;
    const len = shot.endSec - shot.startSec;
    if (len + 1e-9 < MIN_SHOT_SEC) errors.push(`cảnh quay ${shot.id} ngắn hơn ${MIN_SHOT_SEC}s`);
    const bounds = graphicDurationBounds(shot.kind, shot.source);
    if (bounds && (len < bounds.min - 1e-9 || len > bounds.max + 1e-9)) {
      errors.push(`đồ hoạ ${shot.id} ngoài ${bounds.min}–${bounds.max}s`);
    }
    if (shot.kind !== shot.source.kind) errors.push(`kiểu ${shot.id} không khớp nguồn`);
  }
  if (shots.length > 0 && Math.abs(cursor - plan.durationSec) > 0.001) errors.push("chưa phủ hết cảnh");
  const frames = shotFrames(plan).reduce((sum, value) => sum + value, 0);
  if (frames !== plan.durationFrames) errors.push(`số khung ${frames} khác ${plan.durationFrames}`);
  for (let index = 0; index < shots.length - 1; index += 1) {
    const cut = shots[index]!.endSec;
    if (words.some((word) => word.startSec < cut && cut < word.endSec)) errors.push(`cắt giữa từ tại ${cut}`);
  }
  return errors;
}
