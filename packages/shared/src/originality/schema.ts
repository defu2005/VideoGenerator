import { z } from "zod";
import { GuidelineFindingSchema } from "../guidelines/schema.js";
import { OriginalitySettingsSchema } from "./settings.js";
export { OriginalitySettingsSchema, DEFAULT_ORIGINALITY_SETTINGS, type OriginalitySettings } from "./settings.js";

/** Internal review thresholds; never presented as platform eligibility rules. */

export const SourceAssetSchema = z.object({
  sceneId: z.string(),
  assetId: z.string(),
  kind: z.enum(["own_template", "stock", "web", "ai_generated", "user_upload", "third_party_footage"]),
  sourceUrl: z.string().url().nullable(),
  license: z.object({ kind: z.string(), name: z.string(), url: z.string().url().nullable() }).nullable(),
  licenseVerified: z.boolean(),
  startSec: z.number().nonnegative(),
  screenSeconds: z.number().nonnegative(),
  pHash: z.string().nullable(),
}).strict();
export type SourceAsset = z.infer<typeof SourceAssetSchema>;
export const ContributionSchema = z.object({
  ownShare: z.number().min(0).max(1),
  narratedAnalysisShare: z.number().min(0).max(1),
  templateShare: z.number().min(0).max(1),
  thirdPartySourceCount: z.number().int().nonnegative(),
  aiGeneratedShare: z.number().min(0).max(1),
  unknownLicenseShare: z.number().min(0).max(1),
}).strict();
export const SourceManifestSchema = z.object({
  script: z.object({
    sources: z.array(z.object({ url: z.string().url(), title: z.string() }).strict()),
    narrationWordCount: z.number().int().nonnegative(),
    hasAnalysis: z.boolean(),
    analysisSectionIds: z.array(z.string()),
  }).strict(),
  assets: z.array(SourceAssetSchema),
  voice: z.array(z.object({ sceneId: z.string(), provider: z.string(), voice: z.string() }).strict()),
  contribution: ContributionSchema,
  /** A dismissal applies only to exactly the evidence that the user reviewed. */
  history: z.array(z.object({ findingId: z.string(), ruleId: z.string(), reason: z.string(), at: z.string(), evidenceHash: z.string() }).strict()),
  timelineHash: z.string(),
  renderTimelineHash: z.string().nullable(),
  /** Rendered assets are retained for rechecks of this exact timeline. */
  renderedAssets: z.array(SourceAssetSchema).nullable(),
}).strict();
export type SourceManifest = z.infer<typeof SourceManifestSchema>;
const MatchSchema = z.object({ projectId: z.string(), title: z.string(), similarity: z.number().min(0).max(1) }).nullable();
export const OriginalityScoresSchema = z.object({
  script: MatchSchema,
  title: MatchSchema,
  reusedImages: z.number().int().nonnegative(),
  imageMatches: z.array(z.object({ assetId: z.string(), projectId: z.string(), title: z.string() }).strict()),
  comparedProjects: z.number().int().nonnegative(),
}).strict();
export type OriginalityScores = z.infer<typeof OriginalityScoresSchema>;
export const OriginalityReportSchema = z.object({
  projectId: z.string(), renderId: z.string().nullable(),
  manifest: SourceManifestSchema.nullable(), scores: OriginalityScoresSchema.nullable(),
  verdict: z.enum(["OK", "REVIEW"]), settings: OriginalitySettingsSchema,
  findings: z.array(GuidelineFindingSchema), updatedAt: z.string().nullable(),
}).strict();
export type OriginalityReport = z.infer<typeof OriginalityReportSchema>;
