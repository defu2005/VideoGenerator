import { isGraphicKind } from "./graphicKind.js";
import type { ShotKind } from "./schema.js";

/**
 * Seconds for a 3 s shot, measured 2026-11-11 on an i5-13500H (RESEARCH-075).
 * Animated figures are opaque MP4, standard quality, no second encode.
 */
export const RENDER_COST_TABLE = {
  measuredOn: "2026-11-11",
  kineticAnimated: 17.1,
  chartAnimated: 17.0,
  kineticGrain: 22.2,
  chartGrain: 22.3,
  staticPng: 0.8,
  staticMotion: 1.2,
  still: 1.5,
  footage: 0.8,
  concat: 0.6,
} as const;

export type RenderCostTable = typeof RENDER_COST_TABLE;

export type EstimateShot = {
  kind: ShotKind;
  startSec: number;
  endSec: number;
  cached?: boolean;
};

export type EstimatePlan = {
  scenes: { shots: EstimateShot[] }[];
};

export type RenderGraphicsMode = {
  composeGraphics: "off" | "static" | "animated";
  graphicGrain?: boolean;
};

export type RenderTimeEstimate = {
  seconds: number;
  lowSec: number;
  highSec: number;
  measuredOn: string;
  textVi: string;
};

function clamp(value: number): number {
  return value > 0 ? value : 0;
}

function scaleAnimated(cost3: number, durationSec: number): number {
  return clamp(2.5 + (cost3 - 2.5) * durationSec / 3);
}

function scaleMedia(cost3: number, durationSec: number): number {
  return clamp(0.15 + (cost3 - 0.15) * durationSec / 3);
}

function scaleStatic(costs: RenderCostTable, durationSec: number): number {
  return clamp(costs.staticPng + 0.10 + (costs.staticMotion - 0.10) * durationSec / 3);
}

function shotSeconds(shot: EstimateShot, mode: RenderGraphicsMode, costs: RenderCostTable): number {
  if (shot.cached) return 0;
  const duration = Math.max(0, shot.endSec - shot.startSec);
  if (isGraphicKind(shot.kind)) {
    if (mode.composeGraphics === "off") return scaleMedia(costs.still, duration);
    if (mode.composeGraphics === "static") return scaleStatic(costs, duration);
    const grain = mode.graphicGrain === true;
    const cost3 = shot.kind === "kinetic_text"
      ? (grain ? costs.kineticGrain : costs.kineticAnimated)
      : (grain ? costs.chartGrain : costs.chartAnimated);
    return scaleAnimated(cost3, duration);
  }
  if (shot.kind === "footage") return scaleMedia(costs.footage, duration);
  return scaleMedia(costs.still, duration);
}

function minutesLabel(seconds: number): string {
  return (Math.round((seconds / 60) * 10) / 10).toFixed(1).replace(".", ",");
}

/** Vietnamese line for the render screen. A range, not a promise. */
export function formatRenderEstimate(lowSec: number, highSec: number): string {
  return `Ước tính: ~${minutesLabel(lowSec)}–${minutesLabel(highSec)} phút cho phần dựng cảnh. Không gồm giọng đọc, nhạc, phụ đề và lần ghép cuối.`;
}

/**
 * Compose-only render time. Cached shots cost 0. The range is ±40 % of the point estimate.
 * `perShotCosts` defaults to the 2026-11-11 table.
 */
export function estimateRenderSeconds(
  plan: EstimatePlan,
  mode: RenderGraphicsMode,
  perShotCosts: RenderCostTable = RENDER_COST_TABLE,
): RenderTimeEstimate {
  let videoSec = 0;
  let seconds = 0;
  for (const scene of plan.scenes) {
    for (const shot of scene.shots) {
      videoSec += Math.max(0, shot.endSec - shot.startSec);
      seconds += shotSeconds(shot, mode, perShotCosts);
    }
  }
  const concat = clamp(0.10 * plan.scenes.length + (perShotCosts.concat - 0.10) * videoSec / 3);
  seconds = clamp(seconds + concat);
  const lowSec = clamp(seconds * 0.6);
  const highSec = clamp(seconds * 1.4);
  return {
    seconds,
    lowSec,
    highSec,
    measuredOn: perShotCosts.measuredOn,
    textVi: formatRenderEstimate(lowSec, highSec),
  };
}
