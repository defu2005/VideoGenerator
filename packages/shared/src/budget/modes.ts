import { z } from "zod";
import { VISION_IMAGE_TOKEN_ESTIMATE } from "../schemas/vision.js";

export const BudgetModeSchema = z.enum(["ECO", "BALANCED", "QUALITY", "MAX", "CUSTOM"]);
export type BudgetMode = z.infer<typeof BudgetModeSchema>;

export const BudgetFeaturesSchema = z.object({
  storyMode: z.enum(["merged", "separate"]),
  repairAttempts: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  scriptReview: z.boolean(),
  scriptReviewPasses: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  researchDepth: z.enum(["light", "standard", "deep"]),
  altQueryAssist: z.boolean(),
  sceneQueryAssist: z.boolean(),
  semanticImageRerank: z.boolean(),
  visionCheck: z.boolean(),
  /** Automatic re-search rounds when vision fit is below threshold (MAX / CUSTOM). */
  visionRetryRounds: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  /** Minimum vision fit / 10 to accept a candidate (default 7). */
  visionThreshold: z.number().min(0).max(10),
  /** Stop visual search once this many relevant candidates exist per scene. */
  visualSearchBreadth: z.union([z.literal(8), z.literal(16)]),
  /** Post-render vision verification of mid-frame thumbnails. */
  renderVerify: z.boolean(),
  /** Extra script pass checking claims against research notes. */
  factCheck: z.boolean(),
  musicAssist: z.boolean(),
  metadata: z.boolean(),
  /** LLM check against guideline packs after the script review; checkAndFix adds one fix pass. */
  guidelineCheck: z.enum(["off", "check", "checkAndFix"]),
  /**
   * Max low-relevance scenes that get a web image search (Brave / Gemini grounding).
   * 0 = off, 999 = all low scenes (MAX).
   */
  webImageSearch: z.union([z.literal(0), z.literal(3), z.literal(8), z.literal(999)]),
  outputHeadroom: z.union([z.literal(1), z.literal(1.5), z.literal(2)]),
}).strict();
export type BudgetFeatures = z.infer<typeof BudgetFeaturesSchema>;

/** Cap scenes for web image search; 999 means every low-relevance scene. */
export function webImageSearchSceneCap(features: Pick<BudgetFeatures, "webImageSearch">, lowSceneCount: number): number {
  if (features.webImageSearch <= 0 || lowSceneCount <= 0) return 0;
  if (features.webImageSearch >= 999) return lowSceneCount;
  return Math.min(features.webImageSearch, lowSceneCount);
}

export const BudgetSettingsSchema = z.object({
  mode: BudgetModeSchema.default("BALANCED"),
  features: BudgetFeaturesSchema.partial().optional(),
}).strict();
export type BudgetSettings = z.infer<typeof BudgetSettingsSchema>;

export const BudgetSettingsInputSchema = z.object({
  mode: BudgetModeSchema.optional(),
  features: BudgetFeaturesSchema.partial().optional(),
}).strict();
export type BudgetSettingsInput = z.infer<typeof BudgetSettingsInputSchema>;

