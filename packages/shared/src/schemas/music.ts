import { z } from "zod";
import { MusicAssistOutputSchema } from "./metadata.js";
import { LicenseMetadataSchema } from "./visual.js";

export const MusicProviderSchema = z.enum(["openverse", "local", "upload", "mock"]);
export type MusicProvider = z.infer<typeof MusicProviderSchema>;

export const MusicCandidateSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  provider: MusicProviderSchema,
  providerItemId: z.string(),
  title: z.string(),
  artist: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  audioUrl: z.string().nullable(),
  durationSec: z.number().nonnegative().nullable(),
  genres: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  license: LicenseMetadataSchema,
  relevanceScore: z.number(),
  scoreBreakdown: z.record(z.string(), z.number()).default({}),
  rank: z.number().int().nonnegative(),
  localPath: z.string().nullable(),
  createdAt: z.string().datetime({ offset: true }),
}).strict();
export type MusicCandidate = z.infer<typeof MusicCandidateSchema>;

export const MusicSelectionStatusSchema = z.enum(["REVIEW_REQUIRED", "APPROVED", "NONE"]);
export type MusicSelectionStatus = z.infer<typeof MusicSelectionStatusSchema>;

export const MusicMixSettingsSchema = z.object({
  volume: z.number().min(0).max(1),
  fadeInSec: z.number().min(0).max(30),
  fadeOutSec: z.number().min(0).max(30),
  duckingDb: z.number().min(-40).max(0),
  startOffsetSec: z.number().min(0).max(3600),
}).strict();
export type MusicMixSettings = z.infer<typeof MusicMixSettingsSchema>;

export const MusicSelectionSchema = MusicMixSettingsSchema.extend({
  projectId: z.string().uuid(),
  candidateId: z.string().uuid().nullable(),
  status: MusicSelectionStatusSchema,
  selectedBy: z.enum(["AGENT", "USER"]),
  queryOverride: z.string().nullable(),
  assist: MusicAssistOutputSchema.nullable().optional(),
  updatedAt: z.string().datetime({ offset: true }),
}).strict();
export type MusicSelection = z.infer<typeof MusicSelectionSchema>;

export const ProjectMusicSchema = z.object({
  enabled: z.boolean(),
  mood: z.string(),
  energy: z.string(),
  query: z.string(),
  videoDurationSec: z.number().nonnegative(),
  candidates: z.array(MusicCandidateSchema),
  selection: MusicSelectionSchema.nullable(),
  selectedCandidate: MusicCandidateSchema.nullable(),
  assist: MusicAssistOutputSchema.nullable().optional(),
}).strict();
export type ProjectMusic = z.infer<typeof ProjectMusicSchema>;

export const MusicSettingsPatchSchema = MusicMixSettingsSchema.partial().extend({
  query: z.string().max(200).nullable().optional(),
}).strict();
export type MusicSettingsPatch = z.infer<typeof MusicSettingsPatchSchema>;

export const MusicSelectRequestSchema = z.object({ candidateId: z.string().uuid() }).strict();

export const DEFAULT_MUSIC_MIX: Omit<MusicMixSettings, "volume"> = {
  fadeInSec: 2,
  fadeOutSec: 3,
  duckingDb: -12,
  startOffsetSec: 0,
};
