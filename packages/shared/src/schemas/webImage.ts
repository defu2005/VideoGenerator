import { z } from "zod";

export const DEFAULT_WEB_IMAGE_DOMAIN_DENYLIST = [
  "pinterest.com",
  "pinimg.com",
  "pinterest.co.uk",
] as const;

export const DEFAULT_WEB_IMAGE_GEMINI_MODEL = "gemini-2.5-flash";

export const WebImageSettingsSchema = z.object({
  braveEnabled: z.boolean().default(true),
  geminiGroundingEnabled: z.boolean().default(true),
  geminiModel: z.string().min(1).default(DEFAULT_WEB_IMAGE_GEMINI_MODEL),
  domainDenylist: z.array(z.string().min(1)).default([...DEFAULT_WEB_IMAGE_DOMAIN_DENYLIST]),
}).strict();
export type WebImageSettings = z.infer<typeof WebImageSettingsSchema>;

export const WebImageKeyConfiguredSchema = z.object({
  brave: z.boolean(),
  gemini: z.boolean(),
}).strict();

export const WebImageSettingsStatusSchema = WebImageSettingsSchema.extend({
  keyConfigured: WebImageKeyConfiguredSchema,
  braveRequestsThisMonth: z.number().int().nonnegative(),
}).strict();
export type WebImageSettingsStatus = z.infer<typeof WebImageSettingsStatusSchema>;
