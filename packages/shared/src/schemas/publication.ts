import { z } from "zod";
import { PlatformIdSchema, PublishVisibilitySchema } from "./profile.js";

export const PublicationStatusSchema = z.enum([
  "QUEUED",
  "SCHEDULED",
  "UPLOADING",
  "PUBLISHED",
  "FAILED",
  "CANCELLED",
]);
export type PublicationStatus = z.infer<typeof PublicationStatusSchema>;

export const PublicationSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  renderId: z.string().uuid(),
  accountId: z.string().uuid(),
  status: PublicationStatusSchema,
  visibilityRequested: PublishVisibilitySchema,
  visibilityUsed: PublishVisibilitySchema,
  guardrailReason: z.string().nullable(),
  scheduledFor: z.string().datetime({ offset: true }).nullable(),
  externalId: z.string().nullable(),
  externalUrl: z.string().nullable(),
  attempts: z.number().int().nonnegative(),
  lastError: z.string().nullable(),
  progress: z.number().min(0).max(100),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  publishedAt: z.string().datetime({ offset: true }).nullable(),
}).strict();
export type Publication = z.infer<typeof PublicationSchema>;

export const PublicationListItemSchema = PublicationSchema.extend({
  platform: PlatformIdSchema.optional(),
  accountDisplayName: z.string().optional(),
  projectTitle: z.string().optional(),
  profileId: z.string().uuid().optional(),
});
export type PublicationListItem = z.infer<typeof PublicationListItemSchema>;

export const CreatePublicationsBodySchema = z.object({
  accountIds: z.array(z.string().uuid()).min(1),
  scheduledFor: z.string().datetime({ offset: true }).optional(),
  visibility: PublishVisibilitySchema.optional(),
  /** Force a new upload even if this render was already published to the account. */
  force: z.boolean().optional(),
}).strict();
export type CreatePublicationsBody = z.infer<typeof CreatePublicationsBodySchema>;

export const CreatePublicationsResponseSchema = z.object({
  items: z.array(PublicationSchema),
}).strict();
export type CreatePublicationsResponse = z.infer<typeof CreatePublicationsResponseSchema>;

export const ListPublicationsQuerySchema = z.object({
  status: PublicationStatusSchema.optional(),
  profileId: z.string().uuid().optional(),
}).strict();
export type ListPublicationsQuery = z.infer<typeof ListPublicationsQuerySchema>;

export const PublicationListResponseSchema = z.object({
  items: z.array(PublicationListItemSchema),
}).strict();
export type PublicationListResponse = z.infer<typeof PublicationListResponseSchema>;

/** Metadata trimmed for a platform upload. */
export const PublishInputSchema = z.object({
  videoPath: z.string().min(1),
  format: z.enum(["landscape", "vertical"]),
  title: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  thumbnailPath: z.string().optional(),
  visibility: PublishVisibilitySchema,
  publishAt: z.string().datetime({ offset: true }).optional(),
  language: z.string(),
  madeForKids: z.literal(false),
  aiDisclosure: z.boolean(),
}).strict();
export type PublishInput = z.infer<typeof PublishInputSchema>;

export const PublishResultSchema = z.object({
  externalId: z.string().min(1),
  externalUrl: z.string().min(1),
}).strict();
export type PublishResult = z.infer<typeof PublishResultSchema>;

export const TokenSetSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().optional(),
  expiresAt: z.string().datetime({ offset: true }).optional(),
  scopes: z.array(z.string()).default([]),
  tokenType: z.string().optional(),
}).strict();
export type TokenSet = z.infer<typeof TokenSetSchema>;

export const AppCredentialsStatusSchema = z.object({
  configured: z.boolean(),
  /** Last 4 characters of the public client/app id; never the secret. */
  idHint: z.string().nullable(),
}).strict();
export type AppCredentialsStatus = z.infer<typeof AppCredentialsStatusSchema>;

export const PlatformAppCredentialsInputSchema = z.object({
  clientId: z.string().trim().min(1).max(500),
  clientSecret: z.string().trim().min(1).max(500),
}).strict();
export type PlatformAppCredentialsInput = z.infer<typeof PlatformAppCredentialsInputSchema>;

export const AccountConnectionDetailSchema = z.object({
  connection: z.enum(["NOT_CONNECTED", "CONNECTED", "EXPIRED", "ERROR"]),
  connectionError: z.string().nullable(),
  displayName: z.string(),
  handle: z.string().nullable(),
  externalId: z.string().nullable(),
  tokenExpiresAt: z.string().datetime({ offset: true }).nullable(),
  scopes: z.array(z.string()),
  lastCheckedAt: z.string().datetime({ offset: true }).nullable(),
  appCredentials: AppCredentialsStatusSchema,
  redirectUri: z.string(),
  /** False when the platform has no publisher or app credentials are missing. */
  canConnect: z.boolean(),
  /** Vietnamese hint shown when Kết nối is disabled; null when canConnect. */
  connectBlockedReason: z.string().nullable(),
}).strict();
export type AccountConnectionDetail = z.infer<typeof AccountConnectionDetailSchema>;
