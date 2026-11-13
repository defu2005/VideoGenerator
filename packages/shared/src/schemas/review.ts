import { z } from "zod";
import { PipelineStageSchema } from "../enums.js";
import { EmphasisEffectSchema, SubtitleStyleIdSchema, TransitionTypeSchema } from "../edit/plan.js";
import { MotionTemplateIdSchema } from "../motion/templates.js";
import { VisualMotionSchema } from "./visual.js";

const ReviewProposalUnion = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("EDIT_NARRATION"),
    sceneId: z.string().uuid(),
    text: z.string().min(1).max(4000),
  }).strict(),
  z.object({
    type: z.literal("EDIT_DURATION"),
    sceneId: z.string().uuid(),
    durationSec: z.number().min(1).max(60).nullable(),
  }).strict(),
  z.object({
    type: z.literal("EDIT_VISUAL_QUERY"),
    sceneId: z.string().uuid(),
    query: z.string().trim().min(1).max(300),
  }).strict(),
  z.object({
    type: z.literal("SET_MOTION"),
    sceneId: z.string().uuid(),
    slot: z.number().int().nonnegative(),
    motion: VisualMotionSchema,
  }).strict(),
  z.object({
    type: z.literal("MUSIC_MIX"),
    volume: z.number().min(0).max(1).optional(),
    duckingDb: z.number().min(-40).max(0).optional(),
    fadeInSec: z.number().min(0).max(30).optional(),
    fadeOutSec: z.number().min(0).max(30).optional(),
  }).strict(),
  z.object({
    type: z.literal("MUSIC_QUERY"),
    query: z.string().trim().min(1).max(200),
  }).strict(),
  z.object({
    type: z.literal("REORDER_SCENES"),
    sceneIds: z.array(z.string().uuid()).min(1),
  }).strict(),
  z.object({
    type: z.literal("EDIT_METADATA"),
    title: z.string().max(100).optional(),
    description: z.string().max(1500).optional(),
    tags: z.array(z.string()).max(15).optional(),
  }).strict(),
  z.object({
    type: z.literal("NOTE"),
    text: z.string().min(1).max(2000),
  }).strict(),
  z.object({
    type: z.literal("SET_TRANSITION"),
    afterSceneId: z.string().uuid(),
    transitionType: TransitionTypeSchema,
    durationSec: z.number(),
  }).strict(),
  z.object({
    type: z.literal("SET_EMPHASIS"),
    sceneId: z.string().uuid(),
    wordIndexStart: z.number().int().nonnegative(),
    wordIndexEnd: z.number().int().nonnegative(),
    effects: z.array(EmphasisEffectSchema).min(1),
  }).strict(),
  z.object({
    type: z.literal("REMOVE_EMPHASIS"),
    sceneId: z.string().uuid(),
    wordIndexStart: z.number().int().nonnegative(),
  }).strict(),
  z.object({
    type: z.literal("ADD_GRAPHIC"),
    sceneId: z.string().uuid().nullable(),
    templateId: MotionTemplateIdSchema,
    startSec: z.number().nonnegative().optional(),
    durationSec: z.number().positive().optional(),
    variables: z.record(z.string(), z.union([z.string(), z.number()])),
  }).strict(),
  z.object({
    type: z.literal("EDIT_GRAPHIC"),
    graphicId: z.string().min(1),
    templateId: MotionTemplateIdSchema.optional(),
    startSec: z.number().nonnegative().optional(),
    durationSec: z.number().positive().optional(),
    variables: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  }).strict(),
  z.object({
    type: z.literal("REMOVE_GRAPHIC"),
    graphicId: z.string().min(1),
  }).strict(),
  z.object({
    type: z.literal("SET_SUBTITLE_STYLE"),
    style: SubtitleStyleIdSchema,
  }).strict(),
  z.object({
    type: z.literal("DELETE_SCENE"),
    sceneId: z.string().uuid(),
  }).strict(),
  z.object({
    type: z.literal("SPLIT_SCENE"),
    sceneId: z.string().uuid(),
    atWordIndex: z.number().int().positive(),
  }).strict(),
  z.object({
    type: z.literal("REGENERATE_SCENE_VOICE"),
    sceneId: z.string().uuid(),
  }).strict(),
]);

export const ReviewProposalSchema = z.intersection(
  ReviewProposalUnion,
  z.object({ baseRevision: z.number().int().nonnegative().optional() }),
);
export type ReviewProposal = z.infer<typeof ReviewProposalSchema>;

export const ReviewAssistantOutputSchema = z.object({
  reply: z.string().min(1),
  proposals: z.array(ReviewProposalSchema).max(20),
}).strict();
export type ReviewAssistantOutput = z.infer<typeof ReviewAssistantOutputSchema>;

export const ReviewMessageRoleSchema = z.enum(["user", "assistant"]);
export type ReviewMessageRole = z.infer<typeof ReviewMessageRoleSchema>;

export const ReviewMessageUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative().optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
  cached: z.boolean().optional(),
}).strict();
export type ReviewMessageUsage = z.infer<typeof ReviewMessageUsageSchema>;

export const ReviewMessageSchema = z.object({
  id: z.string().uuid(),
  threadId: z.string().uuid(),
  role: ReviewMessageRoleSchema,
  content: z.string(),
  proposals: z.array(ReviewProposalSchema).nullable(),
  appliedIndexes: z.array(z.number().int().nonnegative()).default([]),
  usage: ReviewMessageUsageSchema.nullable(),
  createdAt: z.string().datetime({ offset: true }),
}).strict();
export type ReviewMessage = z.infer<typeof ReviewMessageSchema>;

export const ReviewThreadSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  contextHash: z.string(),
  createdAt: z.string().datetime({ offset: true }),
  messages: z.array(ReviewMessageSchema),
}).strict();
export type ReviewThread = z.infer<typeof ReviewThreadSchema>;

export const ReviewSendSchema = z.object({
  text: z.string().trim().min(1).max(4000),
  /** TODO(TASK-004G): accept but ignore until vision adapters exist. */
  attachImages: z.boolean().optional(),
}).strict();
export type ReviewSend = z.infer<typeof ReviewSendSchema>;

export const ReviewEstimateSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
}).strict();
export type ReviewEstimate = z.infer<typeof ReviewEstimateSchema>;

export const ReviewGetResponseSchema = z.object({
  thread: ReviewThreadSchema.nullable(),
  estimate: ReviewEstimateSchema.optional(),
  contextHash: z.string().optional(),
}).strict();
export type ReviewGetResponse = z.infer<typeof ReviewGetResponseSchema>;

export const ReviewApplyResultSchema = z.object({
  result: z.unknown(),
  staleStages: z.array(PipelineStageSchema),
}).strict();
export type ReviewApplyResult = z.infer<typeof ReviewApplyResultSchema>;

export const REVIEW_FULL_CRITIQUE_PROMPT =
  "Hãy xem lại toàn bộ video trước khi render theo các định hướng nội dung đang áp dụng. Đánh giá: (1) hook mở đầu, (2) nhịp độ/pacing, (3) hình có khớp lời kể không, (4) nhạc nền có phù hợp không, (5) rủi ro chính sách. Đưa đề xuất cụ thể khi cần.";

export const REVIEW_SUGGESTED_CHIPS = [
  "Mở đầu cuốn hơn",
  "Rút ngắn còn 60s",
  "Kiểm tra chính sách",
  "Đổi giọng kể kịch tính hơn",
] as const;
