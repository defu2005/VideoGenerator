import { z } from "zod";
import type { BudgetFeatures } from "../budget/modes.js";

export const LlmProviderIdSchema = z.enum([
  "anthropic",
  "gemini",
  "openai",
  "ollama",
  "remote-ollama",
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
  "factCheck",
  "sceneQueries",
  "visualAltQueries",
  "visualRerank",
  "visionCheck",
  "visionResearch",
  "visionConsistency",
  "webImageGrounding",
  "renderVision",
  "musicAssist",
  "metadata",
  "reviewChat",
  "modelAdvisor",
  "topicSuggest",
]);
export type LlmTaskId = z.infer<typeof LlmTaskIdSchema>;

export const LLM_TASKS: {
  id: LlmTaskId;
  label: string;
  stage: string;
  purpose: string;
  tier: "strong" | "fast";
  /** How much quality matters for this task (1 = cheap/fast OK, 3 = prefer best model). */
  qualityWeight: 1 | 2 | 3;
  needsVision?: boolean;
  needsLongContext?: boolean;
  budgetFeature?: keyof BudgetFeatures;
}[] = [
  { id: "research", label: "Nghiên cứu", stage: "RESEARCH", purpose: "Research facts and sources for the video.", tier: "strong", qualityWeight: 3, needsLongContext: true },
  { id: "script", label: "Viết kịch bản", stage: "SCRIPT", purpose: "Write narration and scene-level visual queries.", tier: "strong", qualityWeight: 3, needsLongContext: true },
  { id: "scriptReview", label: "Biên tập kịch bản", stage: "SCRIPT", purpose: "Review and improve the generated script.", tier: "strong", qualityWeight: 3, needsLongContext: true, budgetFeature: "scriptReviewPasses" },
  { id: "guidelineCheck", label: "Kiểm tra định hướng nội dung", stage: "SCRIPT", purpose: "Check the script against platform and channel guideline packs.", tier: "strong", qualityWeight: 3, needsLongContext: true, budgetFeature: "guidelineCheck" },
  { id: "factCheck", label: "Đối chiếu fact với research", stage: "SCRIPT", purpose: "Check script claims against research notes and soften unsupported ones.", tier: "strong", qualityWeight: 3, needsLongContext: true, budgetFeature: "factCheck" },
  { id: "sceneQueries", label: "Mô tả hình + từ khóa theo scene", stage: "SCENE_PLAN", purpose: "Create concrete visual descriptions and search queries per scene.", tier: "fast", qualityWeight: 2, budgetFeature: "sceneQueryAssist" },
  { id: "visualAltQueries", label: "Gợi ý từ khóa khi thiếu ảnh", stage: "VISUAL_SEARCH", purpose: "Suggest alternative image queries when results are poor.", tier: "fast", qualityWeight: 1, budgetFeature: "altQueryAssist" },
  { id: "visualRerank", label: "Xếp hạng ảnh theo ngữ nghĩa", stage: "VISUAL_SEARCH", purpose: "Rerank candidates using text metadata, without vision.", tier: "fast", qualityWeight: 2, budgetFeature: "semanticImageRerank" },
  { id: "visionCheck", label: "Kiểm tra ảnh bằng vision", stage: "VISUAL_SEARCH", purpose: "Check candidate image content with a vision model.", tier: "fast", qualityWeight: 3, needsVision: true, budgetFeature: "visionCheck" },
  { id: "visionResearch", label: "Tìm lại ảnh từ phản hồi vision", stage: "VISUAL_SEARCH", purpose: "Turn vision feedback into new search queries.", tier: "fast", qualityWeight: 2, budgetFeature: "visionCheck" },
  { id: "visionConsistency", label: "Đồng nhất ảnh giữa các scene", stage: "VISUAL_SEARCH", purpose: "Flag inconsistent style/era or accidental duplicates across selected images.", tier: "fast", qualityWeight: 3, needsVision: true, budgetFeature: "visionCheck" },
  { id: "webImageGrounding", label: "Tìm ảnh web (Gemini grounding)", stage: "VISUAL_SEARCH", purpose: "Ask Gemini with google_search for source page URLs when stock results are weak.", tier: "fast", qualityWeight: 1, budgetFeature: "webImageSearch" },
  { id: "renderVision", label: "Kiểm tra frame sau render", stage: "RENDER", purpose: "Vision-check mid-frame thumbnails after render.", tier: "fast", qualityWeight: 3, needsVision: true, budgetFeature: "renderVerify" },
  { id: "musicAssist", label: "Chọn mood nhạc", stage: "MUSIC_SEARCH", purpose: "Assist with music mood selection.", tier: "fast", qualityWeight: 1, budgetFeature: "musicAssist" },
  { id: "metadata", label: "Tiêu đề, mô tả, hashtag", stage: "TIMELINE", purpose: "Generate publishing metadata.", tier: "fast", qualityWeight: 2, budgetFeature: "metadata" },
  { id: "reviewChat", label: "Góp ý trước render", stage: "FINAL_APPROVAL", purpose: "Optional pre-render review chat with structured proposals.", tier: "strong", qualityWeight: 2, needsLongContext: true },
  { id: "modelAdvisor", label: "Gợi ý model bằng AI", stage: "SETTINGS", purpose: "Propose an LLM route for every task given available models and budget mode.", tier: "fast", qualityWeight: 1, budgetFeature: "modelAdvisor" },
  { id: "topicSuggest", label: "Gợi ý chủ đề", stage: "SETTINGS", purpose: "Suggest video topics from a profile direction without repeating past topics.", tier: "fast", qualityWeight: 1, budgetFeature: "topicSuggest" },
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
  // reviewChat defaults to the script route when unset (ignore nullable reset markers).
  if (tasks.reviewChat === undefined && tasks.script !== undefined && tasks.script !== null) {
    tasks.reviewChat = tasks.script;
  }
  return {
    ...(legacy.default === undefined ? {} : { default: legacy.default }),
    ...(Object.keys(tasks).length === 0 ? {} : { tasks }),
    ...(typeof legacy.autoModel === "boolean" ? { autoModel: legacy.autoModel } : {}),
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

/** Profile LLM settings: same routes plus an automation toggle for the model advisor. */
export const ProfileLlmSettingsSchema = z.preprocess(normalizeLlmSettings, z.object({
  default: LlmRouteSchema.optional(),
  tasks: z.partialRecord(LlmTaskIdSchema, LlmRouteSchema).optional(),
  autoModel: z.boolean().default(true),
}).strict());
export type ProfileLlmSettings = z.infer<typeof ProfileLlmSettingsSchema>;

export const ProfileLlmSettingsInputSchema = z.preprocess(normalizeLlmSettings, z.object({
  default: LlmRouteSchema.optional(),
  tasks: z.partialRecord(LlmTaskIdSchema, LlmRouteSchema.nullable()).optional(),
  autoModel: z.boolean().optional(),
}).strict());
export type ProfileLlmSettingsInput = z.infer<typeof ProfileLlmSettingsInputSchema>;

export const ModelAdvisorRoutePickSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  reason: z.string().min(1),
}).strict();
export type ModelAdvisorRoutePick = z.infer<typeof ModelAdvisorRoutePickSchema>;

