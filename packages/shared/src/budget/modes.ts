import { z } from "zod";

export const BudgetModeSchema = z.enum(["ECO", "BALANCED", "QUALITY", "CUSTOM"]);
export type BudgetMode = z.infer<typeof BudgetModeSchema>;

export const BudgetFeaturesSchema = z.object({
  storyMode: z.enum(["merged", "separate"]),
  repairAttempts: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  scriptReview: z.boolean(),
  altQueryAssist: z.boolean(),
  sceneQueryAssist: z.boolean(),
  semanticImageRerank: z.boolean(),
  visionCheck: z.boolean(),
  musicAssist: z.boolean(),
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
    altQueryAssist: false,
    sceneQueryAssist: false,
    semanticImageRerank: false,
    visionCheck: false,
    musicAssist: false,
  },
  BALANCED: {
    storyMode: "separate",
    repairAttempts: 1,
    scriptReview: false,
    altQueryAssist: true,
    sceneQueryAssist: false,
    semanticImageRerank: false,
    visionCheck: false,
    musicAssist: false,
  },
  QUALITY: {
    storyMode: "separate",
    repairAttempts: 1,
    scriptReview: true,
    altQueryAssist: true,
    sceneQueryAssist: true,
    semanticImageRerank: true,
    visionCheck: false,
    musicAssist: true,
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
  return BudgetFeaturesSchema.parse({
    ...defaults,
    ...(mode === "CUSTOM" ? budget.features : {}),
  });
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
};

export type BudgetEstimate = {
  mode: BudgetMode;
  features: BudgetFeatures;
  perStage: BudgetEstimateStage[];
  total: { min: number; max: number };
  tokens?: { input: number; output: number };
};

export const BudgetEstimateSchema = z.object({
  mode: BudgetModeSchema,
  features: BudgetFeaturesSchema,
  perStage: z.array(z.object({
    stage: z.enum(["RESEARCH", "SCRIPT", "SCENE_PLAN", "VISUAL_SEARCH"]),
    calls: z.object({ min: z.number().int().nonnegative(), max: z.number().int().nonnegative() }).strict(),
    reason: z.string(),
  }).strict()),
  total: z.object({ min: z.number().int().nonnegative(), max: z.number().int().nonnegative() }).strict(),
  tokens: z.object({ input: z.number().int().nonnegative(), output: z.number().int().nonnegative() }).strict().optional(),
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
  provider?: string | readonly string[],
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
  const reviewCalls = features.scriptReview && !scriptDone ? 1 : 0;
  const scriptMin = scriptBaseCalls + reviewCalls;
  const repairableCalls = scriptBaseCalls + reviewCalls;
  perStage.push({
    stage: "SCRIPT",
    calls: { min: scriptMin, max: scriptMin + repairableCalls * repairs },
    reason: scriptDone
      ? "Script is already complete and unchanged."
      : features.scriptReview
        ? scriptBaseCalls ? "Script generation plus one review-and-revise call." : "One review-and-revise call."
        : scriptBaseCalls ? "Script is generated from the research notes." : "The merged RESEARCH call already produced the script.",
  });

  const scenePlanDone = stateFor("SCENE_PLAN") === "DONE";
  const sceneAssistMax = !scenePlanDone && features.sceneQueryAssist ? 1 : 0;
  perStage.push({
    stage: "SCENE_PLAN",
    calls: { min: 0, max: sceneAssistMax },
    reason: scenePlanDone
      ? "Scene plan is already complete and unchanged."
      : sceneAssistMax
        ? "One batched query-assistance call is used only when a unit has multiple scenes."
        : "Scene planning is deterministic and uses no LLM calls.",
  });

  const total = perStage.reduce((result, item) => ({
    min: result.min + item.calls.min,
    max: result.max + item.calls.max,
  }), { min: 0, max: 0 });

  const providers = typeof provider === "string" ? [provider] : provider ?? [];
  const requestsOnly = providers.some((id) => id === "copilot-cli" || id === "claude-cli");
  const tokens = providers.length > 0 && !requestsOnly
    ? estimateBudgetTokens(project, perStage, storyMode)
    : undefined;
  return { mode, features, perStage, total, ...(tokens ? { tokens } : {}) };
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
