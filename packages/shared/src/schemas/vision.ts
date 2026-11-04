import { z } from "zod";

export const VisionIssueSchema = z.enum([
  "watermark",
  "text_overlay",
  "wrong_subject",
  "wrong_era",
  "low_quality",
  "collage",
  "nsfw",
  "logo_only",
]);
export type VisionIssue = z.infer<typeof VisionIssueSchema>;

export const VisionCheckResultSchema = z.object({
  fit: z.number().min(0).max(10),
  depicts: z.string(),
  issues: z.array(VisionIssueSchema),
  cropOk: z.boolean(),
}).strict();
export type VisionCheckResult = z.infer<typeof VisionCheckResultSchema>;

export const VisionCheckSchema = VisionCheckResultSchema.extend({
  model: z.string(),
  checkedAt: z.string().datetime({ offset: true }),
}).strict();
export type VisionCheck = z.infer<typeof VisionCheckSchema>;

/** One vision call returns a result per labelled image. */
export const VisionCheckBatchSchema = z.object({
  images: z.array(z.object({
    label: z.string(),
    fit: z.number().min(0).max(10),
    depicts: z.string(),
    issues: z.array(VisionIssueSchema),
    cropOk: z.boolean(),
  }).strict()),
}).strict();
export type VisionCheckBatch = z.infer<typeof VisionCheckBatchSchema>;

export const VisionResearchSchema = z.object({
  queries: z.array(z.string().min(1).max(300)).min(1).max(3),
  why: z.string().optional(),
}).strict();
export type VisionResearch = z.infer<typeof VisionResearchSchema>;

export const VisionConsistencySchema = z.object({
  flags: z.array(z.object({
    sceneId: z.string().uuid(),
    reason: z.string(),
    kind: z.enum(["style", "era", "duplicate", "other"]).default("other"),
  }).strict()),
}).strict();
export type VisionConsistency = z.infer<typeof VisionConsistencySchema>;

export const RenderVisionBatchSchema = z.object({
  frames: z.array(z.object({
    sceneId: z.string().uuid(),
    matchesSelection: z.boolean(),
    subtitleLegible: z.boolean(),
    subjectCropOk: z.boolean(),
    notes: z.string().optional(),
  }).strict()),
}).strict();
export type RenderVisionBatch = z.infer<typeof RenderVisionBatchSchema>;

export const FactCheckSchema = z.object({
  revisedScript: z.unknown().optional(),
  softenedClaims: z.array(z.string()).default([]),
  notes: z.array(z.string()).default([]),
}).strict();
export type FactCheck = z.infer<typeof FactCheckSchema>;

export const VisionReSearchEntrySchema = z.object({
  round: z.number().int().nonnegative(),
  queries: z.array(z.string()),
  why: z.string(),
  bestFit: z.number().min(0).max(10).nullable(),
}).strict();
export type VisionReSearchEntry = z.infer<typeof VisionReSearchEntrySchema>;

export const SceneVisionMetaSchema = z.object({
  needsAttention: z.boolean().optional(),
  reason: z.string().optional(),
  reSearchHistory: z.array(VisionReSearchEntrySchema).optional(),
  consistencyFlags: z.array(z.string()).optional(),
  verifiedFit: z.number().min(0).max(10).nullable().optional(),
}).strict();
export type SceneVisionMeta = z.infer<typeof SceneVisionMetaSchema>;

/** Soft-cap fit when a hard issue is present. */
export const VISION_HARD_ISSUES: ReadonlySet<VisionIssue> = new Set([
  "watermark",
  "wrong_subject",
  "nsfw",
]);

export function applyVisionIssueCap(fit: number, issues: readonly VisionIssue[]): number {
  if (issues.some((issue) => VISION_HARD_ISSUES.has(issue))) {
    return Math.min(fit, 3);
  }
  return fit;
}

/** Final score: 0.5 vision + 0.3 text rerank + 0.2 code. */
export function combineVisionScore(input: {
  visionFit: number;
  textRerank?: number;
  codeScore: number;
}): number {
  const vision = Math.max(0, Math.min(10, input.visionFit)) / 10;
  const text = input.textRerank ?? input.codeScore;
  return 0.5 * vision + 0.3 * text + 0.2 * input.codeScore;
}

/** Fixed estimate for a ≤768px vision image (~1k input tokens). */
export const VISION_IMAGE_TOKEN_ESTIMATE = 1_000;
