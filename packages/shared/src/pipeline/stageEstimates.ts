import { z } from "zod";
import {
  PLANNED_TIMEOUT_STAGES,
  STAGE_TIMEOUT_LABELS_VI,
  baselineStageTimeouts,
  clampStageTimeoutMs,
  stageTimeoutInputHash,
  type PlannedTimeoutStage,
  type StageTimeoutBrief,
  type StageTimeoutPlan,
} from "./stageTimeouts.js";

/**
 * TASK-125. Estimate how long a stage takes from the runs that really happened on this install.
 * Pure: the server loads the history, this file only does the arithmetic. Code answers when it is
 * confident; otherwise `confidence` is "low" and an agent picks the numbers (see stageTimeoutPlan).
 */

/** One past successful run of a stage (duration of the final successful attempt). */
export interface StageRun {
  stage: string;
  durationMs: number;
  scenes: number;
  targetSec: number;
  budgetMode: string | null;
  aspectRatio: string | null;
  /** null = the main machine. */
  nodeId: string | null;
  provider?: string | null;
  finishedAt: string;
}

export interface StageEstimateBrief extends StageTimeoutBrief {
  budgetMode: string;
  nodeId?: string | null;
  provider?: string | null;
}

export type StageEstimateBasis = "history" | "blend" | "baseline";

export interface StageEstimate {
  expectedMs: number;
  limitMs: number;
  samples: number;
  basis: StageEstimateBasis;
  confidence: "high" | "low";
  lowReasons: string[];
  explanation: string;
  /** For the agent prompt: spread of the rates it was built from. */
  medianRateMs: number | null;
  p90RateMs: number | null;
  /** Unit label, e.g. "cảnh", "giây video", "lần". */
  unitLabel: string;
  units: number;
}

export const ESTIMATE_RECENT_RUNS = 30;
export const ESTIMATE_MIN_SAMPLES = 5;
export const ESTIMATE_HIGH_MIN_SAMPLES = 8;
export const ESTIMATE_MAX_SPREAD = 2.5;
export const ESTIMATE_RANGE_FACTOR = 1.5;
export const ESTIMATE_LIMIT_FACTOR = 1.3;

type UnitKind = "scene" | "second" | "run";

const UNIT_OF: Partial<Record<PlannedTimeoutStage, UnitKind>> = {
  VISUAL_SEARCH: "scene",
  SCENE_PLAN: "scene",
  RENDER: "scene",
  VOICE: "second",
  SCRIPT: "second",
};

const UNIT_LABEL: Record<UnitKind, string> = { scene: "cảnh", second: "giây video", run: "lần chạy" };

export function stageUnitKind(stage: string): UnitKind {
  return UNIT_OF[stage as PlannedTimeoutStage] ?? "run";
}

function briefScenes(brief: StageTimeoutBrief): number {
  const sceneDuration = brief.sceneDurationSec > 0 ? brief.sceneDurationSec : 7;
  return Math.max(1, Math.ceil(brief.targetDurationSec / sceneDuration));
}

export function stageUnits(stage: string, scenes: number, targetSec: number): number {
  const kind = stageUnitKind(stage);
  if (kind === "scene") return Math.max(1, scenes);
  if (kind === "second") return Math.max(1, targetSec);
  return 1;
}

/** Linear-interpolated percentile of an ascending-sorted list. */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const pos = Math.min(1, Math.max(0, p)) * (sorted.length - 1);
  const lower = Math.floor(pos);
  const upper = Math.ceil(pos);
  const frac = pos - lower;
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * frac;
}

function ms(value: number): string {
  if (value >= 90_000) return `${Math.round(value / 60_000)} phút`;
  return `${Math.max(1, Math.round(value / 1000))} giây`;
}

/** Bucket the history the plan depends on, so a stored plan refreshes as the data grows. */
export function historyBucket(estimates: Partial<Record<string, Pick<StageEstimate, "samples" | "confidence">>>): string {
  return PLANNED_TIMEOUT_STAGES.map((stage) => {
    const e = estimates[stage];
    if (!e) return "0";
    return `${Math.floor(e.samples / 5) * 5}${e.confidence === "high" ? "h" : "l"}`;
  }).join(",");
}

