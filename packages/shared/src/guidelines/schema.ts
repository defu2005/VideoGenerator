import { z } from "zod";
import { AspectRatioSchema } from "../enums.js";
import { OriginalitySettingsSchema } from "../originality/settings.js";

/** Where a rule applies; prompts pick the rules for their own target. */
export const GuidelineTargetSchema = z.enum(["script", "visuals", "music", "subtitles", "metadata"]);
export type GuidelineTarget = z.infer<typeof GuidelineTargetSchema>;

export const GuidelineSeveritySchema = z.enum(["MUST", "SHOULD", "TIP"]);
export type GuidelineSeverity = z.infer<typeof GuidelineSeveritySchema>;

export const GuidelinePackKindSchema = z.enum(["PLATFORM", "MARKET", "CHANNEL", "CUSTOM"]);
export type GuidelinePackKind = z.infer<typeof GuidelinePackKindSchema>;

export const GuidelineStrictnessSchema = z.enum(["REMIND", "FILTER"]);
export type GuidelineStrictness = z.infer<typeof GuidelineStrictnessSchema>;

const SlugSchema = z.string().trim().min(1).max(60).regex(/^[a-z0-9][a-z0-9_-]*$/, "Chỉ dùng chữ thường, số, _ và -");

/** A rule may carry a code check. Duration, hook and aspect checks read the pack's params. */
export const GuidelineRuleCheckSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("maxDuration") }).strict(),
  z.object({ kind: z.literal("hook") }).strict(),
  z.object({ kind: z.literal("aspectRatio") }).strict(),
  z.object({ kind: z.literal("license") }).strict(),
  z.object({ kind: z.literal("blockedWords"), words: z.array(z.string().trim().min(1).max(60)).min(1).max(100) }).strict(),
]);
export type GuidelineRuleCheck = z.infer<typeof GuidelineRuleCheckSchema>;

export const GuidelineRuleSchema = z.object({
  id: SlugSchema,
  text: z.string().trim().min(1).max(400),
  severity: GuidelineSeveritySchema,
  appliesTo: z.array(GuidelineTargetSchema).min(1),
  check: GuidelineRuleCheckSchema.optional(),
}).strict();
export type GuidelineRule = z.infer<typeof GuidelineRuleSchema>;

export const GuidelinePackParamsSchema = z.object({
  maxDurationSec: z.number().int().positive().optional(),
  hookWithinSec: z.number().positive().max(60).optional(),
  aspectRatios: z.array(AspectRatioSchema).min(1).optional(),
}).strict();
export type GuidelinePackParams = z.infer<typeof GuidelinePackParamsSchema>;

export const GuidelinePackSchema = z.object({
  id: z.union([SlugSchema, z.string().regex(/^market:[A-Z]{2}$/)]),
  kind: GuidelinePackKindSchema,
  name: z.string().trim().min(1).max(80),
  description: z.string().max(400).default(""),
  /** The date someone last compared the pack with the official pages (YYYY-MM-DD). */
  reviewedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sourceUrls: z.array(z.string().url()).max(10).default([]),
  params: GuidelinePackParamsSchema.optional(),
  rules: z.array(GuidelineRuleSchema).max(40),
  /** For a user copy: the built-in pack it started from. */
  basedOn: z.string().optional(),
}).strict();
export type GuidelinePack = z.infer<typeof GuidelinePackSchema>;

export const GUIDELINE_DISCLAIMER = "Đây là nhắc nhở tóm tắt, không thay thế chính sách chính thức.";

/** Per-project choice. `platformPack: "auto"` follows the project's platform; `channelPacks` unset follows its style. */
export const GuidelineSettingsSchema = z.object({
  originality: OriginalitySettingsSchema.optional(),
  platformPack: z.string().nullable().default("auto"),
  channelPacks: z.array(z.string()).max(3).optional(),
  customRules: z.array(z.string().trim().min(1).max(300)).max(20).default([]),
  /** Unset: FILTER from BALANCED up, REMIND in ECO. */
  strictness: GuidelineStrictnessSchema.optional(),
}).strict();
export type GuidelineSettings = z.infer<typeof GuidelineSettingsSchema>;

