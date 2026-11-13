import { z } from "zod";

export const PLANNED_TIMEOUT_STAGES = [
  "RESEARCH",
  "SCRIPT",
  "SCENE_PLAN",
  "VISUAL_SEARCH",
  "VOICE",
  "SUBTITLE",
  "MUSIC_SEARCH",
  "TIMELINE",
  "RENDER",
  "CLIP",
  "PUBLISH",
] as const;
export type PlannedTimeoutStage = (typeof PLANNED_TIMEOUT_STAGES)[number];

export const STAGE_TIMEOUT_FLOOR_MS = 60_000;
export const STAGE_TIMEOUT_CAP_MS = 1_800_000;
export const STAGE_TIMEOUT_LONG_CAP_MS = 7_200_000;

const LONG_CAP_STAGES = new Set<PlannedTimeoutStage>(["RENDER", "CLIP", "PUBLISH"]);

/** Reference ceilings at 120s, storytelling, youtube, 16:9, 150 wpm, 7s scenes. */
const REFERENCE_MS: Record<PlannedTimeoutStage, number> = {
  RESEARCH: 180_000,
  SCRIPT: 180_000,
  SCENE_PLAN: 120_000,
  VISUAL_SEARCH: 300_000,
  VOICE: 240_000,
  SUBTITLE: 90_000,
  MUSIC_SEARCH: 90_000,
  TIMELINE: 120_000,
  RENDER: 420_000,
  CLIP: 180_000,
  PUBLISH: 180_000,
};

const REFERENCE_SCENES = Math.ceil(120 / 7);

export const STAGE_TIMEOUT_LABELS_VI: Record<PlannedTimeoutStage, string> = {
  RESEARCH: "Nghiên cứu",
  SCRIPT: "Kịch bản",
  SCENE_PLAN: "Phân cảnh",
  VISUAL_SEARCH: "Tìm hình",
  VOICE: "Giọng đọc",
  SUBTITLE: "Phụ đề",
  MUSIC_SEARCH: "Nhạc",
  TIMELINE: "Timeline",
  RENDER: "Render",
  CLIP: "Clip",
  PUBLISH: "Đăng",
};

export interface StageTimeoutBrief {
  targetDurationSec: number;
  sceneDurationSec: number;
  wordsPerMinute: number;
  style: string;
  platform: string;
  aspectRatio: string;
}

export const STAGE_TIMEOUT_RETRY_GROWTH = 1.5;

export function retryStageTimeoutMs(stage: PlannedTimeoutStage, plannedMs: number, priorTimeouts: number): number {
  const grown = plannedMs * STAGE_TIMEOUT_RETRY_GROWTH ** Math.max(0, priorTimeouts);
  return Math.round(Math.min(stageTimeoutCapMs(stage), Math.max(0, grown)));
}

export function stageTimeoutCapMs(stage: PlannedTimeoutStage): number {
  return LONG_CAP_STAGES.has(stage) ? STAGE_TIMEOUT_LONG_CAP_MS : STAGE_TIMEOUT_CAP_MS;
}

export function isPlannedTimeoutStage(stage: string): stage is PlannedTimeoutStage {
  return (PLANNED_TIMEOUT_STAGES as readonly string[]).includes(stage);
}

export function clampStageTimeoutMs(stage: PlannedTimeoutStage, ms: number): number {
  return Math.round(Math.min(stageTimeoutCapMs(stage), Math.max(STAGE_TIMEOUT_FLOOR_MS, ms)));
}

export function baselineStageTimeouts(input: StageTimeoutBrief): Record<PlannedTimeoutStage, number> {
  const sceneDuration = input.sceneDurationSec > 0 ? input.sceneDurationSec : 7;
  const scenes = Math.max(1, Math.ceil(input.targetDurationSec / sceneDuration));
  const short = input.targetDurationSec <= 60
    || input.platform === "youtube_shorts"
    || input.platform === "tiktok"
    || input.platform === "facebook_reels";
  const factor = short ? Math.min(0.5, input.targetDurationSec / 120) : input.targetDurationSec / 120;
  const sceneExtra = Math.max(0, scenes - REFERENCE_SCENES);
  const wpmBoost = input.wordsPerMinute < 150 ? 1 + (150 - input.wordsPerMinute) / 600 : 1;
  const researchStyle = input.style === "documentary" || input.style === "news"
    ? 1.35
    : input.style === "explainer" || input.style === "listicle"
      ? 0.8
      : 1;
  const visualStyle = input.style === "listicle" ? 1.25 : 1;
  const renderAspect = input.aspectRatio === "9:16" ? 1.08 : 1;
  const result = {} as Record<PlannedTimeoutStage, number>;
  for (const stage of PLANNED_TIMEOUT_STAGES) {
    let ms = REFERENCE_MS[stage] * factor;
    if (!short) {
      if (stage === "VISUAL_SEARCH") ms += sceneExtra * 8_000;
      if (stage === "SCENE_PLAN") ms += sceneExtra * 2_000;
      if (stage === "RENDER") ms += sceneExtra * 5_000;
    }
    if (stage === "RESEARCH") ms *= researchStyle;
    if (stage === "VISUAL_SEARCH") ms *= visualStyle;
    if (stage === "SCRIPT" || stage === "VOICE") ms *= wpmBoost;
    if (stage === "RENDER") ms *= renderAspect;
    result[stage] = clampStageTimeoutMs(stage, ms);
  }
  return result;
}

