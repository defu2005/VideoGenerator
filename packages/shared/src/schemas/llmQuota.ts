import { z } from "zod";

export const LlmQuotaWindowSchema = z.enum(["minute", "day", "month", "rolling_5h", "lifetime"]);
export type LlmQuotaWindow = z.infer<typeof LlmQuotaWindowSchema>;

export const LlmQuotaKindSchema = z.enum(["free_tier", "subscription", "paid"]);
export type LlmQuotaKind = z.infer<typeof LlmQuotaKindSchema>;

export const LlmQuotaUnitSchema = z.enum(["requests", "tokens", "credits_usd", "credits"]);
export type LlmQuotaUnit = z.infer<typeof LlmQuotaUnitSchema>;

export const LlmQuotaLimitSchema = z.object({
  window: LlmQuotaWindowSchema,
  requests: z.number().int().positive().optional(),
  inputTokens: z.number().int().positive().optional(),
  outputTokens: z.number().int().positive().optional(),
  /** Granted credit. 0 is a notes-only placeholder the user replaces. */
  creditsUsd: z.number().nonnegative().optional(),
  /** Trial or credit expiry. Lifetime windows do not reset before this instant. */
  expiresAt: z.string().datetime({ offset: true }).optional(),
  unit: LlmQuotaUnitSchema.optional(),
}).strict().refine(
  (limit) => limit.requests !== undefined || limit.inputTokens !== undefined || limit.outputTokens !== undefined || limit.creditsUsd !== undefined,
  "A quota limit needs requests, inputTokens, outputTokens, or creditsUsd",
);
export type LlmQuotaLimit = z.infer<typeof LlmQuotaLimitSchema>;

export const LlmQuotaRuleSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  kind: LlmQuotaKindSchema,
  limits: z.array(LlmQuotaLimitSchema).min(1),
  resetTz: z.string().min(1),
  note: z.string(),
  source: z.enum(["preset", "user"]),
  enabled: z.boolean().default(true),
}).strict();
export type LlmQuotaRule = z.infer<typeof LlmQuotaRuleSchema>;

export const QuotaPolicySchema = z.enum(["wait", "paid_fallback"]);
export type QuotaPolicy = z.infer<typeof QuotaPolicySchema>;

export const LlmQuotaSettingsSchema = z.object({
  rules: z.array(LlmQuotaRuleSchema).default([]),
  disabled: z.array(z.object({
    provider: z.string().min(1),
    model: z.string().min(1),
  }).strict()).default([]),
  quotaPolicy: QuotaPolicySchema.default("wait"),
  paidFallbackDailyUsd: z.number().nonnegative().max(10_000).default(1),
  nearLimitRatio: z.number().gt(0).max(1).default(0.9),
}).strict();
export type LlmQuotaSettings = z.infer<typeof LlmQuotaSettingsSchema>;

export const LlmQuotaWindowUsageSchema = z.object({
  window: LlmQuotaWindowSchema,
  requestsUsed: z.number().int().nonnegative(),
  requestsLimit: z.number().int().positive().nullable(),
  inputTokensUsed: z.number().int().nonnegative(),
  inputTokensLimit: z.number().int().positive().nullable(),
  outputTokensUsed: z.number().int().nonnegative(),
  outputTokensLimit: z.number().int().positive().nullable(),
  creditsUsdUsed: z.number().nonnegative().optional(),
  creditsUsdLimit: z.number().nonnegative().nullable().optional(),
  unit: LlmQuotaUnitSchema.optional(),
  ratio: z.number().nonnegative(),
}).strict();
export type LlmQuotaWindowUsage = z.infer<typeof LlmQuotaWindowUsageSchema>;

export const LlmQuotaStatusValueSchema = z.enum(["ok", "near", "exhausted", "cooldown"]);
export type LlmQuotaStatusValue = z.infer<typeof LlmQuotaStatusValueSchema>;

export const LlmQuotaRowSchema = z.object({
  provider: z.string(),
  model: z.string(),
  kind: LlmQuotaKindSchema,
  source: z.enum(["preset", "user"]),
  enabled: z.boolean(),
  note: z.string(),
  resetTz: z.string(),
  limits: z.array(LlmQuotaLimitSchema),
  windows: z.array(LlmQuotaWindowUsageSchema),
  nextReset: z.string().datetime({ offset: true }).nullable(),
  status: LlmQuotaStatusValueSchema,
  cooldownUntil: z.string().datetime({ offset: true }).nullable(),
  cooldownReason: z.string().nullable(),
  /** A fresh OmniRoute snapshot covers this rule, so the estimate is not used for routing. */
  coveredByLive: z.boolean().optional().default(false),
}).strict();
export type LlmQuotaRow = z.infer<typeof LlmQuotaRowSchema>;