const PRESETS: Record<Exclude<BudgetMode, "CUSTOM">, BudgetFeatures> = {
  ECO: {
    storyMode: "merged",
    repairAttempts: 0,
    scriptReview: false,
    scriptReviewPasses: 0,
    researchDepth: "light",
    altQueryAssist: false,
    sceneQueryAssist: false,
    semanticImageRerank: false,
    visionCheck: false,
    visionRetryRounds: 0,
    visionThreshold: 7,
    visualSearchBreadth: 8,
    renderVerify: false,
    factCheck: false,
    musicAssist: false,
    metadata: false,
    guidelineCheck: "off",
    webImageSearch: 0,
    outputHeadroom: 1,
  },
  BALANCED: {
    storyMode: "separate",
    repairAttempts: 1,
    scriptReview: true,
    scriptReviewPasses: 1,
    researchDepth: "standard",
    altQueryAssist: true,
    sceneQueryAssist: true,
    semanticImageRerank: true,
    visionCheck: false,
    visionRetryRounds: 0,
    visionThreshold: 7,
    visualSearchBreadth: 8,
    renderVerify: false,
    factCheck: false,
    musicAssist: true,
    metadata: true,
    guidelineCheck: "check",
    webImageSearch: 3,
    outputHeadroom: 1.5,
  },
  QUALITY: {
    storyMode: "separate",
    repairAttempts: 2,
    scriptReview: true,
    scriptReviewPasses: 2,
    researchDepth: "deep",
    altQueryAssist: true,
    sceneQueryAssist: true,
    semanticImageRerank: true,
    visionCheck: false,
    visionRetryRounds: 0,
    visionThreshold: 7,
    visualSearchBreadth: 8,
    renderVerify: false,
    factCheck: false,
    musicAssist: true,
    metadata: true,
    guidelineCheck: "checkAndFix",
    webImageSearch: 8,
    outputHeadroom: 2,
  },
  MAX: {
    storyMode: "separate",
    repairAttempts: 2,
    scriptReview: true,
    scriptReviewPasses: 2,
    researchDepth: "deep",
    altQueryAssist: true,
    sceneQueryAssist: true,
    semanticImageRerank: true,
    visionCheck: true,
    visionRetryRounds: 2,
    visionThreshold: 7,
    visualSearchBreadth: 16,
    renderVerify: true,
    factCheck: true,
    musicAssist: true,
    metadata: true,
    guidelineCheck: "checkAndFix",
    webImageSearch: 999,
    outputHeadroom: 2,
  },
};

type BudgetProject = {
  settings: {
    budget?: BudgetSettings;
  };
};

export function resolveBudget(
  modeOrProject: BudgetMode | BudgetSettings | BudgetProject,
  customOverrides?: Partial<BudgetFeatures>,
): BudgetFeatures {
  const budget = typeof modeOrProject === "string"
    ? { mode: modeOrProject, features: customOverrides }
    : "settings" in modeOrProject
      ? modeOrProject.settings.budget ?? { mode: "BALANCED" as const }
      : modeOrProject;
  const mode = budget.mode ?? "BALANCED";
  const defaults = mode === "CUSTOM" ? PRESETS.BALANCED : PRESETS[mode];
  const overrides = mode === "CUSTOM" ? budget.features ?? {} : {};
  const resolved = {
    ...defaults,
    ...overrides,
    ...(overrides.scriptReview !== undefined && overrides.scriptReviewPasses === undefined
      ? { scriptReviewPasses: overrides.scriptReview ? 1 : 0 }
      : {}),
  };
  resolved.scriptReview = resolved.scriptReviewPasses > 0;
  return BudgetFeaturesSchema.parse(resolved);
}

export function storyModeForProject(project: {
  settings: {
    budget?: BudgetSettings;
    researchMode?: "merged" | "separate" | "off";
    userSet?: string[];
  };
}): "merged" | "separate" | "off" {
  if (project.settings.userSet?.includes("researchMode") && project.settings.researchMode) {
    return project.settings.researchMode;
  }
  return resolveBudget(project).storyMode;
}

export type BudgetEstimateStage = {
  stage: "RESEARCH" | "SCRIPT" | "SCENE_PLAN" | "VISUAL_SEARCH" | "MUSIC_SEARCH" | "TIMELINE" | "RENDER";
  calls: { min: number; max: number };
  reason: string;
  tasks?: { task: string; provider?: string; model?: string; calls: { min: number; max: number } }[];
};

export type BudgetEstimate = {
  mode: BudgetMode;
  features: BudgetFeatures;
  perStage: BudgetEstimateStage[];
  total: { min: number; max: number };
  tokens?: { input: number; output: number };
  later?: string[];
};

