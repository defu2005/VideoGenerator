import { z } from "zod";
import type { BudgetFeatures } from "../budget/modes.js";

export const LlmProviderIdSchema = z.enum([
  "anthropic",
  "gemini",
  "openai",
  "ollama",
  "openrouter",
  "deepseek",
  "groq",
  "omniroute",
  "opencode",
  "custom",
  "mock",
  "claude-cli",
  "copilot-cli",
  "antigravity-cli",
]);
export type LlmProviderId = z.infer<typeof LlmProviderIdSchema>;

export const LlmProviderInfoSchema = z.object({
  id: LlmProviderIdSchema,
  label: z.string(),
  configured: z.boolean(),
  defaultModel: z.string().nullable(),
  hint: z.string().optional(),
  limits: z.object({
    maxInputTokens: z.number().int().positive().optional(),
    maxOutputTokens: z.number().int().positive().optional(),
  }).optional(),
  usage: z.object({
    monthCalls: z.number().int().nonnegative(),
  }).optional(),
});
export type LlmProviderInfo = z.infer<typeof LlmProviderInfoSchema>;

export const LlmSelectionSchema = z.object({
  provider: z.string().min(1),
  model: z.string().optional(),
}).strict();
export type LlmSelection = z.infer<typeof LlmSelectionSchema>;

const LlmFallbackSchema = z.object({
  provider: z.string().min(1),
  model: z.string().optional(),
}).strict();

export const LlmRouteSchema = z.object({
  provider: z.string().min(1),
  model: z.string().optional(),
  maxOutputTokens: z.number().int().min(256).max(32_000).optional(),
  fallback: LlmFallbackSchema.optional(),
}).strict();
export type LlmRoute = z.infer<typeof LlmRouteSchema>;

export const LlmTaskIdSchema = z.enum([
  "research",
  "script",
  "scriptReview",
  "guidelineCheck",
  "sceneQueries",
  "visualAltQueries",
  "visualRerank",
  "visionCheck",
  "musicAssist",
  "metadata",
]);
export type LlmTaskId = z.infer<typeof LlmTaskIdSchema>;

export const LLM_TASKS: {
  id: LlmTaskId;
  label: string;
  stage: string;
  purpose: string;
  tier: "strong" | "fast";
  budgetFeature?: keyof BudgetFeatures;
}[] = [
  { id: "research", label: "Nghiên cứu", stage: "RESEARCH", purpose: "Research facts and sources for the video.", tier: "strong" },
  { id: "script", label: "Viết kịch bản", stage: "SCRIPT", purpose: "Write narration and scene-level visual queries.", tier: "strong" },
  { id: "scriptReview", label: "Biên tập kịch bản", stage: "SCRIPT", purpose: "Review and improve the generated script.", tier: "strong", budgetFeature: "scriptReviewPasses" },
  { id: "guidelineCheck", label: "Kiểm tra định hướng nội dung", stage: "SCRIPT", purpose: "Check the script against platform and channel guideline packs.", tier: "strong", budgetFeature: "guidelineCheck" },
  { id: "sceneQueries", label: "Mô tả hình + từ khóa theo scene", stage: "SCENE_PLAN", purpose: "Create concrete visual descriptions and search queries per scene.", tier: "fast", budgetFeature: "sceneQueryAssist" },
  { id: "visualAltQueries", label: "Gợi ý từ khóa khi thiếu ảnh", stage: "VISUAL_SEARCH", purpose: "Suggest alternative image queries when results are poor.", tier: "fast", budgetFeature: "altQueryAssist" },
  { id: "visualRerank", label: "Xếp hạng ảnh theo ngữ nghĩa", stage: "VISUAL_SEARCH", purpose: "Rerank candidates using text metadata, without vision.", tier: "fast", budgetFeature: "semanticImageRerank" },
  { id: "visionCheck", label: "Kiểm tra ảnh bằng vision", stage: "VISUAL_REVIEW", purpose: "Check candidate image content.", tier: "fast", budgetFeature: "visionCheck" },
  { id: "musicAssist", label: "Chọn mood nhạc", stage: "MUSIC_SEARCH", purpose: "Assist with music mood selection.", tier: "fast", budgetFeature: "musicAssist" },
  { id: "metadata", label: "Tiêu đề, mô tả, hashtag", stage: "FINAL", purpose: "Generate publishing metadata.", tier: "fast", budgetFeature: "metadata" },
];

function normalizeLlmSettings(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const legacy = value as Record<string, unknown>;
  const tasks = { ...(typeof legacy.tasks === "object" && legacy.tasks !== null ? legacy.tasks as Record<string, unknown> : {}) };
  if (legacy.research !== undefined && tasks.research === undefined) tasks.research = legacy.research;
  if (legacy.script !== undefined) {
    if (tasks.script === undefined) tasks.script = legacy.script;
    if (tasks.scriptReview === undefined) tasks.scriptReview = legacy.script;
  }
  if (legacy.sceneplan !== undefined) {
    if (tasks.sceneQueries === undefined) tasks.sceneQueries = legacy.sceneplan;
    if (tasks.visualAltQueries === undefined) tasks.visualAltQueries = legacy.sceneplan;
    if (tasks.visualRerank === undefined) tasks.visualRerank = legacy.sceneplan;
  }
  return {
    ...(legacy.default === undefined ? {} : { default: legacy.default }),
    ...(Object.keys(tasks).length === 0 ? {} : { tasks }),
  };
}

const LlmSettingsObjectSchema = z.object({
  default: LlmRouteSchema.optional(),
  tasks: z.partialRecord(LlmTaskIdSchema, LlmRouteSchema).optional(),
}).strict();
export const LlmSettingsSchema = z.preprocess(normalizeLlmSettings, LlmSettingsObjectSchema);
export type LlmSettings = z.infer<typeof LlmSettingsSchema>;
export const LlmSettingsInputSchema = z.preprocess(normalizeLlmSettings, z.object({
  default: LlmRouteSchema.optional(),
  tasks: z.partialRecord(LlmTaskIdSchema, LlmRouteSchema.nullable()).optional(),
}).strict());
export type LlmSettingsInput = z.infer<typeof LlmSettingsInputSchema>;