export const LlmQuotaCooldownSchema = z.object({
  provider: z.string(),
  model: z.string(),
  until: z.string().datetime({ offset: true }),
  reason: z.string(),
  setAt: z.string().datetime({ offset: true }),
}).strict();
export type LlmQuotaCooldown = z.infer<typeof LlmQuotaCooldownSchema>;

export const LiveQuotaStatusSchema = z.enum(["ok", "near", "exhausted", "unknown"]);
export type LiveQuotaStatus = z.infer<typeof LiveQuotaStatusSchema>;

export const OmniRouteSyncStatusSchema = z.enum(["connected", "needs_token", "unreachable", "idle"]);
export type OmniRouteSyncStatus = z.infer<typeof OmniRouteSyncStatusSchema>;

export const LiveQuotaEntrySchema = z.object({
  key: z.string(),
  unit: LlmQuotaUnitSchema,
  used: z.number().nullable(),
  total: z.number().nullable(),
  remaining: z.number().nullable(),
  remainingPct: z.number().nullable(),
  resetAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  unlimited: z.boolean(),
  fractionReported: z.boolean().nullable(),
  status: LiveQuotaStatusSchema,
  display: z.string(),
  expiryLabel: z.string().nullable(),
}).strict();
export type LiveQuotaEntry = z.infer<typeof LiveQuotaEntrySchema>;

export const OmniRouteConnectionCardSchema = z.object({
  connectionId: z.string(),
  provider: z.string(),
  appProvider: z.string().nullable(),
  label: z.string(),
  maskedAccount: z.string().nullable(),
  active: z.boolean(),
  fetchedAt: z.string().nullable(),
  error: z.string().nullable(),
  quotas: z.array(LiveQuotaEntrySchema),
  noQuotaData: z.boolean(),
  tasks: z.array(z.string()),
  rateLimitNote: z.string().nullable(),
  manualRule: z.object({
    provider: z.string(),
    model: z.string(),
  }).strict(),
}).strict();
export type OmniRouteConnectionCard = z.infer<typeof OmniRouteConnectionCardSchema>;

export const MissingQuotaModelSchema = z.object({
  provider: z.string(),
  model: z.string(),
  tasks: z.array(z.string()),
}).strict();
export type MissingQuotaModel = z.infer<typeof MissingQuotaModelSchema>;

export const OmniRouteLiveViewSchema = z.object({
  status: OmniRouteSyncStatusSchema,
  fetchedAt: z.string().nullable(),
  tokenSaved: z.boolean(),
  tokenLast4: z.string().nullable(),
  dashboardUrl: z.string(),
  message: z.string().nullable(),
  connections: z.array(OmniRouteConnectionCardSchema),
  missingModels: z.array(MissingQuotaModelSchema),
}).strict();
export type OmniRouteLiveView = z.infer<typeof OmniRouteLiveViewSchema>;

const EMPTY_OMNIROUTE_VIEW: OmniRouteLiveView = {
  status: "idle",
  fetchedAt: null,
  tokenSaved: false,
  tokenLast4: null,
  dashboardUrl: "http://127.0.0.1:20128",
  message: null,
  connections: [],
  missingModels: [],
};

export const LlmQuotaStatusSchema = z.object({
  quotaPolicy: QuotaPolicySchema,
  paidFallbackDailyUsd: z.number(),
  nearLimitRatio: z.number(),
  todaySpendUsd: z.number().nonnegative(),
  paidFallbackSpendToday: z.number().nonnegative(),
  /** Estimated USD spent from manual credit rules. Not included in paid fallback spend. */
  freeCreditSpendUsd: z.number().nonnegative().default(0),
  rows: z.array(LlmQuotaRowSchema),
  cooldowns: z.array(LlmQuotaCooldownSchema),
  omniroute: OmniRouteLiveViewSchema.default(EMPTY_OMNIROUTE_VIEW),
}).strict();
export type LlmQuotaStatus = z.infer<typeof LlmQuotaStatusSchema>;

export const LlmQuotaPolicyBodySchema = z.object({
  quotaPolicy: QuotaPolicySchema,
  paidFallbackDailyUsd: z.number().nonnegative().max(10_000),
  nearLimitRatio: z.number().gt(0).max(1).optional(),
}).strict();
export type LlmQuotaPolicyBody = z.infer<typeof LlmQuotaPolicyBodySchema>;

export const LlmQuotaModelRefSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
}).strict();
export type LlmQuotaModelRef = z.infer<typeof LlmQuotaModelRefSchema>;

export const OmniRouteTokenBodySchema = z.object({
  token: z.string().trim().min(8).max(500),
}).strict();
export type OmniRouteTokenBody = z.infer<typeof OmniRouteTokenBodySchema>;
