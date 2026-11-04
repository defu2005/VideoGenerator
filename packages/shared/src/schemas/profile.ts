import { z } from "zod";
import { AutonomyModeSchema } from "../enums.js";
import { GuidelineSettingsInputSchema, GuidelineSettingsSchema } from "../guidelines/schema.js";
import {
  DEFAULT_PROFILE_AUTOMATION,
  ProfileAutomationInputSchema,
  ProfileAutomationSchema,
} from "./automation.js";
import {
  ProfileLlmSettingsInputSchema,
  ProfileLlmSettingsSchema,
} from "./llm.js";
import { VideoBriefSettingsInputSchema, VideoBriefSettingsSchema } from "./project.js";

export const PlatformIdSchema = z.enum(["youtube", "tiktok", "facebook_reels", "instagram_reels", "mock"]);
export type PlatformId = z.infer<typeof PlatformIdSchema>;

/** Platforms shown in the "add account" UI (excludes test-only mock). */
export const USER_FACING_PLATFORMS = ["youtube", "tiktok", "facebook_reels", "instagram_reels"] as const satisfies readonly PlatformId[];

export const AccountFormatSchema = z.enum(["landscape", "vertical"]);
export type AccountFormat = z.infer<typeof AccountFormatSchema>;

export const AccountConnectionSchema = z.enum(["NOT_CONNECTED", "CONNECTED", "EXPIRED", "ERROR"]);
export type AccountConnection = z.infer<typeof AccountConnectionSchema>;

export const PublishVisibilitySchema = z.enum(["public", "unlisted", "private"]);
export type PublishVisibility = z.infer<typeof PublishVisibilitySchema>;

/** TikTok: Direct Post vs inbox draft upload (finish in the TikTok app). */
export const TikTokUploadModeValueSchema = z.enum(["direct_post", "inbox"]);
export type TikTokUploadModeValue = z.infer<typeof TikTokUploadModeValueSchema>;

/** Loose publish settings; platform-specific keys may appear. */
export const PublishSettingsSchema = z.object({
  visibility: PublishVisibilitySchema.default("public"),
  autoPublish: z.boolean().default(false),
  categoryId: z.string().optional(),
  defaultTags: z.array(z.string()).optional(),
  playlistId: z.string().optional(),
  /** TikTok only: direct_post (Content Posting) or inbox (video.upload draft). */
  tiktokUploadMode: TikTokUploadModeValueSchema.optional(),
}).passthrough();
export type PublishSettings = z.infer<typeof PublishSettingsSchema>;

export const PublishSettingsInputSchema = z.object({
  visibility: PublishVisibilitySchema.optional(),
  autoPublish: z.boolean().optional(),
  categoryId: z.string().optional(),
  defaultTags: z.array(z.string()).optional(),
  playlistId: z.string().optional(),
  tiktokUploadMode: TikTokUploadModeValueSchema.optional(),
}).passthrough();

export function defaultFormatForPlatform(platform: PlatformId): AccountFormat {
  return platform === "youtube" || platform === "mock" ? "landscape" : "vertical";
}

export function resolveAccountFormat(platform: PlatformId, format?: AccountFormat | null): AccountFormat {
  return format ?? defaultFormatForPlatform(platform);
}

/** Main aspect for a profile: any landscape account → 16:9; else vertical → 9:16; no accounts → undefined. */
export function mainAspectFromFormats(formats: AccountFormat[]): "16:9" | "9:16" | undefined {
  if (formats.length === 0) return undefined;
  if (formats.some((format) => format === "landscape")) return "16:9";
  return "9:16";
}

const VoiceSettingsSchema = z.object({
  voice: z.string().trim().max(200).optional(),
  rate: z.string().regex(/^[+-]\d{1,3}%$/).optional(),
}).strict();

export const ProfileDefaultBriefSchema = VideoBriefSettingsSchema.extend({
  mode: AutonomyModeSchema.default("ASSISTED"),
  autoRender: z.boolean().default(false),
});
export type ProfileDefaultBrief = z.infer<typeof ProfileDefaultBriefSchema>;

export const ProfileDefaultBriefInputSchema = z.object({
  ...VideoBriefSettingsInputSchema.shape,
  language: z.string().optional(),
  targetDurationSec: z.number().int().min(30).max(1800).optional(),
  aspectRatio: z.enum(["16:9", "9:16", "1:1"]).optional(),
  mode: AutonomyModeSchema.optional(),
  autoRender: z.boolean().optional(),
}).strict();

export const HexColorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Must be a hex color like #3B82F6");

