import { z } from "zod";

export const LlmProviderIdSchema = z.enum([
  "anthropic",
  "gemini",
  "openai",
  "ollama",
  "openrouter",
  "deepseek",
  "groq",
  "custom",
  "mock",
  "claude-cli",
]);
export type LlmProviderId = z.infer<typeof LlmProviderIdSchema>;

export const LlmProviderInfoSchema = z.object({
  id: LlmProviderIdSchema,
  label: z.string(),
  configured: z.boolean(),
  defaultModel: z.string().nullable(),
  hint: z.string().optional(),
});
export type LlmProviderInfo = z.infer<typeof LlmProviderInfoSchema>;

export const LlmSelectionSchema = z.object({
  provider: z.string().min(1),
  model: z.string().optional(),
}).strict();
export type LlmSelection = z.infer<typeof LlmSelectionSchema>;
