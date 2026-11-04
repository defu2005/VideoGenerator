import { z } from "zod";

export const AssistantChannelSchema = z.enum(["web", "telegram"]);
export type AssistantChannel = z.infer<typeof AssistantChannelSchema>;

export const AssistantConfirmModeSchema = z.enum(["risky", "auto"]);
export type AssistantConfirmMode = z.infer<typeof AssistantConfirmModeSchema>;

export const AssistantSettingsSchema = z.object({
  confirmMode: AssistantConfirmModeSchema.default("risky"),
}).strict();
export type AssistantSettings = z.infer<typeof AssistantSettingsSchema>;

export const DEFAULT_ASSISTANT_SETTINGS: AssistantSettings = AssistantSettingsSchema.parse({});

export const AssistantSettingsUpdateSchema = z.object({
  confirmMode: AssistantConfirmModeSchema.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: "At least one field must be provided",
});
export type AssistantSettingsUpdate = z.infer<typeof AssistantSettingsUpdateSchema>;

export const AssistantToolRiskSchema = z.enum(["read", "safe", "confirm"]);
export type AssistantToolRisk = z.infer<typeof AssistantToolRiskSchema>;

export const AssistantToolCallSchema = z.object({
  tool: z.string().min(1).max(80),
  args: z.unknown().optional(),
}).strict();
export type AssistantToolCall = z.infer<typeof AssistantToolCallSchema>;

export const AssistantClarifySchema = z.object({
  question: z.string().min(1).max(2000),
  options: z.array(z.string().min(1).max(200)).max(8).optional(),
}).strict();
export type AssistantClarify = z.infer<typeof AssistantClarifySchema>;

/** One structured turn from the assistantChat LLM task. */
export const AssistantChatStepSchema = z.object({
  reply: z.string().max(8000).default(""),
  clarify: AssistantClarifySchema.optional(),
  calls: z.array(AssistantToolCallSchema).max(4).optional(),
  /** When true, confirm-risk tools run immediately for this step (except deletes). */
  autoConfirm: z.boolean().optional(),
  done: z.boolean(),
}).strict();
export type AssistantChatStep = z.infer<typeof AssistantChatStepSchema>;

export const AssistantMessageRoleSchema = z.enum(["user", "assistant", "tool"]);
export type AssistantMessageRole = z.infer<typeof AssistantMessageRoleSchema>;

export const AssistantPendingStatusSchema = z.enum([
  "pending",
  "confirmed",
  "rejected",
  "expired",
  "failed",
]);
export type AssistantPendingStatus = z.infer<typeof AssistantPendingStatusSchema>;

export const AssistantPendingActionSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  tool: z.string().min(1),
  args: z.unknown(),
  summary: z.string().min(1).max(500),
  status: AssistantPendingStatusSchema,
  result: z.unknown().nullable(),
  createdAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
}).strict();
export type AssistantPendingAction = z.infer<typeof AssistantPendingActionSchema>;

export const AssistantToolActivitySchema = z.object({
  tool: z.string(),
  summary: z.string(),
  risk: AssistantToolRiskSchema,
  ok: z.boolean(),
  error: z.string().optional(),
}).strict();
export type AssistantToolActivity = z.infer<typeof AssistantToolActivitySchema>;

export const AssistantMessageContentSchema = z.object({
  text: z.string().default(""),
  clarify: AssistantClarifySchema.optional(),
  toolActivity: z.array(AssistantToolActivitySchema).optional(),
  pendingActionIds: z.array(z.string().uuid()).optional(),
  usage: z.object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    costUsd: z.number().nonnegative().optional(),
    provider: z.string().optional(),
    model: z.string().optional(),
    cached: z.boolean().optional(),
  }).strict().optional(),
}).strict();
export type AssistantMessageContent = z.infer<typeof AssistantMessageContentSchema>;

export const AssistantMessageSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  role: AssistantMessageRoleSchema,
  content: AssistantMessageContentSchema,
  createdAt: z.string().datetime({ offset: true }),
}).strict();
export type AssistantMessage = z.infer<typeof AssistantMessageSchema>;

export const AssistantConversationSchema = z.object({
  id: z.string().uuid(),
  channel: AssistantChannelSchema,
  title: z.string().min(1).max(200),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
}).strict();
export type AssistantConversation = z.infer<typeof AssistantConversationSchema>;

export const CreateAssistantConversationBodySchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  channel: AssistantChannelSchema.default("web"),
}).strict();
export type CreateAssistantConversationBody = z.infer<typeof CreateAssistantConversationBodySchema>;

export const SendAssistantMessageBodySchema = z.object({
  text: z.string().trim().min(1).max(8000),
}).strict();
export type SendAssistantMessageBody = z.infer<typeof SendAssistantMessageBodySchema>;

export const AssistantSendResponseSchema = z.object({
  messages: z.array(AssistantMessageSchema),
  pendingActions: z.array(AssistantPendingActionSchema),
}).strict();
export type AssistantSendResponse = z.infer<typeof AssistantSendResponseSchema>;

export const AssistantConversationListSchema = z.object({
  items: z.array(AssistantConversationSchema),
}).strict();
export type AssistantConversationList = z.infer<typeof AssistantConversationListSchema>;

export const AssistantMessagesResponseSchema = z.object({
  items: z.array(AssistantMessageSchema),
  pendingActions: z.array(AssistantPendingActionSchema),
}).strict();
export type AssistantMessagesResponse = z.infer<typeof AssistantMessagesResponseSchema>;

export const AssistantActionResultSchema = z.object({
  action: AssistantPendingActionSchema,
}).strict();
export type AssistantActionResult = z.infer<typeof AssistantActionResultSchema>;
