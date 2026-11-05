import { z } from "zod";

export const COMMENT_BATCH_SIZE = 20;
export const COMMENT_REPLY_MAX_CHARS = 300;
export const COMMENT_SCRIPT_SUMMARY_MAX_CHARS = 800;
export const AUTO_REPLY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const COMMENT_ATTENTION_PRIORITY = 70;
/** Stop YouTube replies when less than this fraction of the daily quota remains. */
export const YOUTUBE_REPLY_QUOTA_FLOOR = 0.2;
export const YOUTUBE_COMMENT_LIST_UNITS = 1;
export const YOUTUBE_COMMENT_INSERT_UNITS = 50;

export const CommentStatusSchema = z.enum(["new", "read", "replied", "hidden", "spam", "ignored"]);
export type CommentStatus = z.infer<typeof CommentStatusSchema>;

export const CommentClassificationSchema = z.enum([
  "question",
  "praise",
  "complaint",
  "request",
  "spam",
  "toxic",
  "other",
]);
export type CommentClassification = z.infer<typeof CommentClassificationSchema>;

export const CommentAutomationModeSchema = z.enum(["off", "hide_spam", "auto_reply"]);
export type CommentAutomationMode = z.infer<typeof CommentAutomationModeSchema>;

export const CommentToneSchema = z.enum(["thân thiện", "chuyên nghiệp", "hài hước"]);
export type CommentTone = z.infer<typeof CommentToneSchema>;

export const CommentConfidenceSchema = z.enum(["high", "low"]);
export type CommentConfidence = z.infer<typeof CommentConfidenceSchema>;

export const CommentSettingsSchema = z.object({
  mode: CommentAutomationModeSchema.default("off"),
  repliesPerVideoPerDay: z.number().int().min(0).max(100).default(10),
  repliesPerAccountPerDay: z.number().int().min(0).max(500).default(30),
  tone: CommentToneSchema.default("thân thiện"),
  emoji: z.boolean().default(false),
  signature: z.string().max(80).default(""),
  spamPhrases: z.array(z.string().trim().min(1).max(80)).max(100).default([]),
}).strict();
export type CommentSettings = z.infer<typeof CommentSettingsSchema>;

export const CommentSettingsInputSchema = CommentSettingsSchema.partial().strict();
export type CommentSettingsInput = z.infer<typeof CommentSettingsInputSchema>;

export const DEFAULT_COMMENT_SETTINGS: CommentSettings = CommentSettingsSchema.parse({});

export const CommentAssistItemSchema = z.object({
  externalId: z.string().min(1),
  classification: CommentClassificationSchema,
  priority: z.number().int().min(0).max(100),
  toxic: z.boolean(),
  confidence: CommentConfidenceSchema,
  suggestedReply: z.string().max(COMMENT_REPLY_MAX_CHARS),
}).strict();
export type CommentAssistItem = z.infer<typeof CommentAssistItemSchema>;

export const CommentAssistSchema = z.object({
  items: z.array(CommentAssistItemSchema),
}).strict();
export type CommentAssist = z.infer<typeof CommentAssistSchema>;

export const CommentInboxQuerySchema = z.object({
  profileId: z.string().uuid().optional(),
  platform: z.enum(["youtube", "tiktok", "instagram_reels", "facebook_reels", "mock"]).optional(),
  status: CommentStatusSchema.optional(),
  classification: CommentClassificationSchema.optional(),
}).strict();
export type CommentInboxQuery = z.infer<typeof CommentInboxQuerySchema>;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** How often to pull comments for a publication, based on age since publish. */
export function commentSyncIntervalMs(publishedAt: Date, now: Date): number {
  const age = Math.max(0, now.getTime() - publishedAt.getTime());
  if (age < 3 * DAY) return 30 * 60 * 1000;
  if (age < 30 * DAY) return 6 * HOUR;
  return DAY;
}

export function commentSyncDue(
  publishedAt: Date,
  lastSyncedAt: Date | null | undefined,
  now: Date,
): boolean {
  if (!lastSyncedAt) return true;
  return now.getTime() - lastSyncedAt.getTime() >= commentSyncIntervalMs(publishedAt, now);
}

export function youtubeReplyQuotaBlocked(remaining: number, limit: number): boolean {
  if (limit <= 0) return true;
  return remaining < limit * YOUTUBE_REPLY_QUOTA_FLOOR;
}