export const BudgetEstimateSchema = z.object({
  mode: BudgetModeSchema,
  features: BudgetFeaturesSchema,
  perStage: z.array(z.object({
    stage: z.enum(["RESEARCH", "SCRIPT", "SCENE_PLAN", "VISUAL_SEARCH", "MUSIC_SEARCH", "TIMELINE", "RENDER"]),
    calls: z.object({ min: z.number().int().nonnegative(), max: z.number().int().nonnegative() }).strict(),
    reason: z.string(),
    tasks: z.array(z.object({
      task: z.string(),
      provider: z.string().optional(),
      model: z.string().optional(),
      calls: z.object({ min: z.number().int().nonnegative(), max: z.number().int().nonnegative() }).strict(),
    }).strict()).optional(),
  }).strict()),
  total: z.object({ min: z.number().int().nonnegative(), max: z.number().int().nonnegative() }).strict(),
  tokens: z.object({ input: z.number().int().nonnegative(), output: z.number().int().nonnegative() }).strict().optional(),
  later: z.array(z.string()).optional(),
}).strict();

export type BudgetEstimateInput = {
  topic: string;
  description?: string;
  settings: {
    budget?: BudgetSettings;
    language: string;
    targetDurationSec: number;
    wordsPerMinute: number;
    sceneDurationSec?: number;
    researchMode?: "merged" | "separate" | "off";
    userSet?: string[];
  };
};

/** Rough scene count for estimates when the plan is not known yet. */
export function estimateSceneCount(project: BudgetEstimateInput): number {
  const sceneDuration = project.settings.sceneDurationSec && project.settings.sceneDurationSec > 0
    ? project.settings.sceneDurationSec
    : 6;
  return Math.max(1, Math.ceil(project.settings.targetDurationSec / sceneDuration));
}

