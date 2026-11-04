import { z } from "zod";

export const LlmGatewayModeSchema = z.enum(["off", "prefer", "only"]);
export type LlmGatewayMode = z.infer<typeof LlmGatewayModeSchema>;

export const LlmGatewayMappingSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  omnirouteModel: z.string().min(1),
}).strict();
export type LlmGatewayMapping = z.infer<typeof LlmGatewayMappingSchema>;

export const LlmGatewaySettingsSchema = z.object({
  mode: LlmGatewayModeSchema.default("off"),
  mappings: z.array(LlmGatewayMappingSchema).default([]),
}).strict();
export type LlmGatewaySettings = z.infer<typeof LlmGatewaySettingsSchema>;

export const OmniRouteModelPricingSchema = z.object({
  inputPerMTok: z.number().nonnegative(),
  outputPerMTok: z.number().nonnegative(),
}).strict();
export type OmniRouteModelPricing = z.infer<typeof OmniRouteModelPricingSchema>;

export const OmniRouteModelInfoSchema = z.object({
  id: z.string().min(1),
  ownedBy: z.string(),
  contextWindow: z.number().positive().optional(),
  vision: z.boolean().optional(),
  pricing: OmniRouteModelPricingSchema.optional(),
}).strict();
export type OmniRouteModelInfo = z.infer<typeof OmniRouteModelInfoSchema>;

export const OmniRouteHealthSchema = z.object({
  reachable: z.boolean(),
  latencyMs: z.number().nonnegative().nullable(),
  modelCount: z.number().int().nonnegative(),
  lastError: z.string().nullable(),
  baseUrl: z.string(),
  configured: z.boolean(),
  setupHint: z.string(),
}).strict();
export type OmniRouteHealth = z.infer<typeof OmniRouteHealthSchema>;

export const OmniRouteCatalogSchema = z.object({
  models: z.array(OmniRouteModelInfoSchema),
  cachedAt: z.string().nullable(),
  baseUrl: z.string(),
}).strict();
export type OmniRouteCatalog = z.infer<typeof OmniRouteCatalogSchema>;

export const OMNIROUTE_SETUP_HINT =
  "Cài OmniRoute, kết nối nhà cung cấp trong dashboard, tạo endpoint key, rồi đặt OMNIROUTE_API_KEY trong .env (và OMNIROUTE_BASE_URL nếu khác cổng mặc định).";