export const PlatformAccountSchema = z.object({
  id: z.string().uuid(),
  profileId: z.string().uuid(),
  platform: PlatformIdSchema,
  displayName: z.string().min(1).max(200),
  handle: z.string().max(200).nullable(),
  externalId: z.string().max(200).nullable().optional(),
  format: AccountFormatSchema,
  enabled: z.boolean(),
  connection: AccountConnectionSchema,
  connectionError: z.string().nullable(),
  lastCheckedAt: z.string().datetime({ offset: true }).nullable().optional(),
  publishSettings: PublishSettingsSchema,
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
export type PlatformAccount = z.infer<typeof PlatformAccountSchema>;

export const PlatformAccountInputSchema = z.object({
  platform: PlatformIdSchema,
  displayName: z.string().trim().min(1).max(200),
  handle: z.string().trim().max(200).nullable().optional(),
  format: AccountFormatSchema.optional(),
  enabled: z.boolean().optional(),
  publishSettings: PublishSettingsInputSchema.optional(),
}).strict();
export type PlatformAccountInput = z.infer<typeof PlatformAccountInputSchema>;

export const PlatformAccountUpdateSchema = z.object({
  displayName: z.string().trim().min(1).max(200).optional(),
  handle: z.string().trim().max(200).nullable().optional(),
  format: AccountFormatSchema.optional(),
  enabled: z.boolean().optional(),
  publishSettings: PublishSettingsInputSchema.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: "At least one field must be provided",
});
export type PlatformAccountUpdate = z.infer<typeof PlatformAccountUpdateSchema>;

export const ProfileSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(120),
  description: z.string().max(2000),
  direction: z.string().max(8000),
  language: z.string(),
  defaultBrief: ProfileDefaultBriefSchema,
  voice: VoiceSettingsSchema.nullable(),
  guidelines: GuidelineSettingsSchema,
  llm: ProfileLlmSettingsSchema.nullable().optional(),
  automation: ProfileAutomationSchema.default(DEFAULT_PROFILE_AUTOMATION),
  avatarPath: z.string().nullable(),
  color: HexColorSchema,
  archivedAt: z.string().datetime({ offset: true }).nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const ProfileListItemSchema = ProfileSchema.pick({
  id: true,
  name: true,
  description: true,
  direction: true,
  language: true,
  color: true,
  avatarPath: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  accountCount: z.number().int().nonnegative(),
  projectCount: z.number().int().nonnegative(),
  accounts: z.array(PlatformAccountSchema.pick({
    id: true,
    platform: true,
    displayName: true,
    handle: true,
    format: true,
    enabled: true,
    connection: true,
  })).optional(),
});
export type ProfileListItem = z.infer<typeof ProfileListItemSchema>;

export const ProfileListQuerySchema = z.object({
  includeArchived: z.preprocess((value) => {
    if (value === "true") return true;
    if (value === "false") return false;
    return value;
  }, z.boolean()).default(false),
}).strict();
export type ProfileListQuery = z.infer<typeof ProfileListQuerySchema>;

export const ProfileListResponseSchema = z.object({
  items: z.array(ProfileListItemSchema),
});
export type ProfileListResponse = z.infer<typeof ProfileListResponseSchema>;

export const ProfileDetailSchema = ProfileSchema.extend({
  accounts: z.array(PlatformAccountSchema),
  projectCount: z.number().int().nonnegative().optional(),
});
export type ProfileDetail = z.infer<typeof ProfileDetailSchema>;

export const ProfileInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).optional(),
  direction: z.string().max(8000).optional(),
  language: z.string().optional(),
  defaultBrief: ProfileDefaultBriefInputSchema.optional(),
  voice: VoiceSettingsSchema.nullable().optional(),
  guidelines: GuidelineSettingsInputSchema.optional(),
  llm: ProfileLlmSettingsInputSchema.nullable().optional(),
  automation: ProfileAutomationInputSchema.optional(),
  color: HexColorSchema.optional(),
  avatarPath: z.string().nullable().optional(),
}).strict();
export type ProfileInput = z.infer<typeof ProfileInputSchema>;

export const ProfileUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(2000).optional(),
  direction: z.string().max(8000).optional(),
  language: z.string().optional(),
  defaultBrief: ProfileDefaultBriefInputSchema.optional(),
  voice: VoiceSettingsSchema.nullable().optional(),
  guidelines: GuidelineSettingsInputSchema.optional(),
  llm: ProfileLlmSettingsInputSchema.nullable().optional(),
  automation: ProfileAutomationInputSchema.optional(),
  color: HexColorSchema.optional(),
  avatarPath: z.string().nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: "At least one field must be provided",
});
export type ProfileUpdate = z.infer<typeof ProfileUpdateSchema>;

const CHANNEL_DIRECTION_MAX = 800;

/** Truncated "Định hướng kênh" block for LLM prompts. Empty when no direction. */
export function channelDirectionBlock(direction?: string | null): string {
  const text = direction?.trim();
  if (!text) return "";
  const truncated = text.length > CHANNEL_DIRECTION_MAX ? text.slice(0, CHANNEL_DIRECTION_MAX) : text;
  return `Định hướng kênh:\n${truncated}`;
}

export function appendChannelDirection(prompt: string, direction?: string | null): string {
  const block = channelDirectionBlock(direction);
  return block ? `${prompt}\n\n${block}` : prompt;
}
