import { z } from "zod";
/** Internal review thresholds; never presented as platform eligibility rules. */
export const OriginalitySettingsSchema = z.object({
  maxScriptSimilarity: z.number().min(0).max(1).default(0.5),
  maxReusedImages: z.number().int().min(0).max(10000).default(3),
  minOwnContributionShare: z.number().min(0).max(1).default(0.3),
  requireNarration: z.boolean().default(true),
  previousVideoLimit: z.number().int().min(1).max(100).default(30),
}).strict();
export type OriginalitySettings = z.infer<typeof OriginalitySettingsSchema>;
export const DEFAULT_ORIGINALITY_SETTINGS = OriginalitySettingsSchema.parse({});
