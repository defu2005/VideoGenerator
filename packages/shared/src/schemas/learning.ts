import { z } from "zod";

export const LearningModeSchema = z.enum(["off", "suggest", "auto"]);
export type LearningMode = z.infer<typeof LearningModeSchema>;

export const NOT_ENOUGH_LEARNING_DATA = "Chưa đủ dữ liệu";

export const TITLE_AB_UNAVAILABLE_REASON =
  "Thử 2 tiêu đề chỉ hiện khi kênh YouTube đã cấp quyền đầy đủ youtube (không chỉ quyền tải lên). Đặt Playlist ID rồi Kết nối lại để xin quyền đó.";

export const InsightPatternKindSchema = z.enum(["topic", "hook", "length", "timing", "format"]);
export type InsightPatternKind = z.infer<typeof InsightPatternKindSchema>;

export const InsightConfidenceSchema = z.enum(["low", "medium", "high"]);
export type InsightConfidence = z.infer<typeof InsightConfidenceSchema>;

export const InsightPatternSchema = z.object({
  kind: InsightPatternKindSchema,
  finding: z.string().min(1),
  evidence: z.string().min(1),
  confidence: InsightConfidenceSchema,
}).strict();
export type InsightPattern = z.infer<typeof InsightPatternSchema>;

export const PreferredDurationSchema = z.object({
  min: z.number(),
  max: z.number(),
}).strict();
export type PreferredDuration = z.infer<typeof PreferredDurationSchema>;

export const InsightRecommendationsSchema = z.object({
  directionAddendum: z.string().max(600).optional(),
  preferredDurationSec: PreferredDurationSchema.optional(),
  publishTimes: z.array(z.string()).optional(),
  topicAngles: z.array(z.string()).max(8).optional(),
  avoid: z.array(z.string()).max(5).optional(),
}).strict();
export type InsightRecommendations = z.infer<typeof InsightRecommendationsSchema>;

/** Raw LLM output for performanceInsight. */
export const PerformanceInsightOutputSchema = z.object({
  summary: z.string().min(1).max(4000),
  patterns: z.array(InsightPatternSchema).max(12),
  recommendations: z.object({
    directionAddendum: z.string().max(2000).optional(),
    preferredDurationSec: PreferredDurationSchema.optional(),
    publishTimes: z.array(z.string()).max(12).optional(),
    topicAngles: z.array(z.string()).max(12).optional(),
    avoid: z.array(z.string()).max(12).optional(),
  }).strict(),
}).strict();
export type PerformanceInsightOutput = z.infer<typeof PerformanceInsightOutputSchema>;

export const InsightStatusSchema = z.enum(["new", "applied", "dismissed"]);
export type InsightStatus = z.infer<typeof InsightStatusSchema>;

export const InsightApplyFieldSchema = z.enum([
  "directionAddendum",
  "preferredDuration",
  "publishTimes",
  "topicAngles",
  "avoid",
]);
export type InsightApplyField = z.infer<typeof InsightApplyFieldSchema>;

export const ProfileInsightSchema = z.object({
  id: z.string().uuid(),
  profileId: z.string().uuid(),
  createdAt: z.string().datetime({ offset: true }),
  period: z.string(),
  status: InsightStatusSchema,
  summary: z.string(),
  patterns: z.array(InsightPatternSchema),
  recommendations: InsightRecommendationsSchema,
  appliedFields: z.array(InsightApplyFieldSchema),
  dismissedFields: z.array(InsightApplyFieldSchema),
}).strict();
export type ProfileInsight = z.infer<typeof ProfileInsightSchema>;

export const LearningViewSchema = z.object({
  learningMode: LearningModeSchema,
  learnedNotes: z.string(),
  titleAbTest: z.boolean(),
  titleAbAvailable: z.boolean(),
  titleAbReason: z.string().nullable(),
  scoredCount: z.number().int().nonnegative(),
  insufficient: z.boolean(),
  message: z.string().nullable(),
  canUndo: z.boolean(),
  latest: ProfileInsightSchema.nullable(),
  history: z.array(ProfileInsightSchema),
}).strict();
export type LearningView = z.infer<typeof LearningViewSchema>;

export const LearningSettingsBodySchema = z.object({
  learningMode: LearningModeSchema.optional(),
  titleAbTest: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: "At least one field must be provided",
});
export type LearningSettingsBody = z.infer<typeof LearningSettingsBodySchema>;

export const InsightRunResultSchema = z.object({
  status: z.enum(["insufficient", "stored", "applied", "skipped"]),
  message: z.string().nullable(),
  insight: ProfileInsightSchema.nullable(),
}).strict();
export type InsightRunResult = z.infer<typeof InsightRunResultSchema>;

export const ApplyInsightBodySchema = z.object({
  fields: z.array(InsightApplyFieldSchema).min(1),
}).strict();
export type ApplyInsightBody = z.infer<typeof ApplyInsightBodySchema>;

export const DismissInsightBodySchema = z.object({
  fields: z.array(InsightApplyFieldSchema).optional(),
}).strict();
export type DismissInsightBody = z.infer<typeof DismissInsightBodySchema>;