export function estimateBudget(
  project: BudgetEstimateInput,
  provider?: string | readonly string[] | Partial<Record<string, { provider?: string; model?: string } | null>>,
  stages: readonly { stage: string; state: string }[] = [],
): BudgetEstimate {
  const budget = project.settings.budget ?? { mode: "BALANCED" as const };
  const features = resolveBudget(budget);
  const mode = budget.mode ?? "BALANCED";
  const storyMode = storyModeForProject(project);
  const stateFor = (stage: BudgetEstimateStage["stage"]) =>
    stages.find((record) => record.stage === stage)?.state;
  const researchDone = stateFor("RESEARCH") === "DONE";
  const scriptDone = stateFor("SCRIPT") === "DONE";
  const repairs = features.repairAttempts;
  const sceneCount = estimateSceneCount(project);
  const imagesPerCall = 5;
  const perStage: BudgetEstimateStage[] = [];

  const researchCalls = storyMode === "off" || researchDone ? 0 : 1;
  perStage.push({
    stage: "RESEARCH",
    calls: { min: researchCalls, max: researchCalls * (1 + repairs) },
    reason: storyMode === "off"
      ? "Research is disabled; the script stage handles the topic."
      : researchDone ? "Research is already complete and unchanged."
        : storyMode === "merged" ? "Research and script are generated together."
          : "Research is generated separately.",
  });

  const visualSearchDone = stateFor("VISUAL_SEARCH") === "DONE";
  const visualAssistMax = !visualSearchDone && features.altQueryAssist ? 1 : 0;
  const rerankCalls = !visualSearchDone && features.semanticImageRerank ? 1 : 0;
  const visionPerScene = features.visionCheck && !visualSearchDone
    ? Math.ceil(5 / imagesPerCall)
    : 0;
  const visionMin = visionPerScene * sceneCount;
  const visionRetryMax = features.visionCheck && !visualSearchDone
    ? sceneCount * features.visionRetryRounds * (1 + visionPerScene)
    : 0;
  const visionResearchMax = features.visionCheck && !visualSearchDone
    ? sceneCount * features.visionRetryRounds
    : 0;
  const consistencyCalls = features.visionCheck && !visualSearchDone
    ? Math.max(1, Math.ceil(sceneCount / imagesPerCall))
    : 0;
  const webCapScenes = !visualSearchDone
    ? webImageSearchSceneCap(features, sceneCount)
    : 0;
  // Gemini grounding batches up to 5 scenes per call; Brave requests are not LLM calls.
  const webGroundingMax = webCapScenes > 0 ? Math.ceil(webCapScenes / imagesPerCall) : 0;
  const braveRequestMax = webCapScenes;
  const visualMin = rerankCalls + visionMin + (features.visionCheck && !visualSearchDone ? consistencyCalls : 0);
  const visualMax = visualAssistMax + rerankCalls + visionMin + visionRetryMax + visionResearchMax
    + consistencyCalls + webGroundingMax;
  const webReason = webCapScenes > 0
    ? ` Web image search: up to ${braveRequestMax} Brave request(s) and up to ${webGroundingMax} Gemini grounding call(s) for low-relevance scenes.`
    : "";
  perStage.push({
    stage: "VISUAL_SEARCH",
    calls: { min: visualMin, max: visualMax },
    reason: visualSearchDone
      ? "Visual search is already complete and unchanged."
      : features.visionCheck
        ? `Code ranks images; vision checks ~${sceneCount} scenes (batches of ${imagesPerCall}), optional re-search, and one consistency pass.${webReason}`
        : `Code ranks images; optional batched query assistance and semantic reranking use the selected budget features.${webReason}`,
  });

  const scriptBaseCalls = storyMode === "merged"
    ? 0
    : scriptDone ? 0 : 1;
  const reviewCalls = scriptDone ? 0 : features.scriptReviewPasses;
  const factCheckCalls = scriptDone || !features.factCheck ? 0 : 1;
  const guidelineMin = scriptDone || features.guidelineCheck === "off" ? 0 : 1;
  // checkAndFix: check, then one fix review and one re-check when the check finds problems.
  const guidelineMax = guidelineMin && features.guidelineCheck === "checkAndFix" ? 3 : guidelineMin;
  const scriptMin = scriptBaseCalls + reviewCalls + guidelineMin + factCheckCalls;
  const repairableCalls = scriptBaseCalls + reviewCalls + guidelineMax + factCheckCalls;
  perStage.push({
    stage: "SCRIPT",
    calls: { min: scriptMin, max: scriptMin + (guidelineMax - guidelineMin) + repairableCalls * repairs },
    reason: scriptDone
      ? "Script is already complete and unchanged."
      : features.scriptReview
        ? scriptBaseCalls
          ? `Script generation plus ${reviewCalls} review-and-revise call(s)${factCheckCalls ? " and a fact-check pass" : ""}.`
          : `${reviewCalls} review-and-revise call(s)${factCheckCalls ? " and a fact-check pass" : ""}.`
        : scriptBaseCalls ? "Script is generated from the research notes." : "The merged RESEARCH call already produced the script.",
  });

  const scenePlanDone = stateFor("SCENE_PLAN") === "DONE";
  const sceneAssistCalls = !scenePlanDone && features.sceneQueryAssist ? 1 : 0;
  perStage.push({
    stage: "SCENE_PLAN",
    calls: { min: sceneAssistCalls, max: sceneAssistCalls },
    reason: scenePlanDone
      ? "Scene plan is already complete and unchanged."
      : sceneAssistCalls
        ? "One batched query-assistance call generates a description and queries for every planned scene."
        : "Scene planning is deterministic and uses no LLM calls.",
  });

  // Metadata runs after TIMELINE success (not a separate pipeline stage); count it under TIMELINE.
  const musicSearchDone = stateFor("MUSIC_SEARCH") === "DONE";
  const musicAssistCalls = !musicSearchDone && features.musicAssist ? 1 : 0;
  perStage.push({
    stage: "MUSIC_SEARCH",
    calls: { min: musicAssistCalls, max: musicAssistCalls },
    reason: musicSearchDone
      ? "Music search is already complete and unchanged."
      : musicAssistCalls
        ? "One music-assist call suggests mood, energy and search queries."
        : "Music search uses the code query only.",
  });

  const timelineDone = stateFor("TIMELINE") === "DONE";
  const metadataCalls = !timelineDone && features.metadata ? 1 : 0;
  perStage.push({
    stage: "TIMELINE",
    calls: { min: metadataCalls, max: metadataCalls },
    reason: timelineDone
      ? "Timeline is already complete and unchanged."
      : metadataCalls
        ? "One metadata call drafts titles, description, tags and hashtags after the timeline."
        : "Publishing metadata uses a code draft only.",
  });

  const renderDone = stateFor("RENDER") === "DONE";
  const renderVisionCalls = !renderDone && features.renderVerify
    ? Math.max(1, Math.ceil(sceneCount / imagesPerCall))
    : 0;
  if (features.renderVerify || renderVisionCalls > 0) {
    perStage.push({
      stage: "RENDER",
      calls: { min: renderVisionCalls, max: renderVisionCalls },
      reason: renderDone
        ? "Render verification is already complete."
        : renderVisionCalls
          ? `Vision verifies mid-frame thumbnails in batches of ${imagesPerCall}.`
          : "Render verification is off.",
    });
  }

  const total = perStage.reduce((result, item) => ({
    min: result.min + item.calls.min,
    max: result.max + item.calls.max,
  }), { min: 0, max: 0 });

  const providers = typeof provider === "string" ? [provider] : provider ?? [];
  const routes = isRouteMap(provider) ? provider : undefined;
  const providerIds = Array.isArray(provider) ? provider : typeof provider === "string" ? [provider] : Object.values(routes ?? {}).flatMap((route) => route?.provider ? [route.provider] : []);
  const requestsOnly = providerIds.some((id) => id === "copilot-cli" || id === "claude-cli");
  const tokens = providerIds.length > 0 && !requestsOnly
    ? estimateBudgetTokens(project, perStage, storyMode, features, sceneCount)
    : undefined;
  const taskCalls: Record<string, { min: number; max: number }> = {
    research: { min: researchCalls, max: researchCalls * (1 + repairs) },
    script: { min: scriptBaseCalls, max: scriptBaseCalls * (1 + repairs) },
    scriptReview: { min: reviewCalls, max: reviewCalls * (1 + repairs) },
    factCheck: { min: factCheckCalls, max: factCheckCalls * (1 + repairs) },
    guidelineCheck: { min: guidelineMin, max: guidelineMax * (1 + repairs) },
    sceneQueries: { min: sceneAssistCalls, max: sceneAssistCalls },
    visualAltQueries: { min: 0, max: visualAssistMax },
    visualRerank: { min: rerankCalls, max: rerankCalls },
    visionCheck: {
      min: visionMin + (features.visionCheck && !visualSearchDone ? consistencyCalls : 0),
      max: visionMin + visionRetryMax + consistencyCalls,
    },
    visionResearch: { min: 0, max: visionResearchMax },
    visionConsistency: {
      min: features.visionCheck && !visualSearchDone ? consistencyCalls : 0,
      max: features.visionCheck && !visualSearchDone ? consistencyCalls : 0,
    },
    webImageGrounding: { min: 0, max: webGroundingMax },
    renderVision: { min: renderVisionCalls, max: renderVisionCalls },
    musicAssist: { min: musicAssistCalls, max: musicAssistCalls },
    metadata: { min: metadataCalls, max: metadataCalls },
  };
  for (const stage of perStage) {
    const taskIds = stage.stage === "RESEARCH" ? ["research"]
      : stage.stage === "SCRIPT" ? ["script", "scriptReview", "factCheck", "guidelineCheck"]
        : stage.stage === "SCENE_PLAN" ? ["sceneQueries"]
          : stage.stage === "MUSIC_SEARCH" ? ["musicAssist"]
            : stage.stage === "TIMELINE" ? ["metadata"]
              : stage.stage === "RENDER" ? ["renderVision"]
                : ["visualAltQueries", "visualRerank", "visionCheck", "visionResearch", "visionConsistency", "webImageGrounding"];
    stage.tasks = taskIds.map((task) => {
      const route = routes?.[task];
      return {
        task,
        ...(route?.provider ? { provider: route.provider } : {}),
        ...(route?.model ? { model: route.model } : {}),
        calls: taskCalls[task] ?? { min: 0, max: 0 },
      };
    });
  }
  return {
    mode,
    features,
    perStage,
    total,
    ...(tokens ? { tokens } : {}),
  };
}

