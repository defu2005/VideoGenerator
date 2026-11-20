import { z } from "zod";

/** TASK-136: stable refusal and error codes of the LLM relay. */
export const LlmRelayCodeSchema = z.enum([
  "RELAY_MODEL_NOT_ALLOWED", "RELAY_RATE_LIMITED", "RELAY_BUDGET_EXCEEDED", "RELAY_DISABLED", "LLM_RELAY_UNAVAILABLE",
]);
export type LlmRelayCode = z.infer<typeof LlmRelayCodeSchema>;

export const LlmRelayGrantSchema = z.object({
  caller: z.string().min(1).max(200),
  workspaceId: z.string().nullable(),
  /** Allowed OmniRoute model or combo ids. Empty means every model the gateway lists. */
  models: z.array(z.string().min(1).max(200)).max(200),
  rpm: z.number().int().min(1).max(100000),
  tpm: z.number().int().min(100).max(100000000),
  dailyUsdCap: z.number().min(0).max(100000),
  enabled: z.boolean(),
  updatedAt: z.string(),
}).strict();
export type LlmRelayGrant = z.infer<typeof LlmRelayGrantSchema>;

export const LlmRelayGrantPatchSchema = LlmRelayGrantSchema.pick({
  models: true, rpm: true, tpm: true, dailyUsdCap: true, enabled: true,
}).partial().strict();
export type LlmRelayGrantPatch = z.infer<typeof LlmRelayGrantPatchSchema>;

export const LlmRelayCallerUsageSchema = z.object({
  caller: z.string(),
  label: z.string(),
  calls: z.number().int().nonnegative(),
  refused: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
  costUnknown: z.boolean().optional(),
  tokensUnknown: z.boolean().optional(),
  lastRefusal: z.string().nullable(),
  lastRefusalAt: z.string().nullable(),
  grant: LlmRelayGrantSchema.nullable(),
}).strict();
export type LlmRelayCallerUsage = z.infer<typeof LlmRelayCallerUsageSchema>;

export const LlmRelayStatusSchema = z.object({
  configured: z.boolean(),
  reachable: z.boolean(),
  modelCount: z.number().int().nonnegative(),
  lastError: z.string().nullable(),
  gatewayMode: z.enum(["off", "prefer", "only"]),
  defaultGrant: LlmRelayGrantSchema,
  callers: z.array(LlmRelayCallerUsageSchema),
  models: z.array(z.string()),
}).strict();
export type LlmRelayStatus = z.infer<typeof LlmRelayStatusSchema>;

export function relayCallerLabel(caller: string): string {
  if (caller === "*") return "Mặc định";
  if (caller.startsWith("node:")) return `Máy ${caller.slice(5)}`;
  if (caller.startsWith("agent:")) return `Agent ${caller.slice(6)}`;
  return caller;
}
