import { z } from "zod";

export const MusicAssistOutputSchema = z.object({
  mood: z.string().min(1),
  energy: z.enum(["low", "medium", "high"]),
  queries: z.array(z.string().min(1)).min(1).max(3),
  avoid: z.array(z.string()).default([]),
  why: z.string().min(1),
}).strict();
export type MusicAssistOutput = z.infer<typeof MusicAssistOutputSchema>;

export const VideoMetadataDraftSchema = z.object({
  titles: z.array(z.string().max(100)).min(1).max(3),
  description: z.string().max(1500),
  tags: z.array(z.string()).max(15),
  hashtags: z.array(z.string()).max(5),
  thumbnailText: z.array(z.string()).max(2),
}).strict();
export type VideoMetadataDraft = z.infer<typeof VideoMetadataDraftSchema>;

export const VideoMetadataSourceSchema = z.enum(["LLM", "CODE"]);
export type VideoMetadataSource = z.infer<typeof VideoMetadataSourceSchema>;

export const VideoMetadataSchema = z.object({
  projectId: z.string().uuid(),
  inputHash: z.string(),
  draft: VideoMetadataDraftSchema,
  edited: VideoMetadataDraftSchema.nullable(),
  source: VideoMetadataSourceSchema,
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
}).strict();
export type VideoMetadata = z.infer<typeof VideoMetadataSchema>;

export const VideoMetadataExtrasSchema = z.object({
  chaptersText: z.string(),
  creditsText: z.string(),
  disclosure: z.string(),
}).strict();
export type VideoMetadataExtras = z.infer<typeof VideoMetadataExtrasSchema>;

export const VideoMetadataResponseSchema = z.object({
  metadata: VideoMetadataSchema.nullable(),
  stale: z.boolean(),
  extras: VideoMetadataExtrasSchema.optional(),
}).strict();
export type VideoMetadataResponse = z.infer<typeof VideoMetadataResponseSchema>;

export const VideoMetadataGenerateRequestSchema = z.object({
  overwriteEdits: z.boolean().optional(),
}).strict();
export type VideoMetadataGenerateRequest = z.infer<typeof VideoMetadataGenerateRequestSchema>;

export const VideoMetadataEditSchema = VideoMetadataDraftSchema;
export type VideoMetadataEdit = z.infer<typeof VideoMetadataEditSchema>;

export const DEFAULT_AI_DISCLOSURE =
  "Video có sử dụng giọng đọc tổng hợp và nội dung do AI hỗ trợ.";
