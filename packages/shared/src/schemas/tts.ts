import { z } from "zod";
import { DEFAULT_ELEVEN_MODEL, DEFAULT_GEMINI_TTS_MODEL, DEFAULT_OPENAI_TTS_MODEL } from "../tts/requests.js";

export const TtsTimingSourceSchema = z.enum(["provider", "aligned", "estimated"]);
export type TtsTimingSource = z.infer<typeof TtsTimingSourceSchema>;

export const TtsAppSettingsSchema = z.object({
  defaultProvider: z.string().trim().min(1).max(40).default("edge-tts"),
  defaultVoice: z.string().trim().max(200).default(""),
  defaultRate: z.string().regex(/^[+-]\d{1,3}%$/).default("+0%"),
  pricesPerMillion: z.record(z.string(), z.number().nonnegative()).default({}),
  geminiModel: z.string().trim().min(1).max(120).default(DEFAULT_GEMINI_TTS_MODEL),
  elevenModel: z.string().trim().min(1).max(120).default(DEFAULT_ELEVEN_MODEL),
  openaiModel: z.string().trim().min(1).max(120).default(DEFAULT_OPENAI_TTS_MODEL),
  piperBinary: z.string().max(500).default(""),
  piperModelsDir: z.string().max(500).default(""),
  vieneuTemplate: z.string().max(1000).default(""),
}).strict();
export type TtsAppSettings = z.infer<typeof TtsAppSettingsSchema>;

export const TtsAppSettingsInputSchema = TtsAppSettingsSchema.partial().strict();
export type TtsAppSettingsInput = z.infer<typeof TtsAppSettingsInputSchema>;

export const TtsSubscriptionSchema = z.object({
  charactersUsed: z.number().nonnegative(),
  characterLimit: z.number().nonnegative(),
}).strict();

export const TtsProviderStatusSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.enum(["http", "cli", "mock"]),
  configured: z.boolean(),
  paid: z.boolean(),
  wordTimings: z.boolean(),
  pricePerMillion: z.number().nonnegative(),
  languages: z.array(z.string()),
  model: z.string().optional(),
  binaryPath: z.string().optional(),
  modelsDir: z.string().optional(),
  commandTemplate: z.string().optional(),
  subscription: TtsSubscriptionSchema.optional(),
}).strict();
export type TtsProviderStatus = z.infer<typeof TtsProviderStatusSchema>;

export const TtsSettingsResponseSchema = z.object({
  settings: TtsAppSettingsSchema,
  providers: z.array(TtsProviderStatusSchema),
}).strict();
export type TtsSettingsResponse = z.infer<typeof TtsSettingsResponseSchema>;

export const TtsSecretInputSchema = z.object({
  provider: z.string().trim().min(1).max(40),
  apiKey: z.string().max(500),
}).strict();

export const TtsPreviewInputSchema = z.object({
  provider: z.string().trim().min(1).max(40),
  voice: z.string().trim().min(1).max(200),
  text: z.string().trim().min(1).max(400),
  rate: z.string().regex(/^[+-]\d{1,3}%$/).optional(),
  style: z.string().max(500).optional(),
}).strict();
