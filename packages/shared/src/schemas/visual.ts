import { z } from "zod";
import {
  CandidateOriginSchema,
  LicenseKindSchema,
  VisualStatusSchema,
  WatermarkStatusSchema,
} from "../enums.js";

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

export const VisualProviderSchema = z.enum(["wikimedia", "openverse", "pexels", "mock"]);
export type VisualProvider = z.infer<typeof VisualProviderSchema>;

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
  sourceSite: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  aspectRatio: z.number().positive(),
  fileType: z.string(),
  watermark: WatermarkStatusSchema,
  relevanceScore: z.number().min(0).max(1),
  scoreBreakdown: z.record(z.string(), z.unknown()),
  license: LicenseMetadataSchema,
  rank: z.number().int().nonnegative(),
  discardedAt: z.string().datetime({ offset: true }).nullable(),
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
  }).strict()),
  summary: z.object({
    withImage: z.number().int().nonnegative(),
    needsUser: z.number().int().nonnegative(),
    lowRelevance: z.number().int().nonnegative(),
    licenseCounts: z.record(z.string(), z.number().int().nonnegative()),
  }).strict(),
}).strict();
export type ProjectVisuals = z.infer<typeof ProjectVisualsSchema>;
