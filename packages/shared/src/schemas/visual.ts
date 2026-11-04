import { z } from "zod";
import {
  CandidateOriginSchema,
  LicenseKindSchema,
  SceneVisualStatusSchema,
  VisualStatusSchema,
  WatermarkStatusSchema,
} from "../enums.js";
import { SceneVisionMetaSchema, VisionCheckSchema } from "./vision.js";

export const LicenseMetadataSchema = z.object({
  kind: LicenseKindSchema,
  name: z.string(),
  url: z.string().url().nullable(),
  author: z.string().nullable(),
  authorUrl: z.string().url().nullable(),
  attributionRequired: z.boolean(),
  attributionText: z.string(),
  evidence: z.enum(["api", "page_meta", "user", "none"]),
}).strict();
export type LicenseMetadata = z.infer<typeof LicenseMetadataSchema>;

export const VisualProviderSchema = z.enum([
  "wikimedia",
  "openverse",
  "pexels",
  "mock",
  "custom",
  "brave",
  "web-grounding",
]);
export type VisualProvider = z.infer<typeof VisualProviderSchema>;

export const WEB_IMAGE_PROVIDERS = ["brave", "web-grounding"] as const;
export type WebImageProvider = (typeof WEB_IMAGE_PROVIDERS)[number];

export function isWebImageProvider(provider: string): provider is WebImageProvider {
  return provider === "brave" || provider === "web-grounding";
}

/** True when AUTO / approve-all must not pick this candidate. */
export function isUnverifiedWebCandidate(candidate: {
  provider: string;
  licenseVerified?: boolean;
}): boolean {
  return isWebImageProvider(candidate.provider) && candidate.licenseVerified === false;
}

export const VisualCandidateSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  sceneId: z.string().uuid(),
  origin: CandidateOriginSchema,
  provider: VisualProviderSchema,
  providerItemId: z.string(),
  sourceProvider: z.string().optional(),
  query: z.string(),
  title: z.string(),
  description: z.string(),
  tags: z.array(z.string()).default([]),
  previewUrl: z.string().url(),
  imageUrl: z.string().url(),
  sourceUrl: z.string().url(),
  sourcePageUrl: z.string().url().optional(),
  sourceSite: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  aspectRatio: z.number().positive(),
  fileType: z.string(),
  watermark: WatermarkStatusSchema,
  relevanceScore: z.number().min(0).max(1),
  scoreBreakdown: z.record(z.string(), z.unknown()),
  license: LicenseMetadataSchema,
  /** False for web finds without a reliable CC/PD/Commons signal; stock providers default true. */
  licenseVerified: z.boolean().default(true),
  why: z.string().optional(),
  rank: z.number().int().nonnegative(),
  discardedAt: z.string().datetime({ offset: true }).nullable(),
  localPath: z.string().nullable().optional(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(),
  bytes: z.number().int().nonnegative().nullable().optional(),
  actualWidth: z.number().int().positive().nullable().optional(),
  actualHeight: z.number().int().positive().nullable().optional(),
  downloadedAt: z.string().datetime({ offset: true }).nullable().optional(),
  downloadError: z.string().nullable().optional(),
  visionCheck: VisionCheckSchema.nullable().optional(),
  createdAt: z.string().datetime({ offset: true }),
  searchHash: z.string().optional(),
}).strict();
export type VisualCandidate = z.infer<typeof VisualCandidateSchema>;

export const VisualMotionSchema = z.object({
  type: z.enum(["kenburns", "pan", "zoom"]),
  from: z.record(z.string(), z.number()),
  to: z.record(z.string(), z.number()),
}).strict();

export const VisualSelectionSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  sceneId: z.string().uuid(),
  slot: z.number().int().nonnegative(),
  candidateId: z.string().uuid(),
  status: VisualStatusSchema,
  selectedBy: z.enum(["AGENT", "USER"]),
  motion: VisualMotionSchema.nullable(),
  reviewedAt: z.string().datetime({ offset: true }).nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
}).strict();
export type VisualSelection = z.infer<typeof VisualSelectionSchema>;

export const SceneVisualsSchema = z.object({
  selection: VisualSelectionSchema.nullable(),
  candidates: z.array(VisualCandidateSchema),
  status: SceneVisualStatusSchema.optional(),
  noVisual: z.boolean().optional(),
  visionMeta: SceneVisionMetaSchema.optional(),
}).strict();
export type SceneVisuals = z.infer<typeof SceneVisualsSchema>;

export const ProjectVisualsSchema = z.object({
  scenes: z.array(z.object({
    sceneId: z.string().uuid(),
    order: z.number().int().nonnegative(),
    selection: VisualSelectionSchema.nullable(),
    selectedCandidate: VisualCandidateSchema.nullable(),
    candidateCount: z.number().int().nonnegative(),
    needsUser: z.boolean(),
    lowRelevance: z.boolean(),
    status: SceneVisualStatusSchema,
    noVisual: z.boolean(),
    visualDescription: z.string(),
    visualQueries: z.object({ primary: z.string(), alternatives: z.array(z.string()) }).strict(),
    narration: z.string(),
    startSec: z.number().nonnegative(),
    durationSec: z.number().nonnegative(),
    visionMeta: SceneVisionMetaSchema.optional(),
  }).strict()),
  summary: z.object({
    withImage: z.number().int().nonnegative(),
    needsUser: z.number().int().nonnegative(),
    lowRelevance: z.number().int().nonnegative(),
    licenseCounts: z.record(z.string(), z.number().int().nonnegative()),
    statusCounts: z.record(SceneVisualStatusSchema, z.number().int().nonnegative()),
  }).strict(),
}).strict();
export type ProjectVisuals = z.infer<typeof ProjectVisualsSchema>;

export function deriveSceneVisualStatus(
  selection: Pick<VisualSelection, "status"> & { candidateId: string } | null,
  candidates: Pick<VisualCandidate, "id" | "localPath" | "sha256" | "actualWidth" | "actualHeight">[],
  noVisual: boolean,
  stageState: string | null | undefined,
  visionNeedsAttention = false,
): import("../enums.js").SceneVisualStatus {
  if (noVisual) return "SKIPPED";
  if (stageState === "RUNNING") return "SEARCHING";
  if (visionNeedsAttention) return "NEEDS_ATTENTION";
  if (!selection) return "NO_VISUAL";
  if (selection.status === "DISCOVERED" || selection.status === "REVIEW_REQUIRED" || selection.status === "REPLACED") {
    return "REVIEW_REQUIRED";
  }
  if (selection.status === "APPROVED" || selection.status === "CUSTOM" || selection.status === "AI_GENERATED") {
    const candidate = candidates.find((item) => item.id === selection.candidateId);
    return candidate?.localPath && candidate.sha256 && candidate.actualWidth && candidate.actualHeight
      ? "READY_FOR_RENDER"
      : "APPROVED";
  }
  return "NO_VISUAL";
}