export const GuidelineSettingsInputSchema = z.object({
  originality: OriginalitySettingsSchema.optional(),
  platformPack: z.string().nullable().optional(),
  channelPacks: z.array(z.string()).max(3).nullable().optional(),
  customRules: z.array(z.string().trim().min(1).max(300)).max(20).optional(),
  strictness: GuidelineStrictnessSchema.nullable().optional(),
}).strict();
export type GuidelineSettingsInput = z.infer<typeof GuidelineSettingsInputSchema>;

/** A saved setup applied to new projects. */
export const GuidelineProfileSchema = z.object({
  id: SlugSchema,
  name: z.string().trim().min(1).max(80),
  guidelines: GuidelineSettingsSchema,
}).strict();
export type GuidelineProfile = z.infer<typeof GuidelineProfileSchema>;

export const GuidelineProfilesSchema = z.object({
  profiles: z.array(GuidelineProfileSchema).max(30).default([]),
  defaultProfileId: z.string().nullable().default(null),
}).strict();
export type GuidelineProfiles = z.infer<typeof GuidelineProfilesSchema>;

/** User packs only; built-in packs are read-only and always listed. */
export const SaveGuidelinePacksInputSchema = z.object({
  packs: z.array(GuidelinePackSchema).max(50),
}).strict();
export type SaveGuidelinePacksInput = z.infer<typeof SaveGuidelinePacksInputSchema>;

export const GuidelinePacksResponseSchema = z.object({
  builtIn: z.array(GuidelinePackSchema),
  custom: z.array(GuidelinePackSchema),
  disclaimer: z.string(),
}).strict();
export type GuidelinePacksResponse = z.infer<typeof GuidelinePacksResponseSchema>;

export const GuidelineFindingStatusSchema = z.enum(["OPEN", "FIXED", "DISMISSED"]);
export type GuidelineFindingStatus = z.infer<typeof GuidelineFindingStatusSchema>;

export const GuidelineFindingSourceSchema = z.enum(["CODE", "LLM"]);

export const GuidelineFindingSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  stage: z.enum(["SCRIPT", "TIMELINE"]),
  source: GuidelineFindingSourceSchema,
  ruleId: z.string(),
  severity: GuidelineSeveritySchema,
  /** A scene id after SCENE_PLAN; a script section id for SCRIPT findings. Null means the whole video. */
  sceneId: z.string().nullable(),
  text: z.string(),
  quote: z.string().nullable(),
  suggestion: z.string().nullable(),
  status: GuidelineFindingStatusSchema,
  dismissedBy: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).strict();
export type GuidelineFinding = z.infer<typeof GuidelineFindingSchema>;

export const GuidelineFindingsResponseSchema = z.object({
  findings: z.array(GuidelineFindingSchema),
  strictness: GuidelineStrictnessSchema,
  activePacks: z.array(z.object({ id: z.string(), name: z.string(), kind: GuidelinePackKindSchema, reviewedAt: z.string() }).strict()),
  /** Scene ids that have an OPEN MUST finding. Derived, not stored. */
  needsAttentionSceneIds: z.array(z.string()),
}).strict();
export type GuidelineFindingsResponse = z.infer<typeof GuidelineFindingsResponseSchema>;

/** What the guidelineCheck LLM call must return. */
export const GuidelineCheckOutputSchema = z.object({
  findings: z.array(z.object({
    ruleId: z.string().min(1),
    severity: GuidelineSeveritySchema,
    sceneId: z.string().nullable(),
    quote: z.string().max(400),
    problem: z.string().min(1).max(500),
    suggestion: z.string().max(500),
  }).strict()).max(20),
}).strict();
export type GuidelineCheckOutput = z.infer<typeof GuidelineCheckOutputSchema>;