export function estimateStageMs(
  history: readonly StageRun[],
  brief: StageEstimateBrief,
  stage: PlannedTimeoutStage,
): StageEstimate {
  const unitKind = stageUnitKind(stage);
  const unitLabel = UNIT_LABEL[unitKind];
  const scenes = briefScenes(brief);
  const units = stageUnits(stage, scenes, brief.targetDurationSec);
  const label = STAGE_TIMEOUT_LABELS_VI[stage];
  const baselineLimit = baselineStageTimeouts(brief)[stage];
  const baselineExpected = clampStageTimeoutMs(stage, baselineLimit / 2);
  const node = brief.nodeId ?? null;

  const recent = history
    .filter((run) => run.stage === stage && Number.isFinite(run.durationMs) && run.durationMs > 0)
    .sort((a, b) => (a.finishedAt < b.finishedAt ? 1 : a.finishedAt > b.finishedAt ? -1 : 0))
    .slice(0, ESTIMATE_RECENT_RUNS);
  const matching = recent.filter((run) => run.budgetMode === brief.budgetMode && (run.nodeId ?? null) === node);
  const used = matching.length >= ESTIMATE_MIN_SAMPLES ? matching : recent;
  const samples = used.length;

  const lowReasons: string[] = [];
  const rateOf = (run: StageRun) => run.durationMs / stageUnits(stage, run.scenes, run.targetSec);

  if (samples === 0) {
    lowReasons.push("chưa có lần chạy nào để so sánh");
    return {
      expectedMs: baselineExpected,
      limitMs: clampStageTimeoutMs(stage, baselineLimit),
      samples: 0,
      basis: "baseline",
      confidence: "low",
      lowReasons,
      explanation: `Chưa có lịch sử bước ${label} trên máy này, dùng ước lượng theo thời lượng và phong cách.`,
      medianRateMs: null,
      p90RateMs: null,
      unitLabel,
      units,
    };
  }

  const rates = used.map(rateOf).sort((a, b) => a - b);
  const median = percentile(rates, 0.5);
  const p90 = percentile(rates, 0.9);
  const histExpected = median * units;
  const histLimit = Math.max(p90 * units * ESTIMATE_LIMIT_FACTOR, histExpected * 1.2);

  let expectedMs: number;
  let limitMs: number;
  let basis: StageEstimateBasis;
  if (samples >= ESTIMATE_MIN_SAMPLES) {
    expectedMs = histExpected;
    limitMs = histLimit;
    basis = "history";
  } else {
    const weight = samples / ESTIMATE_MIN_SAMPLES;
    expectedMs = weight * histExpected + (1 - weight) * baselineExpected;
    limitMs = weight * histLimit + (1 - weight) * baselineLimit;
    basis = "blend";
  }
  expectedMs = clampStageTimeoutMs(stage, expectedMs);
  limitMs = Math.max(clampStageTimeoutMs(stage, limitMs), expectedMs);

  if (matching.length < ESTIMATE_HIGH_MIN_SAMPLES) {
    lowReasons.push(matching.length === samples || matching.length === 0
      ? `chỉ có ${samples} lần chạy`
      : `chỉ có ${matching.length} lần chạy cùng chế độ và máy`);
  }
  if (matching.length >= ESTIMATE_MIN_SAMPLES) {
    const mRates = matching.map(rateOf).sort((a, b) => a - b);
    const mMedian = percentile(mRates, 0.5);
    const mP90 = percentile(mRates, 0.9);
    if (mMedian > 0 && mP90 > ESTIMATE_MAX_SPREAD * mMedian) lowReasons.push("độ lệch lớn giữa các lần chạy");
    const maxUnits = Math.max(...matching.map((run) => stageUnits(stage, run.scenes, run.targetSec)));
    if (units > ESTIMATE_RANGE_FACTOR * maxUnits) lowReasons.push("brief lớn hơn mọi lần đã chạy");
    if (brief.aspectRatio && !matching.some((run) => run.aspectRatio === brief.aspectRatio)) {
      lowReasons.push(`lần đầu chạy tỉ lệ ${brief.aspectRatio}`);
    }
    if (brief.provider && !matching.some((run) => run.provider === brief.provider)) {
      lowReasons.push(`lần đầu chạy với ${brief.provider}`);
    }
  }
  if (node && !recent.some((run) => (run.nodeId ?? null) === node)) lowReasons.push(`lần đầu chạy trên node ${node}`);

  const confidence: "high" | "low" = lowReasons.length === 0 && basis === "history" ? "high" : "low";
  const explanation = basis === "history"
    ? `Dựa trên ${samples} lần ${label} gần đây trên máy này: trung bình ${ms(median)}/${unitLabel}, dự kiến ${ms(expectedMs)}.`
    : `Mới có ${samples} lần ${label}, trộn với ước lượng theo brief (dự kiến ${ms(expectedMs)}).`;
  return {
    expectedMs,
    limitMs,
    samples,
    basis,
    confidence,
    lowReasons,
    explanation,
    medianRateMs: median,
    p90RateMs: p90,
    unitLabel,
    units,
  };
}

