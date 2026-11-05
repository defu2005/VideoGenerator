import { z } from "zod";

export const LlmQuotaWindowSchema = z.enum(["minute", "day", "month", "rolling_5h"]);
export type LlmQuotaWindow = z.infer<typeof LlmQuotaWindowSchema>;

export const LlmQuotaKindSchema = z.enum(["free_tier", "subscription", "paid"]);
export type LlmQuotaKind = z.infer<typeof LlmQuotaKindSchema>;

export const LlmQuotaLimitSchema = z.object({
  window: LlmQuotaWindowSchema,
  requests: z.number().int().positive().optional(),
  inputTokens: z.number().int().positive().optional(),
  outputTokens: z.number().int().positive().optional(),
}).strict().refine(
  (limit) => limit.requests !== undefined || limit.inputTokens !== undefined || limit.outputTokens !== undefined,
  "A quota limit needs requests, inputTokens, or outputTokens",
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

export const LlmQuotaStatusSchema = z.object({
  quotaPolicy: QuotaPolicySchema,
  paidFallbackDailyUsd: z.number(),
  nearLimitRatio: z.number(),
  todaySpendUsd: z.number().nonnegative(),
  paidFallbackSpendToday: z.number().nonnegative(),
  rows: z.array(LlmQuotaRowSchema),
  cooldowns: z.array(LlmQuotaCooldownSchema),
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
