import { z } from "zod";
import { PipelineStageSchema } from "../enums.js";

export const AUTO_REPORT_CODES = [
  "MUST_FINDING_OPEN",
  "VISUAL_LOW_FIT",
  "VISUAL_UNVERIFIED_LICENSE",
  "VISUAL_REUSED_NEIGHBOUR",
  "VISUAL_TITLE_CARD",
  "VISUAL_EXTRA_SEARCH",
  "VISUAL_SKIPPED",
  "VISUAL_DOWNLOAD_FAILED",
  "VISUAL_NEEDS_USER",
  "ORIGINALITY_NEEDS_USER",
  "MUSIC_AUTO_PICKED",
  "MUSIC_NONE",
  "RENDER_VISION_ISSUE",
  "FORMAT_CHOSEN",
] as const;

export const AutoReportCodeSchema = z.enum(AUTO_REPORT_CODES);
export type AutoReportCode = z.infer<typeof AutoReportCodeSchema>;

export const AutoReportSeveritySchema = z.enum(["INFO", "WARN"]);
export type AutoReportSeverity = z.infer<typeof AutoReportSeveritySchema>;

export const AutoReportEntrySchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  stage: PipelineStageSchema,
  sceneId: z.string().nullable(),
  code: AutoReportCodeSchema,
  severity: AutoReportSeveritySchema,
  message: z.string().min(1),
  data: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string().min(1),
}).strict();
export type AutoReportEntry = z.infer<typeof AutoReportEntrySchema>;

export const AutoReportStageGroupSchema = z.object({
  stage: PipelineStageSchema,
  entries: z.array(AutoReportEntrySchema),
}).strict();
export type AutoReportStageGroup = z.infer<typeof AutoReportStageGroupSchema>;

export const AutoReportResponseSchema = z.object({
  projectId: z.string().uuid(),
  warnCount: z.number().int().nonnegative(),
  groups: z.array(AutoReportStageGroupSchema),
}).strict();
export type AutoReportResponse = z.infer<typeof AutoReportResponseSchema>;
