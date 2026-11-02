import { z } from "zod";
import {
  AspectRatioSchema,
  AutonomyModeSchema,
  PipelineStageSchema,
  ProjectStatusSchema,
  StageExecutorSchema,
} from "../enums.js";

export const ProjectSettingsSchema = z.object({
  language: z.string().default("vi"),
  targetDurationSec: z.number().int().min(30).max(1800).default(120),
  aspectRatio: AspectRatioSchema.default("16:9"),
  stageExecutors: z.object({
    visuals: StageExecutorSchema.optional(),
    voice: StageExecutorSchema.optional(),
    music: StageExecutorSchema.optional(),
  }).default({}),
  autoRender: z.boolean().default(false),
});
export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>;

export const ProjectSettingsInputSchema = z.object({
  language: z.string().optional(),
  targetDurationSec: z.number().int().min(30).max(1800).optional(),
  aspectRatio: AspectRatioSchema.optional(),
  stageExecutors: z.object({
    visuals: StageExecutorSchema.optional(),
    voice: StageExecutorSchema.optional(),
    music: StageExecutorSchema.optional(),
  }).optional(),
  autoRender: z.boolean().optional(),
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
  title: z.string().trim().min(1).max(200),
  topic: z.string().trim().min(1).max(2000),
  description: z.string().max(2000).optional().default(""),
  mode: AutonomyModeSchema.default("ASSISTED"),
  settings: ProjectSettingsInputSchema.optional().default({}),
}).strict();
export type CreateProjectInput = z.infer<typeof CreateProjectInputSchema>;

export const UpdateProjectInputSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  topic: z.string().trim().min(1).max(2000).optional(),
  mode: AutonomyModeSchema.optional(),
  settings: ProjectSettingsInputSchema.optional(),
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
