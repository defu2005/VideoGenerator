import { z } from "zod";
import { LicenseKindSchema } from "../enums.js";
import { VisualMotionSchema } from "./visual.js";

export const RenderTargetSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().int().positive(),
}).strict();
export type RenderTarget = z.infer<typeof RenderTargetSchema>;

export const TimelineVisualSchema = z.object({
  kind: z.enum(["IMAGE", "PLACEHOLDER"]),
  candidateId: z.string().nullable(),
  /** Relative to the project folder (or absolute). Null for placeholders. */
  path: z.string().nullable(),
  startSec: z.number().nonnegative(),
  endSec: z.number().nonnegative(),
  motion: VisualMotionSchema,
  licenseKind: LicenseKindSchema.nullable(),
}).strict();
export type TimelineVisual = z.infer<typeof TimelineVisualSchema>;

export const TimelineSceneSchema = z.object({
  sceneId: z.string(),
  order: z.number().int().nonnegative(),
  label: z.string(),
  startSec: z.number().nonnegative(),
  endSec: z.number().nonnegative(),
  durationSec: z.number().positive(),
  /** Whole frames at target fps; the renderer uses this, so concat never drifts. */
  durationFrames: z.number().int().positive(),
  voice: z.object({
    trackId: z.string(),
    path: z.string(),
    startSec: z.number().nonnegative(),
    durationSec: z.number().nonnegative(),
  }).strict().nullable(),
  visuals: z.array(TimelineVisualSchema).min(1),
  /** Fades happen inside the clip, so they never change the scene duration. */
  fadeInSec: z.number().nonnegative(),
  fadeOutSec: z.number().nonnegative(),
}).strict();
export type TimelineScene = z.infer<typeof TimelineSceneSchema>;

export const TimelineMusicSchema = z.object({
  candidateId: z.string(),
  title: z.string(),
  path: z.string(),
  sourceDurationSec: z.number().nonnegative().nullable(),
  loop: z.boolean(),
  startOffsetSec: z.number().nonnegative(),
  volume: z.number().min(0).max(1),
  fadeInSec: z.number().nonnegative(),
  fadeOutSec: z.number().nonnegative(),
  duckingDb: z.number().max(0),
  licenseKind: LicenseKindSchema.nullable(),
}).strict();
export type TimelineMusic = z.infer<typeof TimelineMusicSchema>;

export const TimelineWarningCodeSchema = z.enum([
  "VISUAL_MISSING",
  "VISUAL_NOT_APPROVED",
  "DURATION_OVERRIDE_TOO_SHORT",
  "MUSIC_NOT_READY",
  "LICENSE_UNKNOWN",
  "LICENSE_NON_COMMERCIAL",
]);
export type TimelineWarningCode = z.infer<typeof TimelineWarningCodeSchema>;

export const TimelineWarningSchema = z.object({
  code: TimelineWarningCodeSchema,
  sceneId: z.string().nullable(),
  message: z.string(),
}).strict();
export type TimelineWarning = z.infer<typeof TimelineWarningSchema>;

export const TimelineSchema = z.object({
  formatVersion: z.number().int().positive(),
  target: RenderTargetSchema,
  totalDurationSec: z.number().nonnegative(),
  scenes: z.array(TimelineSceneSchema),
  music: TimelineMusicSchema.nullable(),
  subtitles: z.object({
    srtPath: z.string(),
    assPath: z.string(),
    cueCount: z.number().int().nonnegative(),
  }).strict().nullable(),
  warnings: z.array(TimelineWarningSchema),
  /** Count of assets per license kind (visuals + music). A warning source, never a block. */
  licenseSummary: z.record(z.string(), z.number().int().nonnegative()),
}).strict();
export type Timeline = z.infer<typeof TimelineSchema>;

export const ProjectTimelineSchema = z.object({
  timeline: TimelineSchema.nullable(),
  inputHash: z.string().nullable(),
  updatedAt: z.string().nullable(),
}).strict();
export type ProjectTimeline = z.infer<typeof ProjectTimelineSchema>;
