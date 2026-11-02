import { z } from "zod";
import {
  AspectRatioSchema,
  AutonomyModeSchema,
  PipelineStageSchema,
  ProjectStatusSchema,
  StageExecutorSchema,
} from "../enums.js";
import { LlmSelectionSchema } from "./llm.js";
import {
  BudgetSettingsInputSchema,
  BudgetSettingsSchema,
} from "../budget/modes.js";

export const VideoBriefSettingsSchema = z.object({
  budget: BudgetSettingsSchema.default({ mode: "BALANCED" }),
  language: z.string().default("vi"),
  targetDurationSec: z.number().int().min(30).max(1800).default(120),
  aspectRatio: AspectRatioSchema.default("16:9"),
  platform: z.enum(["youtube", "youtube_shorts", "tiktok", "facebook_reels", "custom"]).default("youtube"),
  style: z.enum(["storytelling", "documentary", "explainer", "news", "listicle"]).default("storytelling"),
  tone: z.enum(["neutral", "dramatic", "inspiring", "humorous", "serious"]).default("dramatic"),
  audience: z.enum(["general", "kids", "students", "professionals"]).default("general"),
  wordsPerMinute: z.number().int().min(100).max(220).default(150),
  sceneDurationSec: z.number().int().min(2).max(20).default(7),
  visualStyle: z.enum(["photo", "illustration", "mixed"]).default("mixed"),
  subtitles: z.object({
    enabled: z.boolean().default(true),
    maxCharsPerLine: z.number().int().positive().default(42),
  }).default({ enabled: true, maxCharsPerLine: 42 }),
  music: z.object({
    enabled: z.boolean().default(true),
    volume: z.number().min(0).max(1).default(0.15),
  }).default({ enabled: true, volume: 0.15 }),
  userSet: z.array(z.string()).default([]),
});

export const VideoBriefSettingsInputSchema = z.object({
  budget: BudgetSettingsInputSchema.optional(),
  platform: z.enum(["youtube", "youtube_shorts", "tiktok", "facebook_reels", "custom"]).optional(),
  style: z.enum(["storytelling", "documentary", "explainer", "news", "listicle"]).optional(),
  tone: z.enum(["neutral", "dramatic", "inspiring", "humorous", "serious"]).optional(),
  audience: z.enum(["general", "kids", "students", "professionals"]).optional(),
  wordsPerMinute: z.number().int().min(100).max(220).optional(),
  sceneDurationSec: z.number().int().min(2).max(20).optional(),
  visualStyle: z.enum(["photo", "illustration", "mixed"]).optional(),
  subtitles: z.object({
    enabled: z.boolean().optional(),
    maxCharsPerLine: z.number().int().positive().optional(),
  }).strict().optional(),
  music: z.object({
    enabled: z.boolean().optional(),
    volume: z.number().min(0).max(1).optional(),
  }).strict().optional(),
  userSet: z.array(z.string()).optional(),
}).strict();

const DirectBriefInputFields = {
  ...VideoBriefSettingsInputSchema.shape,
  language: z.string().optional(),
  targetDurationSec: z.number().int().min(30).max(1800).optional(),
  aspectRatio: AspectRatioSchema.optional(),
};

export const ProjectSettingsSchema = z.object({
  language: z.string().default("vi"),
  targetDurationSec: z.number().int().min(30).max(1800).default(120),
  researchMode: z.enum(["merged", "separate", "off"]).optional(),
  aspectRatio: AspectRatioSchema.default("16:9"),
  stageExecutors: z.object({
    script: StageExecutorSchema.optional(),
    visuals: StageExecutorSchema.optional(),
    voice: StageExecutorSchema.optional(),
    music: StageExecutorSchema.optional(),
  }).default({}),
  llm: z.object({
    default: LlmSelectionSchema.optional(),
    research: LlmSelectionSchema.optional(),
    script: LlmSelectionSchema.optional(),
    sceneplan: LlmSelectionSchema.optional(),
  }).optional(),
  autoRender: z.boolean().default(false),
}).extend({
  budget: VideoBriefSettingsSchema.shape.budget,
  platform: VideoBriefSettingsSchema.shape.platform,
  style: VideoBriefSettingsSchema.shape.style,
  tone: VideoBriefSettingsSchema.shape.tone,
  audience: VideoBriefSettingsSchema.shape.audience,
  wordsPerMinute: VideoBriefSettingsSchema.shape.wordsPerMinute,
  sceneDurationSec: VideoBriefSettingsSchema.shape.sceneDurationSec,
  visualStyle: VideoBriefSettingsSchema.shape.visualStyle,
  subtitles: VideoBriefSettingsSchema.shape.subtitles,
  music: VideoBriefSettingsSchema.shape.music,
  userSet: VideoBriefSettingsSchema.shape.userSet,
});
export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>;