/** What the agent returns for the low-confidence stages (one call per project plan). */
export const StageEstimateAgentSchema = z.object({
  stages: z.array(z.object({
    stage: z.string(),
    timeoutSec: z.number(),
    expectedSec: z.number().optional(),
    reason: z.string(),
  }).strict()),
  summary: z.string(),
}).strict();
export type StageEstimateAgentAnswer = z.infer<typeof StageEstimateAgentSchema>;

/**
 * Plan order: a user override wins; a high-confidence history estimate is used as is (no LLM);
 * a low-confidence stage takes the agent's numbers (clamped) with its reason; if there is no agent
 * answer the code estimate stays and is marked "rough".
 */
export function planFromEstimates(
  brief: StageEstimateBrief & { topic: string },
  estimates: Record<PlannedTimeoutStage, StageEstimate>,
  previous: StageTimeoutPlan | null | undefined,
  agent: StageEstimateAgentAnswer | null,
): StageTimeoutPlan {
  const incoming = new Map((agent?.stages ?? []).map((row) => [row.stage, row]));
  const stages: StageTimeoutPlan["stages"] = {};
  const seen = new Set<string>();
  for (const stage of PLANNED_TIMEOUT_STAGES) {
    const kept = previous?.stages[stage];
    if (kept?.source === "user") {
      stages[stage] = kept;
      seen.add("user");
      continue;
    }
    const estimate = estimates[stage];
    if (estimate.confidence === "high") {
      stages[stage] = {
        timeoutMs: estimate.limitMs,
        expectedMs: estimate.expectedMs,
        reason: estimate.explanation,
        source: "history",
        basis: "history",
      };
      seen.add("history");
      continue;
    }
    const row = incoming.get(stage);
    if (row && Number.isFinite(row.timeoutSec) && row.timeoutSec > 0) {
      const timeoutMs = clampStageTimeoutMs(stage, row.timeoutSec * 1000);
      const wanted = row.expectedSec && Number.isFinite(row.expectedSec) && row.expectedSec > 0
        ? row.expectedSec * 1000
        : timeoutMs / 2;
      const expectedMs = Math.min(timeoutMs, clampStageTimeoutMs(stage, wanted));
      stages[stage] = {
        timeoutMs,
        expectedMs,
        reason: row.reason.slice(0, 240) || "Agent ước lượng.",
        source: "llm",
        basis: "agent",
      };
      seen.add("agent");
      continue;
    }
    stages[stage] = {
      timeoutMs: estimate.limitMs,
      expectedMs: estimate.expectedMs,
      reason: `${estimate.explanation} (ước lượng thô)`,
      source: "baseline",
      basis: "rough",
    };
    seen.add("rough");
  }
  const source: StageTimeoutPlan["source"] = seen.has("agent") && seen.size === 1
    ? "llm"
    : seen.has("agent") || seen.has("user") ? "mixed" : "baseline";
  return {
    source,
    inputHash: stageTimeoutInputHash({ ...brief, historyBucket: historyBucket(estimates) }),
    summary: agent?.summary?.slice(0, 400)
      || (seen.has("history") ? "Một phần ước lượng từ lịch sử chạy thật." : "Ước lượng theo brief, không gọi AI."),
    stages,
  };
}