/** Raw LLM output for the modelAdvisor task. */
export const ModelAdvisorOutputSchema = z.object({
  routes: z.record(z.string(), ModelAdvisorRoutePickSchema),
  notes: z.string(),
}).strict();
export type ModelAdvisorOutput = z.infer<typeof ModelAdvisorOutputSchema>;

export const ModelAdvisorScopeSchema = z.enum(["app", "profile", "project"]);
export type ModelAdvisorScope = z.infer<typeof ModelAdvisorScopeSchema>;

export const ModelAdvisorProposeBodySchema = z.object({
  scope: ModelAdvisorScopeSchema,
  id: z.string().uuid().optional(),
  budgetMode: z.enum(["ECO", "BALANCED", "QUALITY", "MAX", "CUSTOM"]).optional(),
}).strict();
export type ModelAdvisorProposeBody = z.infer<typeof ModelAdvisorProposeBodySchema>;

export const ModelAdvisorDiffEntrySchema = z.object({
  taskId: LlmTaskIdSchema,
  current: z.object({
    provider: z.string(),
    model: z.string(),
  }).nullable(),
  proposed: ModelAdvisorRoutePickSchema,
  changed: z.boolean(),
}).strict();
export type ModelAdvisorDiffEntry = z.infer<typeof ModelAdvisorDiffEntrySchema>;

export const ModelAdvisorProposalSchema = z.object({
  proposalId: z.string().min(1),
  scope: ModelAdvisorScopeSchema,
  id: z.string().uuid().optional(),
  budgetMode: z.enum(["ECO", "BALANCED", "QUALITY", "MAX", "CUSTOM"]),
  language: z.string(),
  routes: z.partialRecord(LlmTaskIdSchema, ModelAdvisorRoutePickSchema),
  notes: z.string(),
  diff: z.array(ModelAdvisorDiffEntrySchema),
  cached: z.boolean(),
  createdAt: z.string().datetime({ offset: true }),
}).strict();
export type ModelAdvisorProposal = z.infer<typeof ModelAdvisorProposalSchema>;

export const ModelAdvisorApplyBodySchema = z.object({
  scope: ModelAdvisorScopeSchema,
  id: z.string().uuid().optional(),
  proposalId: z.string().min(1),
  taskIds: z.array(LlmTaskIdSchema).optional(),
}).strict();
export type ModelAdvisorApplyBody = z.infer<typeof ModelAdvisorApplyBodySchema>;

export const ModelAdvisorApplyResultSchema = z.object({
  scope: ModelAdvisorScopeSchema,
  id: z.string().uuid().optional(),
  applied: z.array(LlmTaskIdSchema),
  llm: z.union([LlmSettingsSchema, ProfileLlmSettingsSchema]),
}).strict();
export type ModelAdvisorApplyResult = z.infer<typeof ModelAdvisorApplyResultSchema>;
