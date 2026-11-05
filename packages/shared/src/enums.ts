import { z } from "zod";

export const PROJECT_STATUSES = [
  "DRAFT",
  "GENERATING",
  "REVIEW",
  "RENDERING",
  "COMPLETED",
  "FAILED",
] as const;
export const ProjectStatusSchema = z.enum(PROJECT_STATUSES);
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

export const PIPELINE_STAGES = [
  "TOPIC",
  "RESEARCH",
  "SCRIPT",
  "SCENE_PLAN",
  "VISUAL_SEARCH",
  "VISUAL_REVIEW",
  "VOICE",
  "SUBTITLE",
  "MUSIC_SEARCH",
  "MUSIC_REVIEW",
  "TIMELINE",
  "FINAL_APPROVAL",
  "RENDER",
  "DONE",
  /** Side job: not in STAGE_ORDER; publish worker only. */
  "PUBLISH",
  /** Side job: cut a vertical short from a finished render. */
  "CLIP",
] as const;
export const PipelineStageSchema = z.enum(PIPELINE_STAGES);
export type PipelineStage = z.infer<typeof PipelineStageSchema>;

export function isPublishStage(stage: PipelineStage): boolean {
  return stage === "PUBLISH";
}

/** Jobs that must not move pipeline stages (publish and clip export). */
export function isSideJobStage(stage: PipelineStage): boolean {
  return stage === "PUBLISH" || stage === "CLIP";
}

export const AUTONOMY_MODES = ["AUTO", "ASSISTED", "MANUAL"] as const;
export const AutonomyModeSchema = z.enum(AUTONOMY_MODES);
export type AutonomyMode = z.infer<typeof AutonomyModeSchema>;

export const STAGE_EXECUTORS = ["AGENT", "USER"] as const;
export const StageExecutorSchema = z.enum(STAGE_EXECUTORS);
export type StageExecutor = z.infer<typeof StageExecutorSchema>;

export const VISUAL_STATUSES = [
  "DISCOVERED",
  "REVIEW_REQUIRED",
  "APPROVED",
  "REJECTED",
  "REPLACED",
  "CUSTOM",
  "AI_GENERATED",
] as const;
export const VisualStatusSchema = z.enum(VISUAL_STATUSES);
export type VisualStatus = z.infer<typeof VisualStatusSchema>;

export const SCENE_VISUAL_STATUSES = [
  "NO_VISUAL",
  "SEARCHING",
  "REVIEW_REQUIRED",
  "NEEDS_ATTENTION",
  "APPROVED",
  "READY_FOR_RENDER",
  "SKIPPED",
] as const;
export const SceneVisualStatusSchema = z.enum(SCENE_VISUAL_STATUSES);
export type SceneVisualStatus = z.infer<typeof SceneVisualStatusSchema>;

export const CANDIDATE_ORIGINS = ["SEARCH", "CUSTOM_URL", "UPLOAD", "AI_GENERATED"] as const;
export const CandidateOriginSchema = z.enum(CANDIDATE_ORIGINS);
export type CandidateOrigin = z.infer<typeof CandidateOriginSchema>;

export const WATERMARK_STATUSES = ["NONE", "SUSPECTED", "UNKNOWN"] as const;
export const WatermarkStatusSchema = z.enum(WATERMARK_STATUSES);
export type WatermarkStatus = z.infer<typeof WatermarkStatusSchema>;

export const LICENSE_KINDS = [
  "CC0",
  "PUBLIC_DOMAIN",
  "CC_BY",
  "CC_BY_SA",
  "CC_BY_NC",
  "CC_BY_ND",
  "CC_BY_NC_SA",
  "CC_BY_NC_ND",
  "ROYALTY_FREE",
  "PIXABAY",
  "ALL_RIGHTS_RESERVED",
  "UNKNOWN",
  "USER_PROVIDED",
  "AI_GENERATED",
] as const;
export const LicenseKindSchema = z.enum(LICENSE_KINDS);
export type LicenseKind = z.infer<typeof LicenseKindSchema>;

export const JOB_STATUSES = ["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"] as const;
export const JobStatusSchema = z.enum(JOB_STATUSES);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const ASPECT_RATIOS = ["16:9", "9:16", "1:1"] as const;
export const AspectRatioSchema = z.enum(ASPECT_RATIOS);
export type AspectRatio = z.infer<typeof AspectRatioSchema>;

export const PROJECT_STATUS_VALUES = PROJECT_STATUSES;
