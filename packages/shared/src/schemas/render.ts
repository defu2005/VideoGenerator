import { z } from "zod";

export const RenderIssueCodeSchema = z.enum([
  "DURATION_MISMATCH",
  "SIZE_MISMATCH",
  "NO_VIDEO",
  "NO_AUDIO",
  "BLACK_FRAMES",
  "THUMBNAIL_FAILED",
]);
export type RenderIssueCode = z.infer<typeof RenderIssueCodeSchema>;

export const RenderIssueSchema = z.object({
  code: RenderIssueCodeSchema,
  severity: z.enum(["WARN", "ERROR"]),
  sceneId: z.string().nullable(),
  message: z.string(),
}).strict();
export type RenderIssue = z.infer<typeof RenderIssueSchema>;

export const RenderReportSchema = z.object({
  /** False when any ERROR issue exists. Issues never delete the output. */
  ok: z.boolean(),
  expectedDurationSec: z.number().nonnegative(),
  durationSec: z.number().nonnegative(),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
  hasAudio: z.boolean(),
  issues: z.array(RenderIssueSchema),
  /** Scene ids that have a mid-frame thumbnail. */
  thumbnails: z.array(z.string()),
  clipsReused: z.number().int().nonnegative(),
  clipsRendered: z.number().int().nonnegative(),
  elapsedSec: z.number().nonnegative(),
}).strict();
export type RenderReport = z.infer<typeof RenderReportSchema>;

export const RenderSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  status: z.enum(["DONE", "FAILED"]),
  inputHash: z.string(),
  durationSec: z.number().nonnegative(),
  sizeBytes: z.number().int().nonnegative(),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
  hasCredits: z.boolean(),
  hasSubtitles: z.boolean(),
  report: RenderReportSchema,
  createdAt: z.string(),
}).strict();
export type Render = z.infer<typeof RenderSchema>;

export const ProjectRenderSchema = z.object({
  render: RenderSchema.nullable(),
}).strict();
export type ProjectRender = z.infer<typeof ProjectRenderSchema>;