export const ProjectSettingsInputSchema = z.object({
  language: z.string().optional(),
  targetDurationSec: z.number().int().min(30).max(1800).optional(),
  researchMode: z.enum(["merged", "separate", "off"]).optional(),
  aspectRatio: AspectRatioSchema.optional(),
  stageExecutors: z.object({
    script: StageExecutorSchema.optional(),
    visuals: StageExecutorSchema.optional(),
    voice: StageExecutorSchema.optional(),
    music: StageExecutorSchema.optional(),
  }).optional(),
  llm: z.object({
    default: LlmSelectionSchema.optional(),
    research: LlmSelectionSchema.optional(),
    script: LlmSelectionSchema.optional(),
    sceneplan: LlmSelectionSchema.optional(),
  }).optional(),
  autoRender: z.boolean().optional(),
  ...VideoBriefSettingsInputSchema.shape,
}).strict();
export type ProjectSettingsInput = z.infer<typeof ProjectSettingsInputSchema>;

export const ProjectSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(200),
  description: z.string().max(2000),
  topic: z.string().min(1).max(2000),
  mode: AutonomyModeSchema,
  settings: ProjectSettingsSchema,
  status: ProjectStatusSchema,
  stage: PipelineStageSchema,
  thumbnailPath: z.string().nullable(),
  durationSec: z.number().nullable(),
  version: z.number().int().positive(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  archivedAt: z.string().datetime({ offset: true }).nullable(),
});
export type Project = z.infer<typeof ProjectSchema>;

export const CreateProjectInputSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  topic: z.string().trim().min(1).max(2000),
  description: z.string().max(2000).optional(),
  mode: AutonomyModeSchema.optional(),
  settings: ProjectSettingsInputSchema.optional(),
  ...DirectBriefInputFields,
}).strict();
export type CreateProjectInput = z.infer<typeof CreateProjectInputSchema>;

export const RecommendationSchema = z.object({
  value: z.unknown(),
  reason: z.string(),
  source: z.enum(["user", "recommended"]),
}).strict();
export const RecommendationsSchema = z.record(z.string(), RecommendationSchema);
export const RecommendBriefResponseSchema = z.object({
  values: z.object({
    title: z.string(),
    mode: AutonomyModeSchema,
    settings: VideoBriefSettingsSchema,
  }),
  recommendations: RecommendationsSchema,
  warnings: z.array(z.string()),
}).strict();
export type RecommendBriefResponse = z.infer<typeof RecommendBriefResponseSchema>;

export const CreateProjectResponseSchema = ProjectSchema.extend({
  recommendations: RecommendationsSchema,
  warnings: z.array(z.string()),
});
export type CreateProjectResponse = z.infer<typeof CreateProjectResponseSchema>;

export const UpdateProjectInputSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  topic: z.string().trim().min(1).max(2000).optional(),
  mode: AutonomyModeSchema.optional(),
  settings: ProjectSettingsInputSchema.optional(),
  ...DirectBriefInputFields,
  resetToRecommended: z.array(z.string()).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: "At least one field must be provided",
});
export type UpdateProjectInput = z.infer<typeof UpdateProjectInputSchema>;

const StatusQuerySchema = z.preprocess(
  (value) => typeof value === "string" ? value.split(",").map((status) => status.trim()) : value,
  z.array(ProjectStatusSchema).optional(),
);

const BooleanQuerySchema = z.preprocess((value) => {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}, z.boolean());

const PositiveIntegerQuerySchema = z.preprocess(
  (value) => typeof value === "string" ? Number(value) : value,
  z.number().int().positive(),
);
const PageSizeQuerySchema = PositiveIntegerQuerySchema.refine((value) => value <= 100, {
  message: "Number must be less than or equal to 100",
});

export const ProjectListQuerySchema = z.object({
  q: z.string().optional(),
  status: StatusQuerySchema,
  includeArchived: BooleanQuerySchema.default(false),
  archivedOnly: BooleanQuerySchema.default(false),
  sort: z.enum(["updatedAt", "createdAt", "title"]).default("updatedAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
  page: PositiveIntegerQuerySchema.default(1),
  pageSize: PageSizeQuerySchema.default(20),
}).strict();
export type ProjectListQuery = z.infer<typeof ProjectListQuerySchema>;

export const ProjectListResponseSchema = z.object({
  items: z.array(ProjectSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type ProjectListResponse = z.infer<typeof ProjectListResponseSchema>;
