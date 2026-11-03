import { z } from "zod";

export const BudgetModeSchema = z.enum(["ECO", "BALANCED", "QUALITY", "CUSTOM"]);
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
  musicAssist: z.boolean(),
  metadata: z.boolean(),
  outputHeadroom: z.union([z.literal(1), z.literal(1.5), z.literal(2)]),
}).strict();
export type BudgetFeatures = z.infer<typeof BudgetFeaturesSchema>;

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
    musicAssist: false,
    metadata: false,
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
    musicAssist: true,
    metadata: true,
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
    musicAssist: true,
    metadata: true,
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
  stage: "RESEARCH" | "SCRIPT" | "SCENE_PLAN" | "VISUAL_SEARCH";
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
    stage: z.enum(["RESEARCH", "SCRIPT", "SCENE_PLAN", "VISUAL_SEARCH"]),
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
    researchMode?: "merged" | "separate" | "off";
    userSet?: string[];
  };
};

export function estimateBudget(
  project: BudgetEstimateInput,
  provider?: string | readonly string[] | Partial<Record<string, { provider?: string; model?: string } | null>>,
  stages: readonly { stage: string; state: string }[] = [],
): BudgetEstimate {
  const budget = project.settings.budget ?? { mode: "BALANCED" as const };
  const features = resolveBudget(budget);
  const mode = budget.mode ?? "BALANCED";
  const storyMode = storyModeForProject(project);
  const stateFor = (stage: "RESEARCH" | "SCRIPT" | "SCENE_PLAN" | "VISUAL_SEARCH") =>
    stages.find((record) => record.stage === stage)?.state;
  const researchDone = stateFor("RESEARCH") === "DONE";
  const scriptDone = stateFor("SCRIPT") === "DONE";
  const repairs = features.repairAttempts;
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
  perStage.push({
    stage: "VISUAL_SEARCH",
    calls: { min: rerankCalls, max: visualAssistMax + rerankCalls },
    reason: visualSearchDone
      ? "Visual search is already complete and unchanged."
      : "Code ranks images; optional batched query assistance and semantic reranking use the selected budget features.",
  });

  const scriptBaseCalls = storyMode === "merged"
    ? 0
    : scriptDone ? 0 : 1;
  const reviewCalls = scriptDone ? 0 : features.scriptReviewPasses;
  const scriptMin = scriptBaseCalls + reviewCalls;
  const repairableCalls = scriptBaseCalls + reviewCalls;
  perStage.push({
    stage: "SCRIPT",
    calls: { min: scriptMin, max: scriptMin + repairableCalls * repairs },
    reason: scriptDone
      ? "Script is already complete and unchanged."
      : features.scriptReview
        ? scriptBaseCalls ? `Script generation plus ${reviewCalls} review-and-revise call(s).` : `${reviewCalls} review-and-revise call(s).`
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

  const total = perStage.reduce((result, item) => ({
    min: result.min + item.calls.min,
    max: result.max + item.calls.max,
  }), { min: 0, max: 0 });

  const providers = typeof provider === "string" ? [provider] : provider ?? [];
  const routes = isRouteMap(provider) ? provider : undefined;
  const providerIds = Array.isArray(provider) ? provider : typeof provider === "string" ? [provider] : Object.values(routes ?? {}).flatMap((route) => route?.provider ? [route.provider] : []);
  const requestsOnly = providerIds.some((id) => id === "copilot-cli" || id === "claude-cli");
  const tokens = providerIds.length > 0 && !requestsOnly
    ? estimateBudgetTokens(project, perStage, storyMode)
    : undefined;
  const taskCalls: Record<string, { min: number; max: number }> = {
    research: { min: researchCalls, max: researchCalls * (1 + repairs) },
    script: { min: scriptBaseCalls, max: scriptBaseCalls * (1 + repairs) },
    scriptReview: { min: reviewCalls, max: reviewCalls * (1 + repairs) },
    sceneQueries: { min: sceneAssistCalls, max: sceneAssistCalls },
    visualAltQueries: { min: 0, max: visualAssistMax },
    visualRerank: { min: rerankCalls, max: rerankCalls },
  };
  for (const stage of perStage) {
    const taskIds = stage.stage === "RESEARCH" ? ["research"]
      : stage.stage === "SCRIPT" ? ["script", "scriptReview"]
        : stage.stage === "SCENE_PLAN" ? ["sceneQueries"]
          : ["visualAltQueries", "visualRerank"];
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
    later: ["visionCheck", "musicAssist", "metadata"],
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
  const output = researchCalls * (storyMode === "merged" ? scriptOutput + researchOutput : researchOutput)
    + scriptCalls * scriptOutput
    + scenePlanCalls * 500
    + visualSearchCalls * 500;
  return { input: calls * perCallInput, output };
}

function estimateTextTokens(text: string, json = false): number {
  const charsPerToken = /[^\u0000-\u007f]/.test(text) ? 3 : 4;
  const estimate = Math.ceil(text.length / charsPerToken);
  return json ? Math.ceil(estimate * 1.15) : estimate;
}
