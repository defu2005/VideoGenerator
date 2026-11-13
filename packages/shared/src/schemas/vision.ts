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
  subject: z.object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().min(0).max(1),
    height: z.number().min(0).max(1),
  }).strict().optional(),
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
    subject: z.object({
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      width: z.number().min(0).max(1),
      height: z.number().min(0).max(1),
    }).strict().optional(),
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
  notes: z.array(z.object({
    text: z.string(),
    severity: z.enum(["blocking", "minor"]),
  }).strict()).default([]),
}).strict();
export type FactCheck = z.infer<typeof FactCheckSchema>;

export const VisionReSearchEntrySchema = z.object({
  round: z.number().int().nonnegative(),
  queries: z.array(z.string()),
  why: z.string(),
  bestFit: z.number().min(0).max(10).nullable(),
}).strict();
export type VisionReSearchEntry = z.infer<typeof VisionReSearchEntrySchema>;

export const SelectionHistoryEntrySchema = z.object({
  at: z.string(),
  fromCandidateId: z.string(),
  toCandidateId: z.string(),
}).strict();

/** TASK-126: why a scene has no usable image after VISUAL_SEARCH. */
export const VisionAttentionCauseSchema = z.enum([
  "vision_reject",
  "vision_unavailable",
  "no_candidates",
  "web_failed",
]);
export type VisionAttentionCause = z.infer<typeof VisionAttentionCauseSchema>;

export const SceneVisionMetaSchema = z.object({
  needsAttention: z.boolean().optional(),
  cause: VisionAttentionCauseSchema.optional(),
  reason: z.string().optional(),
  reSearchHistory: z.array(VisionReSearchEntrySchema).optional(),
  consistencyFlags: z.array(z.string()).optional(),
  verifiedFit: z.number().min(0).max(10).nullable().optional(),
  selectionHistory: z.array(SelectionHistoryEntrySchema).optional(),
  /** Set when the quality repair loop changed this scene (TASK-121). */
  repair: z.enum(["shot_type", "rephrase"]).optional(),
  repairShot: z.enum(["text_card", "quote_full", "list_full", "map", "footage"]).optional(),
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

const VISION_ISSUE_CANONICAL = new Set(VisionIssueSchema.options);

const VISION_ISSUE_SYNONYMS: Record<string, VisionIssue> = {
  blurry: "low_quality",
  blur: "low_quality",
  pixelated: "low_quality",
  low_resolution: "low_quality",
  low_res: "low_quality",
  irrelevant: "wrong_subject",
  off_topic: "wrong_subject",
  unrelated: "wrong_subject",
  wrong_character: "wrong_subject",
  logo: "logo_only",
  text: "text_overlay",
  caption: "text_overlay",
  subtitle: "text_overlay",
  watermarked: "watermark",
  anachronism: "wrong_era",
};

function normalizeIssueToken(raw: string): VisionIssue | null {
  const token = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!token) return null;
  if (VISION_ISSUE_CANONICAL.has(token as VisionIssue)) return token as VisionIssue;
  return VISION_ISSUE_SYNONYMS[token] ?? null;
}

function normalizeVisionImage(raw: unknown): { value: unknown; droppedIssues: number } {
  if (!raw || typeof raw !== "object") return { value: raw, droppedIssues: 0 };
  const image = raw as Record<string, unknown>;
  const keys = ["label", "fit", "depicts", "issues", "cropOk", "subject"] as const;
  const next: Record<string, unknown> = {};
  for (const key of keys) {
    if (key in image) next[key] = image[key];
  }
  let dropped = 0;
  if (!("issues" in image)) {
    next.issues = [];
  }
  if ("issues" in next) {
    const source = next.issues;
    const list = Array.isArray(source) ? source : [];
    const mapped: VisionIssue[] = [];
    const seen = new Set<VisionIssue>();
    for (const item of list) {
      if (typeof item !== "string") {
        dropped += 1;
        continue;
      }
      const issue = normalizeIssueToken(item);
      if (!issue) {
        dropped += 1;
        continue;
      }
      if (!seen.has(issue)) {
        seen.add(issue);
        mapped.push(issue);
      } else {
        dropped += 1;
      }
    }
    next.issues = mapped;
    if (!Array.isArray(source)) dropped += 1;
  }
  if ("fit" in next) {
    const fit = next.fit;
    if (typeof fit === "string" && fit.trim() !== "") {
      const num = Number(fit);
      if (!Number.isNaN(num)) {
        next.fit = Math.min(10, Math.max(0, num));
      }
    } else if (typeof fit === "number") {
      next.fit = Math.min(10, Math.max(0, fit));
    }
  }
  if ("cropOk" in next) {
    if (next.cropOk === "true") next.cropOk = true;
    if (next.cropOk === "false") next.cropOk = false;
  }
  return { value: next, droppedIssues: dropped };
}

/** Lenient cleanup before VisionCheckBatchSchema.safeParse; wire JSON schema unchanged. */
export function normalizeVisionCheckBatch(raw: unknown): { value: unknown; droppedIssues: number } {
  if (!raw || typeof raw !== "object") {
    return { value: raw, droppedIssues: 0 };
  }
  const root = raw as Record<string, unknown>;
  let droppedIssues = 0;
  if (!Array.isArray(root.images)) {
    return { value: { images: [] }, droppedIssues: 0 };
  }
  const images: unknown[] = [];
  for (const image of root.images) {
    const normalized = normalizeVisionImage(image);
    images.push(normalized.value);
    droppedIssues += normalized.droppedIssues;
  }
  return { value: { images }, droppedIssues };
}