export type SpamReason = "link" | "phone" | "repeat" | "phrase";

const LINK_RE = /https?:\/\/|www\.\S|\b[\w-]+\.(?:com|net|org|vn|info|xyz|io|me|ly|link|click)\b/i;
const PHONE_RE = /(?:\+?\d[\s.\-()]?){9,}/;
const REPEAT_CHAR_RE = /(.)\1{5,}/u;
const REPEAT_WORD_RE = /\b(\p{L}{2,})(?:\s+\1){3,}\b/iu;

export function spamReason(text: string, phrases: readonly string[]): SpamReason | null {
  const value = text.trim();
  if (!value) return null;
  if (LINK_RE.test(value)) return "link";
  if (PHONE_RE.test(value)) return "phone";
  if (REPEAT_CHAR_RE.test(value) || REPEAT_WORD_RE.test(value)) return "repeat";
  const lower = value.toLowerCase();
  for (const phrase of phrases) {
    const needle = phrase.trim().toLowerCase();
    if (needle && lower.includes(needle)) return "phrase";
  }
  return null;
}

export function normalizeCommentText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

export function finalizeReply(text: string, signature: string): string {
  const base = text.replace(/\s+/g, " ").trim();
  const sig = signature.trim();
  if (!sig) return base.slice(0, COMMENT_REPLY_MAX_CHARS);
  if (base.toLowerCase().includes(sig.toLowerCase())) return base.slice(0, COMMENT_REPLY_MAX_CHARS);
  const joiner = "\n";
  const room = COMMENT_REPLY_MAX_CHARS - sig.length - joiner.length;
  if (room < 1) return sig.slice(0, COMMENT_REPLY_MAX_CHARS);
  return `${base.slice(0, room).trimEnd()}${joiner}${sig}`;
}

export type AutoReplyDeny =
  | "mode"
  | "classification"
  | "toxic"
  | "confidence"
  | "priority"
  | "age"
  | "video_limit"
  | "account_limit"
  | "author"
  | "duplicate"
  | "empty";

export function autoReplyDenial(input: {
  mode: CommentAutomationMode;
  classification: CommentClassification | null;
  toxic: boolean;
  confidence: CommentConfidence | null;
  priority: number;
  publishedAtMs: number;
  nowMs: number;
  repliesTodayForVideo: number;
  repliesTodayForAccount: number;
  perVideoLimit: number;
  perAccountLimit: number;
  authorAlreadyReplied: boolean;
  replyTextUsed: boolean;
  replyText: string;
}): AutoReplyDeny | null {
  if (input.mode !== "auto_reply") return "mode";
  if (input.toxic || input.classification === "toxic") return "toxic";
  if (input.classification === "complaint" || input.classification === "request" || input.classification === "spam") {
    return "classification";
  }
  const praise = input.classification === "praise";
  const simpleQuestion = input.classification === "question" && input.priority < COMMENT_ATTENTION_PRIORITY;
  if (!praise && !simpleQuestion) return "classification";
  if (input.confidence !== "high") return "confidence";
  if (input.classification === "question" && input.priority >= COMMENT_ATTENTION_PRIORITY) return "priority";
  if (input.nowMs - input.publishedAtMs > AUTO_REPLY_MAX_AGE_MS) return "age";
  if (input.repliesTodayForVideo >= input.perVideoLimit) return "video_limit";
  if (input.repliesTodayForAccount >= input.perAccountLimit) return "account_limit";
  if (input.authorAlreadyReplied) return "author";
  if (!input.replyText.trim()) return "empty";
  if (input.replyTextUsed) return "duplicate";
  return null;
}

export function shouldAutoHide(
  mode: CommentAutomationMode,
  classification: CommentClassification | null,
  toxic: boolean,
): boolean {
  if (mode !== "hide_spam" && mode !== "auto_reply") return false;
  return toxic || classification === "spam" || classification === "toxic";
}

export function commentNeedsAttention(input: {
  classification: CommentClassification | null;
  priority: number;
  status: CommentStatus;
}): boolean {
  if (input.status === "replied" || input.status === "ignored") return false;
  if (input.classification === "complaint") return true;
  return input.classification === "question" && input.priority >= COMMENT_ATTENTION_PRIORITY;
}
