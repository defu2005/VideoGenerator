import { z } from "zod";
import { PublishTimeSchema } from "./automation.js";

export const NotificationEventToggleSchema = z.object({
  attention: z.boolean().default(true),
  published: z.boolean().default(true),
  waitingApproval: z.boolean().default(true),
  dailySummary: z.boolean().default(true),
}).strict();
export type NotificationEventToggle = z.infer<typeof NotificationEventToggleSchema>;

export const QuietHoursSchema = z.object({
  from: PublishTimeSchema,
  to: PublishTimeSchema,
}).strict();
export type QuietHours = z.infer<typeof QuietHoursSchema>;

export const NotificationSettingsSchema = z.object({
  telegram: z.object({
    enabled: z.boolean().default(false),
    chatId: z.string().nullable().default(null),
    botUsername: z.string().nullable().default(null),
  }).strict().default({
    enabled: false,
    chatId: null,
    botUsername: null,
  }),
  events: NotificationEventToggleSchema.default({
    attention: true,
    published: true,
    waitingApproval: true,
    dailySummary: true,
  }),
  dailySummaryTime: PublishTimeSchema.default("21:00"),
  timezone: z.string().min(1).max(80).default("Asia/Ho_Chi_Minh"),
  quietHours: QuietHoursSchema.nullable().default(null),
}).strict();
export type NotificationSettings = z.infer<typeof NotificationSettingsSchema>;

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = NotificationSettingsSchema.parse({
  telegram: { enabled: false, chatId: null, botUsername: null },
  events: { attention: true, published: true, waitingApproval: true, dailySummary: true },
  dailySummaryTime: "21:00",
  timezone: "Asia/Ho_Chi_Minh",
  quietHours: null,
});

export const NotificationSettingsStatusSchema = NotificationSettingsSchema.extend({
  tokenConfigured: z.boolean(),
}).strict();
export type NotificationSettingsStatus = z.infer<typeof NotificationSettingsStatusSchema>;

export const TelegramTokenBodySchema = z.object({
  token: z.string().trim().min(1).max(200),
}).strict();
export type TelegramTokenBody = z.infer<typeof TelegramTokenBodySchema>;

export const PairingCodeResponseSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
  expiresAt: z.string().datetime({ offset: true }),
  botUsername: z.string().nullable(),
  startCommand: z.string(),
}).strict();
export type PairingCodeResponse = z.infer<typeof PairingCodeResponseSchema>;

export const NotificationLogStatusSchema = z.enum(["sent", "failed", "skipped"]);
export type NotificationLogStatus = z.infer<typeof NotificationLogStatusSchema>;

export const NotificationKindSchema = z.enum([
  "publish_succeeded",
  "publish_failed",
  "render_failed",
  "stage_failed",
  "waiting_approval",
  "token_expiring",
  "account_error",
  "automation_warning",
  "automation_paused",
  "daily_summary",
  "monthly_report",
  "comment_attention",
]);
export type NotificationKind = z.infer<typeof NotificationKindSchema>;

export const NotificationLogEntrySchema = z.object({
  id: z.string(),
  at: z.string().datetime({ offset: true }),
  kind: NotificationKindSchema,
  subjectKey: z.string(),
  channel: z.string(),
  status: NotificationLogStatusSchema,
  message: z.string(),
  error: z.string().nullable(),
}).strict();
export type NotificationLogEntry = z.infer<typeof NotificationLogEntrySchema>;

export const NotificationLogListSchema = z.object({
  items: z.array(NotificationLogEntrySchema),
}).strict();
export type NotificationLogList = z.infer<typeof NotificationLogListSchema>;

export const NotificationEventSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("publish_succeeded"),
    publicationId: z.string(),
    profile: z.string(),
    account: z.string(),
    platform: z.string(),
    title: z.string(),
    url: z.string(),
  }).strict(),
  z.object({
    kind: z.literal("publish_failed"),
    publicationId: z.string(),
    profile: z.string(),
    account: z.string(),
    platform: z.string(),
    title: z.string(),
    error: z.string(),
  }).strict(),
  z.object({
    kind: z.literal("render_failed"),
    projectId: z.string(),
    project: z.string(),
    error: z.string(),
  }).strict(),
  z.object({
    kind: z.literal("stage_failed"),
    projectId: z.string(),
    project: z.string(),
    stage: z.string(),
    error: z.string(),
  }).strict(),
  z.object({
    kind: z.literal("waiting_approval"),
    projectId: z.string(),
    project: z.string(),
    gate: z.string(),
    link: z.string(),
    /** True when an AUTO/automation run unexpectedly stuck at a gate. */
    unexpectedAutoStop: z.boolean().optional(),
  }).strict(),
  z.object({
    kind: z.literal("token_expiring"),
    accountId: z.string(),
    account: z.string(),
    expiresAt: z.string(),
  }).strict(),
  z.object({
    kind: z.literal("account_error"),
    accountId: z.string(),
    account: z.string(),
    error: z.string(),
  }).strict(),
  z.object({
    kind: z.literal("automation_warning"),
    profileId: z.string().nullable().optional(),
    profile: z.string(),
    message: z.string(),
    logId: z.string().optional(),
  }).strict(),
  z.object({
    kind: z.literal("automation_paused"),
  }).strict(),
  z.object({
    kind: z.literal("daily_summary"),
    dateKey: z.string(),
    text: z.string(),
  }).strict(),
  z.object({
    kind: z.literal("monthly_report"),
    month: z.string(),
    text: z.string(),
    link: z.string(),
  }).strict(),
  z.object({
    kind: z.literal("comment_attention"),
    profileId: z.string(),
    profile: z.string(),
    count: z.number().int().positive(),
    hourKey: z.string().min(1),
  }).strict(),
]);
export type NotificationEvent = z.infer<typeof NotificationEventSchema>;

/** Map event kind → settings.events toggle key. */
export function notificationToggleForKind(
  kind: NotificationKind,
  unexpectedAutoStop = false,
): keyof NotificationEventToggle {
  if (kind === "publish_succeeded") return "published";
  if (kind === "waiting_approval" && !unexpectedAutoStop) return "waitingApproval";
  if (kind === "daily_summary" || kind === "monthly_report") return "dailySummary";
  return "attention";
}

export function subjectKeyForEvent(event: NotificationEvent): string {
  switch (event.kind) {
    case "publish_succeeded":
    case "publish_failed":
      return `publication:${event.publicationId}:${event.kind}`;
    case "render_failed":
      return `project:${event.projectId}:render_failed`;
    case "stage_failed":
      return `project:${event.projectId}:stage:${event.stage}`;
    case "waiting_approval":
      return `project:${event.projectId}:gate:${event.gate}`;
    case "token_expiring":
      return `account:${event.accountId}:token_expiring`;
    case "account_error":
      return `account:${event.accountId}:account_error`;
    case "automation_warning":
      return `automation:${event.profileId ?? "app"}:${event.message.slice(0, 80)}`;
    case "automation_paused":
      return "automation:paused";
    case "daily_summary":
      return `daily_summary:${event.dateKey}`;
    case "monthly_report":
      return `monthly_report:${event.month}`;
    case "comment_attention":
      return `comments:${event.profileId}:${event.hourKey}`;
  }
}
