import { MIN_SHOT_SEC } from "./schema.js";
import type { AspectRatio } from "../enums.js";
import type { EditPresetId } from "../edit/plan.js";
import type { Cut } from "./words.js";

export type PaceBand = { target: number; min: number; max: number };

const BANDS: Record<EditPresetId, PaceBand> = {
  calm: { target: 5, min: 3, max: 8 },
  story: { target: 3.5, min: 2, max: 6 },
  news: { target: 3, min: 1.8, max: 5 },
  energetic: { target: 2, min: 1.2, max: 3.5 },
};

export function paceBand(preset: EditPresetId, aspect: AspectRatio): PaceBand {
  const band = BANDS[preset];
  const scale = aspect === "9:16" ? 0.8 : 1;
  return { target: band.target * scale, min: band.min * scale, max: band.max * scale };
}

export function paceSpan(input: {
  startSec: number;
  endSec: number;
  cuts: Cut[];
  beatsSec: number[];
  band: PaceBand;
  guardSec: number;
  sceneStartSec?: number;
  sceneEndSec?: number;
}): number[] {
  const span = input.endSec - input.startSec;
  if (span < input.band.min) return [];
  const sceneStart = input.sceneStartSec ?? 0;
  const sceneEnd = input.sceneEndSec ?? input.endSec;
  const allowed = input.cuts
    .filter((cut) => cut.t > input.startSec + 1e-6 && cut.t < input.endSec - 1e-6)
    .filter((cut) => cut.t >= sceneStart + input.guardSec && cut.t <= sceneEnd - input.guardSec)
    .sort((a, b) => a.t - b.t);
  const points = [boundary(input.startSec), ...allowed, boundary(input.endSec)];
  const count = points.length;
  const best = Array<number>(count).fill(Number.POSITIVE_INFINITY);
  const prev = Array<number>(count).fill(-1);
  best[0] = 0;
  for (let right = 1; right < count; right += 1) {
    for (let left = 0; left < right; left += 1) {
      if (!Number.isFinite(best[left])) continue;
      const cost = best[left]! + segmentCost(points[left]!.t, points[right]!.t, input.band) + (right === count - 1 ? 0 : cutCost(points[right]!, input.beatsSec));
      if (cost < best[right]!) {
        best[right] = cost;
        prev[right] = left;
      }
    }
  }
  if (!Number.isFinite(best[count - 1]) || best[count - 1]! >= 1e6) return [];
  const chosen: number[] = [];
  let cursor = count - 1;
  while (prev[cursor] !== undefined && prev[cursor]! > 0) {
    cursor = prev[cursor]!;
    chosen.push(points[cursor]!.t);
  }
  return chosen.sort((a, b) => a - b);
}

function boundary(t: number): Cut {
  return { t, gapSec: 0, sentenceEnd: false, punct: false };
}

function segmentCost(start: number, end: number, band: PaceBand): number {
  const len = end - start;
  if (len < Math.max(band.min, MIN_SHOT_SEC) || len > band.max) return 1e6;
  const ratio = (len - band.target) / band.target;
  return ratio * ratio;
}

function cutCost(cut: Cut, beatsSec: number[]): number {
  let cost = 0;
  if (!cut.punct && cut.gapSec < 0.12) cost += 0.6;
  if (cut.sentenceEnd) cost -= 0.3;
  if (beatsSec.some((beat) => Math.abs(beat - cut.t) <= 0.12)) cost -= 0.25;
  return cost;
}
