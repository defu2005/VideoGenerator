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

/** Built-in provider ids plus custom OpenAI-compatible providers saved in the app (`custom-<slug>`). */
export const LlmProviderRefIdSchema = z.union([LlmProviderIdSchema, z.string().regex(/^custom-[a-z0-9][a-z0-9-]{0,30}$/)]);

export const LlmProviderInfoSchema = z.object({
  id: LlmProviderRefIdSchema,
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
export type LlmFallback = z.infer<typeof LlmFallbackSchema>;

export const LlmRouteSchema = z.object({
  provider: z.string().min(1),
  model: z.string().optional(),
  maxOutputTokens: z.number().int().min(256).max(32_000).optional(),
  /** @deprecated Prefer `fallbacks`. Still accepted as a chain of one. */
  fallback: LlmFallbackSchema.optional(),
  fallbacks: z.array(LlmFallbackSchema).max(4).optional(),
}).strict();
export type LlmRoute = z.infer<typeof LlmRouteSchema>;

/** Ordered fallback chain. `fallbacks` wins; a lone `fallback` is a chain of one. */
export function fallbackChainOf(route: { fallback?: LlmFallback; fallbacks?: LlmFallback[] } | null | undefined): LlmFallback[] {
  if (!route) return [];
  if (route.fallbacks && route.fallbacks.length > 0) return route.fallbacks.slice(0, 4);
  if (route.fallback) return [route.fallback];
  return [];
}

export const LlmTaskIdSchema = z.enum([
  "retrievalEmbed",
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
  "thumbnailPick",
  "musicAssist",
  "metadata",
  "reviewChat",
  "modelAdvisor",
  "topicSuggest",
  "stylePack",
  "assistantChat",
  "financeInsight",
  "performanceInsight",
  "clipPick",
  "commentAssist",
  "trendMatch",
  "translateScript",
  "providerIntelExtract",
  "knowledgeWatch",
  "editPlan",
  "formatPick",
  "stageTimeouts",
  "operatorPlan",
  "operatorClassify",
  "operatorRepair",
  "overdueCheck",
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
  { id: "thumbnailPick", label: "Chọn thumbnail", stage: "RENDER", purpose: "Pick the best frame, overlay text and position for the thumbnail.", tier: "fast", qualityWeight: 2, needsVision: true, budgetFeature: "thumbnailPick" },
  { id: "musicAssist", label: "Chọn mood nhạc", stage: "MUSIC_SEARCH", purpose: "Assist with music mood selection.", tier: "fast", qualityWeight: 1, budgetFeature: "musicAssist" },
  { id: "metadata", label: "Tiêu đề, mô tả, hashtag", stage: "TIMELINE", purpose: "Generate publishing metadata.", tier: "fast", qualityWeight: 2, budgetFeature: "metadata" },
  { id: "reviewChat", label: "Góp ý trước render", stage: "FINAL_APPROVAL", purpose: "Optional pre-render review chat with structured proposals.", tier: "strong", qualityWeight: 2, needsLongContext: true },
  { id: "modelAdvisor", label: "Gợi ý model bằng AI", stage: "SETTINGS", purpose: "Propose an LLM route for every task given available models and budget mode.", tier: "fast", qualityWeight: 1, budgetFeature: "modelAdvisor" },
  { id: "topicSuggest", label: "Gợi ý chủ đề", stage: "SETTINGS", purpose: "Suggest video topics from a profile direction without repeating past topics.", tier: "fast", qualityWeight: 1, budgetFeature: "topicSuggest" },
  { id: "stylePack", label: "Gợi ý phong cách kênh", stage: "SETTINGS", purpose: "Propose a channel style pack (tokens-v1) that differs from the other channels.", tier: "fast", qualityWeight: 1 },
  { id: "assistantChat", label: "Trợ lý AI điều khiển app", stage: "SETTINGS", purpose: "Chat assistant that clarifies requests and runs app tools (web + Telegram).", tier: "fast", qualityWeight: 1, budgetFeature: "assistantChat" },
  { id: "financeInsight", label: "Nhận xét báo cáo doanh thu", stage: "SETTINGS", purpose: "3–5 Vietnamese bullet points on what went well or badly in a monthly finance report.", tier: "fast", qualityWeight: 1, budgetFeature: "financeInsight" },
  { id: "performanceInsight", label: "Bài học từ số liệu", stage: "SETTINGS", purpose: "Vietnamese patterns and recommendations from past video performance for one profile.", tier: "strong", qualityWeight: 2, budgetFeature: "performanceInsight" },
  { id: "clipPick", label: "Chọn đoạn Shorts", stage: "RENDER", purpose: "Pick vertical clip ranges from a finished long video.", tier: "strong", qualityWeight: 3, budgetFeature: "clipPick" },
  { id: "commentAssist", label: "Phân loại và gợi ý trả lời bình luận", stage: "SETTINGS", purpose: "Classify comments and draft short replies in the comment's language.", tier: "fast", qualityWeight: 1, budgetFeature: "commentAssist" },
  { id: "trendMatch", label: "Ghép xu hướng với kênh", stage: "SETTINGS", purpose: "Turn trending items into a few topic ideas that fit the channel.", tier: "fast", qualityWeight: 1, budgetFeature: "trendMatch" },
  { id: "translateScript", label: "Dịch kịch bản", stage: "SCRIPT", purpose: "Translate a finished script scene by scene for another language.", tier: "strong", qualityWeight: 3, needsLongContext: true, budgetFeature: "translateScript" },
  { id: "providerIntelExtract", label: "Trích trang nhà cung cấp", stage: "SETTINGS", purpose: "Propose quote-backed provider facts from an official page. Values without a verbatim quote are dropped.", tier: "fast", qualityWeight: 1, budgetFeature: "providerIntelExtract" },
  { id: "knowledgeWatch", label: "Đọc thay đổi tri thức", stage: "KNOWLEDGE", purpose: "Read a changed official source and propose only quote-backed knowledge changes.", tier: "fast", qualityWeight: 1, budgetFeature: "providerIntelExtract" },
  { id: "editPlan", label: "Kế hoạch dựng", stage: "TIMELINE", purpose: "Choose transitions, camera motion, emphasis and the subtitle style for one video.", tier: "strong", qualityWeight: 2, budgetFeature: "editPlan" },
  { id: "formatPick", label: "Chọn mẫu video", stage: "SCRIPT", purpose: "Pick a format recipe from the topic, niche and aspect.", tier: "fast", qualityWeight: 1, budgetFeature: "formatPick" },
  { id: "stageTimeouts", label: "Thời gian tối đa mỗi bước", stage: "SETTINGS", purpose: "Choose a per-stage timeout from the brief.", tier: "fast", qualityWeight: 1, budgetFeature: "stageTimeouts" },
  { id: "operatorPlan", label: "Lập mục tiêu tự vận hành", stage: "SETTINGS", purpose: "Turn the owner's goal into a structured plan.", tier: "fast", qualityWeight: 1, budgetFeature: "operatorPlan" },
  { id: "operatorClassify", label: "Phân loại lời chủ kênh", stage: "SETTINGS", purpose: "Classify an owner message as a goal, request, feedback or control.", tier: "fast", qualityWeight: 1, budgetFeature: "operatorClassify" },
  { id: "operatorRepair", label: "Chọn cách tự sửa chất lượng", stage: "SETTINGS", purpose: "Pick one repair action per quality issue from a fixed list. Code keeps the facts and the limits.", tier: "fast", qualityWeight: 1, budgetFeature: "operatorPlan" },
  { id: "overdueCheck", label: "Kiểm tra bước chạy quá giờ", stage: "SETTINGS", purpose: "Pick wait or escalate for a stage that passed its limit. Code owns the facts and the limits.", tier: "fast", qualityWeight: 1, budgetFeature: "operatorPlan" },
  { id: "retrievalEmbed", label: "Embedding tri thức", stage: "RESEARCH", purpose: "Embed channel knowledge for retrieval.", tier: "fast", qualityWeight: 1, budgetFeature: "knowledgeEmbeddings" },
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
    ...(legacy.quotaPolicy === "wait" || legacy.quotaPolicy === "paid_fallback" ? { quotaPolicy: legacy.quotaPolicy } : {}),
    ...(typeof legacy.paidFallbackDailyUsd === "number" ? { paidFallbackDailyUsd: legacy.paidFallbackDailyUsd } : {}),
    ...(typeof legacy.autoSwapOnQuota === "boolean" ? { autoSwapOnQuota: legacy.autoSwapOnQuota } : {}),
    ...(legacy.capabilityOverrides && typeof legacy.capabilityOverrides === "object" && !Array.isArray(legacy.capabilityOverrides)
      ? { capabilityOverrides: legacy.capabilityOverrides } : {}),
  };
}

const CapabilityOverrideSchema = z.object({
  vision: z.boolean().optional(),
  tools: z.boolean().optional(),
  json: z.boolean().optional(),
}).strict();
const LlmSettingsObjectSchema = z.object({
  default: LlmRouteSchema.optional(),
  tasks: z.partialRecord(LlmTaskIdSchema, LlmRouteSchema).optional(),
  autoSwapOnQuota: z.boolean().optional(),
  capabilityOverrides: z.record(z.string(), CapabilityOverrideSchema).optional(),
}).strict();
export const LlmSettingsSchema = z.preprocess(normalizeLlmSettings, LlmSettingsObjectSchema);
export type LlmSettings = z.infer<typeof LlmSettingsSchema>;

export const VISION_ROUTE_TASKS: LlmTaskId[] = LLM_TASKS.filter((task) => task.needsVision).map((task) => task.id);

/** Grok 4 and later accept images. The OmniRoute catalog often omits the vision flag. */
export function omnirouteModelSeesImages(model: string): boolean {
  const id = model.trim().toLowerCase();
  return /(?:^|\/)grok-(?:4(?:[.-]|$)|imagine(?:[/-]|$)|2-vision(?:[/-]|$))/.test(id);
}

/** A provider flagged vision-off stores maxImagesPerCall 0. Enabling vision uses at least 10. */
export function visionImageBatchLimit(current: number | undefined): number {
  return Math.max(10, current && current > 0 ? current : 0);
}

export const LlmModelRefSchema = z.object({
  provider: z.string().min(1).max(80),
  model: z.string().min(1).max(200),
}).strict();
export type LlmModelRef = z.infer<typeof LlmModelRefSchema>;

export const LlmVisionMarksSchema = z.object({
  models: z.array(LlmModelRefSchema).max(40),
}).strict();
export type LlmVisionMarks = z.infer<typeof LlmVisionMarksSchema>;

export const LlmRouteAssignmentSchema = z.object({
  task: z.union([LlmTaskIdSchema, z.literal("default"), z.literal("vision")]),
  provider: z.string().min(1).max(80),
  model: z.string().min(1).max(200),
}).strict();
export type LlmRouteAssignment = z.infer<typeof LlmRouteAssignmentSchema>;

export const LlmRouteAssignBodySchema = z.object({
  scope: z.enum(["app", "project"]).default("app"),
  projectId: z.string().uuid().optional(),
  assignments: z.array(LlmRouteAssignmentSchema).min(1).max(40),
}).strict().superRefine((value, ctx) => {
  if (value.scope === "project" && !value.projectId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Thiếu projectId.", path: ["projectId"] });
  }
});
export type LlmRouteAssignBody = z.infer<typeof LlmRouteAssignBodySchema>;

export const LlmRouteAssignResultSchema = z.object({
  scope: z.enum(["app", "project"]),
  projectId: z.string().uuid().optional(),
  default: LlmRouteSchema.optional(),
  tasks: z.partialRecord(LlmTaskIdSchema, LlmRouteSchema),
  visionModels: z.array(LlmModelRefSchema),
  markedNow: z.array(LlmModelRefSchema),
}).strict();
export type LlmRouteAssignResult = z.infer<typeof LlmRouteAssignResultSchema>;
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
  quotaPolicy: z.enum(["wait", "paid_fallback"]).optional(),
  paidFallbackDailyUsd: z.number().nonnegative().max(10_000).optional(),
  autoSwapOnQuota: z.boolean().optional(),
  capabilityOverrides: z.record(z.string(), CapabilityOverrideSchema).optional(),
}).strict());
export type ProfileLlmSettings = z.infer<typeof ProfileLlmSettingsSchema>;

export const ProfileLlmSettingsInputSchema = z.preprocess(normalizeLlmSettings, z.object({
  default: LlmRouteSchema.optional(),
  tasks: z.partialRecord(LlmTaskIdSchema, LlmRouteSchema.nullable()).optional(),
  autoModel: z.boolean().optional(),
  quotaPolicy: z.enum(["wait", "paid_fallback"]).nullable().optional(),
  paidFallbackDailyUsd: z.number().nonnegative().max(10_000).nullable().optional(),
  autoSwapOnQuota: z.boolean().nullable().optional(),
  capabilityOverrides: z.record(z.string(), CapabilityOverrideSchema).optional(),
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
