import { z } from "zod";
import { ComposePlanSchema } from "../compose/schema.js";
import { AspectRatioSchema } from "../enums.js";
import { TimelineSchema } from "./timeline.js";

/** One file the executor needs, found by content hash. The name never holds a control-plane path. */
export const ArtifactRefSchema = z.object({
  name: z.string().min(1).max(300),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  size: z.number().int().nonnegative(),
}).strict();
export type ArtifactRef = z.infer<typeof ArtifactRefSchema>;

/** The style resolved once for the video. Opaque to the bundle: only the executor's render code reads it. */
export const BundleVideoStyleSchema = z.object({
  fingerprint: z.string(),
  byShot: z.record(z.string(), z.unknown()),
  packId: z.string().nullable().optional(),
  packVersion: z.number().nullable().optional(),
  resolved: z.unknown().optional(),
  picks: z.array(z.unknown()).optional(),
}).passthrough();

export const BundleWordSchema = z.object({
  text: z.string(),
  startSec: z.number(),
  endSec: z.number(),
}).strict();

/**
 * Everything a stateless worker needs to run the execute part of a render.
 * Version 1. No secrets, no database rows, no absolute control-plane paths in a remote bundle.
 */
export const RenderBundleSchema = z.object({
  bundleVersion: z.literal(1),
  appVersion: z.string(),
  composeRenderVersion: z.number().int(),
  projectId: z.string(),
  profileId: z.string().nullable(),
  renderId: z.string(),
  aspect: AspectRatioSchema,
  timeline: TimelineSchema,
  composePlan: ComposePlanSchema.nullable(),
  videoStyle: BundleVideoStyleSchema.nullable(),
  assText: z.string().nullable(),
  wordsByScene: z.record(z.string(), z.array(BundleWordSchema)),
  sfx: z.array(z.object({ name: z.string(), startSec: z.number() }).strict()),
  clipHashes: z.array(z.string()),
  /** Logical names of image files that are crops for this aspect. */
  croppedNames: z.array(z.string()),
  creditsText: z.string(),
  recipeId: z.string(),
  language: z.string().nullable(),
  brandColor: z.string().nullable(),
  accentColor: z.string().nullable(),
  composeGraphics: z.enum(["off", "static", "animated"]),
  graphicGrain: z.boolean(),
  hasSrt: z.boolean(),
  files: z.array(ArtifactRefSchema),
}).strict();
export type RenderBundle = z.infer<typeof RenderBundleSchema>;

/** What the executor reports back as `report.json`. */
export const ExecuteReportSchema = z.object({
  clipsReused: z.number().int().nonnegative(),
  clipsRendered: z.number().int().nonnegative(),
  graphicShots: z.array(z.object({
    shotId: z.string(),
    kind: z.string(),
    renderPath: z.enum(["static", "animated", "reencoded"]),
  }).passthrough()),
  composeWarnings: z.array(z.string()),
  joinWarnings: z.array(z.string()),
}).strict();
export type ExecuteReport = z.infer<typeof ExecuteReportSchema>;

/** Output names a node may upload. Anything else is refused. */
export const NODE_OUTPUT_NAME = /^(final\.mp4|subtitles\.srt|credits\.txt|report\.json|thumbs\/\d{3}\.jpg)$/;
/** TASK-120: outputs of the VOICE stage (`audio/<scene id>.mp3|wav` and `result.json`) and of MEDIA_FETCH (`media/<name>.mp4`). */
export const NODE_VOICE_OUTPUT_NAME = /^(result\.json|audio\/[a-zA-Z0-9_-]{1,80}\.(mp3|wav))$/;
export const NODE_MEDIA_OUTPUT_NAME = /^(report\.json|media\/[a-z]+-[a-zA-Z0-9_-]+-\d+\.mp4)$/;

/** What a node writes as `result.json` for a VOICE job: one entry per scene it synthesized. */
export const VoiceResultSchema = z.object({
  scenes: z.array(z.object({
    sceneId: z.string(),
    hash: z.string().regex(/^[0-9a-f]{64}$/),
    file: z.string(),
    provider: z.string(),
    voice: z.string(),
    rate: z.string(),
    durationSec: z.number().nonnegative(),
    cues: z.array(z.object({ startSec: z.number(), endSec: z.number(), text: z.string() }).strict()),
    words: z.array(z.object({ startSec: z.number(), endSec: z.number(), text: z.string() }).strict()).optional(),
    timingSource: z.enum(["provider", "aligned", "estimated"]),
    characters: z.number().int().nonnegative(),
    costUsd: z.number().nonnegative().optional(),
  }).strict()),
}).strict();
export type VoiceResult = z.infer<typeof VoiceResultSchema>;

/** What a node writes as `report.json` for a MEDIA_FETCH job. */
export const MediaReportSchema = z.object({
  fetched: z.array(z.object({ target: z.string(), sha256: z.string().regex(/^[0-9a-f]{64}$/), size: z.number().int().nonnegative() }).strict()),
  skipped: z.array(z.object({ target: z.string(), reason: z.string().max(300) }).strict()),
}).strict();
export type MediaReport = z.infer<typeof MediaReportSchema>;
