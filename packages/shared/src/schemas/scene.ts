import { z } from "zod";

export const SceneEnergySchema = z.enum(["low", "medium", "high"]);
export const SceneKindSchema = z.enum(["hook", "section", "outro"]);
export const SceneOriginSchema = z.enum(["AGENT", "USER"]);

export const VisualQueriesSchema = z.object({
  primary: z.string(),
  alternatives: z.array(z.string()).max(3),
}).strict();

export const StoredVisualQueriesSchema = VisualQueriesSchema.extend({
  queryVariant: z.boolean().default(false),
});

export const SceneSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  order: z.number().int().nonnegative(),
  kind: SceneKindSchema,
  sectionId: z.string().nullable(),
  label: z.string().min(1),
  narration: z.string(),
  visualNotes: z.string(),
  visualQueries: VisualQueriesSchema,
  queryVariant: z.boolean().default(false),
  musicMood: z.string(),
  energy: SceneEnergySchema,
  estDurationSec: z.number().nonnegative(),
  durationOverrideSec: z.number().min(1).max(60).nullable(),
  startSec: z.number().nonnegative(),
  transitionNote: z.string(),
  origin: SceneOriginSchema,
  edited: z.boolean(),
  inputHash: z.string(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
}).strict();
export type Scene = z.infer<typeof SceneSchema>;

export const SceneDraftSchema = SceneSchema.omit({
  id: true,
  projectId: true,
  origin: true,
  edited: true,
  inputHash: true,
  createdAt: true,
  updatedAt: true,
});
export type SceneDraft = z.infer<typeof SceneDraftSchema>;

export const ScenePatchSchema = z.object({
  label: z.string().trim().min(1).max(200).optional(),
  narration: z.string().max(20_000).optional(),
  visualNotes: z.string().max(2_000).optional(),
  visualQueries: VisualQueriesSchema.optional(),
  musicMood: z.string().max(500).optional(),
  energy: SceneEnergySchema.optional(),
  durationOverrideSec: z.number().min(1).max(60).nullable().optional(),
  transitionNote: z.string().max(500).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one scene field must be provided");
export type ScenePatch = z.infer<typeof ScenePatchSchema>;

export const ScenePlanSummarySchema = z.object({
  scenes: z.array(SceneSchema),
  totalSec: z.number().nonnegative(),
  targetSec: z.number().positive(),
  stale: z.boolean(),
}).strict();
export type ScenePlanSummary = z.infer<typeof ScenePlanSummarySchema>;

export const ReorderScenesSchema = z.object({
  sceneIds: z.array(z.string().uuid()).min(1),
}).strict();

export const SplitSceneSchema = z.object({
  sentenceIndex: z.number().int().nonnegative(),
}).strict();

export const MergeScenesSchema = z.object({
  sceneIds: z.tuple([z.string().uuid(), z.string().uuid()]),
}).strict();

export const SceneQueryAssistSchema = z.object({
  scenes: z.array(z.object({
    index: z.number().int().nonnegative(),
    primary: z.string().min(1),
    alternatives: z.array(z.string()).max(3),
  }).strict()),
}).strict();
export type SceneQueryAssist = z.infer<typeof SceneQueryAssistSchema>;
