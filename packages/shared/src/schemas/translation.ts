import { z } from "zod";

export const TranslationModeSchema = z.enum(["dub", "subtitles_only"]);
export type TranslationMode = z.infer<typeof TranslationModeSchema>;

export const ProfileTranslationTargetSchema = z.object({
  language: z.string().trim().min(2).max(16),
  accountIds: z.array(z.string().uuid()).max(20).default([]),
  voice: z.string().trim().max(200).optional(),
  mode: TranslationModeSchema,
}).strict();
export type ProfileTranslationTarget = z.infer<typeof ProfileTranslationTargetSchema>;

export const ProfileTranslationsSchema = z.array(ProfileTranslationTargetSchema).max(12);
export type ProfileTranslations = z.infer<typeof ProfileTranslationsSchema>;

export const TranslateScriptSceneSchema = z.object({
  id: z.string().min(1),
  narration: z.string().min(1),
}).strict();

export const TranslateScriptOutputSchema = z.object({
  scenes: z.array(TranslateScriptSceneSchema).min(1).max(80),
}).strict();
export type TranslateScriptOutput = z.infer<typeof TranslateScriptOutputSchema>;

/** Loose metadata from the LLM, trimmed to platform limits afterwards. */
export const TranslateMetadataRawSchema = z.object({
  titles: z.array(z.string().min(1)).min(1).max(3),
  description: z.string().min(1),
  tags: z.array(z.string()).max(30).default([]),
  hashtags: z.array(z.string()).max(10).default([]),
  thumbnailText: z.array(z.string()).max(4).default([]),
}).strict();
export type TranslateMetadataRaw = z.infer<typeof TranslateMetadataRawSchema>;

export const CreateTranslationBodySchema = z.object({
  language: z.string().trim().min(2).max(16),
}).strict();
export type CreateTranslationBody = z.infer<typeof CreateTranslationBodySchema>;

export const TranslationChildSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  language: z.string(),
  status: z.string(),
  stage: z.string(),
  waitingReview: z.boolean(),
  mode: TranslationModeSchema,
}).strict();
export type TranslationChild = z.infer<typeof TranslationChildSchema>;

export const TranslationReviewSchema = z.object({
  childId: z.string().uuid(),
  language: z.string(),
  scenes: z.array(z.object({
    id: z.string(),
    original: z.string(),
    translated: z.string(),
  }).strict()),
}).strict();

export const TranslationViewSchema = z.object({
  targets: ProfileTranslationsSchema,
  children: z.array(TranslationChildSchema),
  review: TranslationReviewSchema.nullable(),
  youtubeHints: z.array(z.string()),
}).strict();
export type TranslationView = z.infer<typeof TranslationViewSchema>;
