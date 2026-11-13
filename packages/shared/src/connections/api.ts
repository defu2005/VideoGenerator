import { z } from "zod";
import { ConnectionCheckSchema, SecretSourceSchema, SecretStatusSchema } from "./catalog.js";
import { PlatformAccountSchema } from "../schemas/profile.js";

/** One AI provider row in Kết nối → AI. Never carries a secret, only its status. */
export const LlmConnectionRowSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.enum(["api", "local", "cli", "custom"]),
  enabled: z.boolean(),
  ready: z.boolean(),
  secret: SecretStatusSchema.nullable(),
  baseUrl: z.string().nullable(),
  defaultModel: z.string().nullable(),
  embeddings: z.boolean().optional(),
  vision: z.boolean().nullable(),
  cliPath: z.string().nullable(),
  keyPageUrl: z.string().nullable(),
  supportsLogin: z.boolean(),
  howToVi: z.array(z.string()),
  pricing: z.enum(["free", "freemium", "paid", "local"]),
  lastCheck: ConnectionCheckSchema.nullable(),
}).strict();
export type LlmConnectionRow = z.infer<typeof LlmConnectionRowSchema>;

export const LlmConnectionListSchema = z.object({ providers: z.array(LlmConnectionRowSchema) }).strict();
export type LlmConnectionList = z.infer<typeof LlmConnectionListSchema>;

const optionalUrl = z.union([z.string().url().regex(/^https?:\/\//), z.literal("")]).optional();

export const LlmConnectionUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  baseUrl: optionalUrl,
  defaultModel: z.string().trim().max(200).optional(),
  embeddings: z.boolean().optional(),
  vision: z.boolean().nullable().optional(),
  label: z.string().trim().min(1).max(80).optional(),
  cliPath: z.string().trim().max(500).optional(),
  /** Write-only. An empty string leaves the saved key alone; use DELETE …/key to remove it. */
  apiKey: z.string().max(4096).optional(),
}).strict();
export type LlmConnectionUpdate = z.infer<typeof LlmConnectionUpdateSchema>;

export const LlmCustomProviderInputSchema = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,30}$/),
  label: z.string().trim().min(1).max(80),
  baseUrl: z.string().url().regex(/^https?:\/\//),
  defaultModel: z.string().trim().max(200).optional(),
  embeddings: z.boolean().optional(),
  vision: z.boolean().optional(),
  apiKey: z.string().max(4096).optional(),
}).strict();
export type LlmCustomProviderInput = z.infer<typeof LlmCustomProviderInputSchema>;

/** Image sources, Brave and platform developer apps. */
export const SecretRowSchema = z.object({
  id: z.string(),
  connectionId: z.string(),
  kind: z.enum(["llm", "image", "web", "platform"]),
  label: z.string(),
  keyPageUrl: z.string().nullable(),
  howToVi: z.array(z.string()),
  status: SecretStatusSchema,
  lastCheck: ConnectionCheckSchema.nullable(),
}).strict();
export type SecretRow = z.infer<typeof SecretRowSchema>;

export const SecretListSchema = z.object({ secrets: z.array(SecretRowSchema) }).strict();
export type SecretList = z.infer<typeof SecretListSchema>;

export const SecretSaveSchema = z.union([
  z.object({ value: z.string().max(4096) }).strict(),
  z.object({ clientId: z.string().max(500), clientSecret: z.string().max(500) }).strict(),
]);
export type SecretSave = z.infer<typeof SecretSaveSchema>;

export const ImportEnvPreviewSchema = z.object({ ids: z.array(z.string()) }).strict();
export const ImportEnvResultSchema = z.object({ copied: z.array(z.string()) }).strict();

export const ConnectionStateSchema = z.enum(["ready", "needs_key", "error", "disabled"]);
export type ConnectionState = z.infer<typeof ConnectionStateSchema>;

export const ConnectionOverviewRowSchema = z.object({
  id: z.string(),
  label: z.string(),
  state: ConnectionStateSchema,
  source: SecretSourceSchema.nullable(),
  detail: z.string().nullable(),
  lastCheck: ConnectionCheckSchema.nullable(),
  action: z.enum(["key", "login", "test", "open"]),
  href: z.string(),
}).strict();
export type ConnectionOverviewRow = z.infer<typeof ConnectionOverviewRowSchema>;

export const SetupItemIdSchema = z.enum(["ai", "voice", "images", "accounts"]);
export type SetupItemId = z.infer<typeof SetupItemIdSchema>;

export const ConnectionsOverviewSchema = z.object({
  sections: z.array(z.object({
    id: z.enum(["ai", "voice", "images", "accounts", "notifications"]),
    label: z.string(),
    rows: z.array(ConnectionOverviewRowSchema),
  }).strict()),
  importable: z.array(z.string()),
  setup: z.object({
    items: z.array(z.object({ id: SetupItemIdSchema, label: z.string(), done: z.boolean(), href: z.string() }).strict()),
    complete: z.boolean(),
    hidden: z.boolean(),
  }).strict(),
}).strict();
export type ConnectionsOverview = z.infer<typeof ConnectionsOverviewSchema>;

export const AccountListRowSchema = PlatformAccountSchema.extend({
  profileName: z.string(),
  tokenExpiresAt: z.string().nullable(),
});
export type AccountListRow = z.infer<typeof AccountListRowSchema>;
export const AccountListSchema = z.object({ accounts: z.array(AccountListRowSchema) }).strict();
export type AccountList = z.infer<typeof AccountListSchema>;

export const AccountDuplicateSchema = z.object({
  duplicates: z.array(z.object({
    id: z.string(),
    profileId: z.string(),
    profileName: z.string(),
    displayName: z.string(),
  }).strict()),
}).strict();
export type AccountDuplicates = z.infer<typeof AccountDuplicateSchema>;

/** Where the developer app for a platform comes from, for the Thêm tài khoản wizard. */
export const PlatformAppStatusSchema = z.object({
  platform: z.string(),
  secretId: z.string().nullable(),
  configured: z.boolean(),
  source: z.enum(["account", "profile", "app", "env", "none"]),
  hint: z.string().nullable(),
  redirectUri: z.string(),
  consoleUrl: z.string().nullable(),
  howToVi: z.array(z.string()),
  problems: z.array(z.string()).optional(),
  noteVi: z.string().optional(),
  troubleshootVi: z.array(z.object({ code: z.string(), titleVi: z.string(), fixVi: z.string() })).optional(),
}).strict();
export type PlatformAppStatus = z.infer<typeof PlatformAppStatusSchema>;

export const PlatformAppSaveSchema = z.object({
  clientId: z.string().trim().max(500),
  clientSecret: z.string().trim().max(500),
  scope: z.enum(["app", "profile"]),
  profileId: z.string().uuid().optional(),
}).strict();
export type PlatformAppSave = z.infer<typeof PlatformAppSaveSchema>;