function isRouteMap(
  value: string | readonly string[] | Partial<Record<string, { provider?: string; model?: string } | null>> | undefined,
): value is Partial<Record<string, { provider?: string; model?: string } | null>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function estimateBudgetTokens(
  project: BudgetEstimateInput,
  stages: BudgetEstimateStage[],
  storyMode: "merged" | "separate" | "off",
  features: BudgetFeatures,
  sceneCount: number,
): { input: number; output: number } {
  const text = [
    project.topic,
    project.description ?? "",
    project.settings.language,
    String(project.settings.targetDurationSec),
    String(project.settings.wordsPerMinute),
  ].join("\n");
  const calls = stages.reduce((total, stage) => total + stage.calls.max, 0);
  const perCallInput = estimateTextTokens(text, true);
  const scriptOutput = Math.ceil(
    project.settings.targetDurationSec / 60 * project.settings.wordsPerMinute
      * (project.settings.language.toLowerCase().startsWith("vi") ? 2.5 : 1.4) + 400,
  );
  const researchOutput = 900;
  const researchCalls = stages.find((stage) => stage.stage === "RESEARCH")?.calls.max ?? 0;
  const scriptCalls = stages.find((stage) => stage.stage === "SCRIPT")?.calls.max ?? 0;
  const scenePlanCalls = stages.find((stage) => stage.stage === "SCENE_PLAN")?.calls.max ?? 0;
  const visualSearchCalls = stages.find((stage) => stage.stage === "VISUAL_SEARCH")?.calls.max ?? 0;
  const musicSearchCalls = stages.find((stage) => stage.stage === "MUSIC_SEARCH")?.calls.max ?? 0;
  const timelineCalls = stages.find((stage) => stage.stage === "TIMELINE")?.calls.max ?? 0;
  const renderCalls = stages.find((stage) => stage.stage === "RENDER")?.calls.max ?? 0;
  // Each vision-bearing call attaches up to 5 images at ~1k tokens each (see VISION_IMAGE_TOKEN_ESTIMATE).
  const visionCallCount = (features.visionCheck ? visualSearchCalls : 0) + renderCalls;
  const visionInput = visionCallCount * 5 * VISION_IMAGE_TOKEN_ESTIMATE;
  void sceneCount;
  const output = researchCalls * (storyMode === "merged" ? scriptOutput + researchOutput : researchOutput)
    + scriptCalls * scriptOutput
    + scenePlanCalls * 500
    + visualSearchCalls * 500
    + musicSearchCalls * 200
    + timelineCalls * 400
    + renderCalls * 300;
  return { input: calls * perCallInput + visionInput, output };
}

export function estimateTextTokens(text: string, json = false): number {
  const charsPerToken = /[^\u0000-\u007f]/.test(text) ? 3 : 4;
  const estimate = Math.ceil(text.length / charsPerToken);
  return json ? Math.ceil(estimate * 1.15) : estimate;
}
