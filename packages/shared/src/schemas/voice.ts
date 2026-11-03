import { z } from "zod";

export const TtsVoiceSchema = z.object({
  language: z.string().min(1),
  gender: z.enum(["female", "male", "neutral", "unknown"]).optional(),
  name: z.string().min(1),
  multilingual: z.boolean().default(false),
}).strict();
export type TtsVoice = z.infer<typeof TtsVoiceSchema>;

export const VoiceCueSchema = z.object({
  startSec: z.number().nonnegative(),
  endSec: z.number().nonnegative(),
  text: z.string().min(1),
}).strict();
export type VoiceCue = z.infer<typeof VoiceCueSchema>;

export const VoiceTrackSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  sceneId: z.string().uuid(),
  provider: z.string().min(1),
  voice: z.string().min(1),
  rate: z.string().min(1),
  origin: z.enum(["AGENT", "USER"]),
  audioPath: z.string().min(1),
  durationSec: z.number().nonnegative(),
  cues: z.array(VoiceCueSchema).default([]),
  inputHash: z.string().min(1),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
}).strict();
export type VoiceTrack = z.infer<typeof VoiceTrackSchema>;

export const TtsVoicesResponseSchema = z.object({
  voices: z.array(TtsVoiceSchema),
}).strict();

export const ProjectVoiceSummarySchema = z.object({
  voice: z.string().nullable(),
  rate: z.string().nullable(),
  provider: z.string().nullable(),
  tracks: z.array(VoiceTrackSchema),
  totalDurationSec: z.number().nonnegative(),
  missingSceneIds: z.array(z.string().uuid()),
}).strict();
export type ProjectVoiceSummary = z.infer<typeof ProjectVoiceSummarySchema>;

export const VoiceTrackUploadSchema = z.object({
  fileName: z.string().min(1),
  contentType: z.string().min(1),
  durationSec: z.number().nonnegative(),
  cues: z.array(VoiceCueSchema).default([]),
  inputHash: z.string().min(1),
}).strict();