export function stageTimeoutInputHash(
  input: StageTimeoutBrief & { topic: string; budgetMode: string; historyBucket?: string },
): string {
  const payload = JSON.stringify({
    ...(input.historyBucket ? { historyBucket: input.historyBucket } : {}),
    topic: input.topic,
    budgetMode: input.budgetMode,
    targetDurationSec: input.targetDurationSec,
    sceneDurationSec: input.sceneDurationSec,
    wordsPerMinute: input.wordsPerMinute,
    style: input.style,
    platform: input.platform,
    aspectRatio: input.aspectRatio,
  });
  let hash = 0;
  for (const char of payload) hash = Math.imul(31, hash) + char.codePointAt(0)! | 0;
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export const StageTimeoutBasisSchema = z.enum(["history", "agent", "rough", "baseline", "user"]);
export type StageTimeoutBasis = z.infer<typeof StageTimeoutBasisSchema>;

export const StageTimeoutEntrySchema = z.object({
  timeoutMs: z.number().int().positive(),
  reason: z.string(),
  source: z.enum(["llm", "baseline", "user", "history"]),
  /** TASK-125: the time a stage normally takes; the limit is `timeoutMs`. */
  expectedMs: z.number().int().positive().optional(),
  basis: StageTimeoutBasisSchema.optional(),
}).strict();

export const StageTimeoutPlanSchema = z.object({
  source: z.enum(["llm", "baseline", "mixed"]),
  inputHash: z.string(),
  summary: z.string(),
  stages: z.record(z.string(), StageTimeoutEntrySchema),
}).strict();
export type StageTimeoutPlan = z.infer<typeof StageTimeoutPlanSchema>;

export const StageTimeoutsModelSchema = z.object({
  stages: z.array(z.object({
    stage: z.string(),
    timeoutSec: z.number(),
    reason: z.string(),
  }).strict()),
  summary: z.string(),
}).strict();

export function timeoutBriefFromSettings(settings: {
  targetDurationSec?: number;
  sceneDurationSec?: number;
  wordsPerMinute?: number;
  style?: string;
  platform?: string;
  aspectRatio?: string;
  budget?: { mode?: string };
}, topic: string): StageTimeoutBrief & { topic: string; budgetMode: string } {
  return {
    topic,
    budgetMode: settings.budget?.mode ?? "BALANCED",
    targetDurationSec: settings.targetDurationSec ?? 120,
    sceneDurationSec: settings.sceneDurationSec ?? 7,
    wordsPerMinute: settings.wordsPerMinute ?? 150,
    style: settings.style ?? "storytelling",
    platform: settings.platform ?? "youtube",
    aspectRatio: settings.aspectRatio ?? "16:9",
  };
}

export function planFromBaseline(
  brief: StageTimeoutBrief & { topic: string; budgetMode: string },
  previous?: StageTimeoutPlan | null,
): StageTimeoutPlan {
  const baseline = baselineStageTimeouts(brief);
  const stages: StageTimeoutPlan["stages"] = {};
  for (const stage of PLANNED_TIMEOUT_STAGES) {
    const kept = previous?.stages[stage];
    if (kept?.source === "user") {
      stages[stage] = kept;
      continue;
    }
    stages[stage] = {
      timeoutMs: baseline[stage],
      reason: "Ước lượng theo thời lượng và phong cách.",
      source: "baseline",
    };
  }
  return {
    source: Object.values(stages).some((entry) => entry.source === "user") ? "mixed" : "baseline",
    inputHash: stageTimeoutInputHash(brief),
    summary: "Ước lượng theo brief, không gọi AI.",
    stages,
  };
}

export function planFromModel(
  brief: StageTimeoutBrief & { topic: string; budgetMode: string },
  model: { stages: { stage: string; timeoutSec: number; reason: string }[]; summary: string },
  previous?: StageTimeoutPlan | null,
): StageTimeoutPlan {
  const baseline = baselineStageTimeouts(brief);
  const stages: StageTimeoutPlan["stages"] = {};
  let mixed = false;
  const incoming = new Map(model.stages.map((item) => [item.stage, item]));
  for (const stage of PLANNED_TIMEOUT_STAGES) {
    const kept = previous?.stages[stage];
    if (kept?.source === "user") {
      stages[stage] = kept;
      mixed = true;
      continue;
    }
    const row = incoming.get(stage);
    if (!row || !Number.isFinite(row.timeoutSec)) {
      stages[stage] = { timeoutMs: baseline[stage], reason: "Giữ ước lượng vì AI không trả bước này.", source: "baseline" };
      mixed = true;
      continue;
    }
    const requested = Math.round(row.timeoutSec * 1000);
    const timeoutMs = clampStageTimeoutMs(stage, requested);
    if (timeoutMs !== requested) mixed = true;
    stages[stage] = { timeoutMs, reason: row.reason.slice(0, 240) || "AI chọn.", source: "llm" };
  }
  return {
    source: mixed ? "mixed" : "llm",
    inputHash: stageTimeoutInputHash(brief),
    summary: model.summary.slice(0, 400) || "AI chọn thời gian tối đa mỗi bước.",
    stages,
  };
}

export function resolveStageTimeoutMs(
  settings: { stageTimeouts?: StageTimeoutPlan | null } & StageTimeoutBrief,
  stage: string,
  fallbackMs: number,
): number {
  const planned = settings.stageTimeouts?.stages?.[stage]?.timeoutMs;
  if (planned && planned > 0) return planned;
  if (!isPlannedTimeoutStage(stage)) return fallbackMs;
  return baselineStageTimeouts(settings)[stage];
}

export function stageTimeoutPlanIsFresh(
  settings: { stageTimeouts?: StageTimeoutPlan | null },
  hash: string,
): boolean {
  return Boolean(settings.stageTimeouts && settings.stageTimeouts.inputHash === hash);
}
