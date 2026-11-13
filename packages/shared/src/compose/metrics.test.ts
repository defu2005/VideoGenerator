import { describe, expect, it } from "vitest";
import { computeStats } from "./metrics.js";
import type { ScenePlan } from "./schema.js";
import type { SceneWord } from "./words.js";

function shot(id: string, kind: "still" | "footage", start: number, end: number): ScenePlan["shots"][number] {
  return {
    id,
    kind,
    startSec: start,
    endSec: end,
    reason: "test",
    source: kind === "still"
      ? { kind: "still", candidateId: null, path: null, motion: "static" }
      : { kind: "footage", clipId: "c", path: null, inSec: 0, license: { provider: "pexels", clipId: "c", author: "A", licenseName: "Pexels License", pageUrl: "https://www.pexels.com/video/c" } },
  };
}

describe("computeStats", () => {
  it("matches a hand-computed two-scene plan", () => {
    const scenes: ScenePlan[] = [
      { sceneId: "a", durationSec: 6, durationFrames: 180, fps: 30, warnings: [], shots: [shot("1", "still", 0, 4), shot("2", "footage", 4, 6)] },
      { sceneId: "b", durationSec: 6, durationFrames: 180, fps: 30, warnings: [], shots: [shot("3", "still", 0, 3), shot("4", "still", 3, 6)] },
    ];
    const words: SceneWord[][] = [
      [{ i: 0, text: "qua", startSec: 3.6, endSec: 4.4, sentenceEnd: false, punct: false }],
      [],
    ];
    const stats = computeStats({ scenes }, words, [[4.05], null]);
    expect(stats.kindShare.still).toBeCloseTo(10 / 12);
    expect(stats.kindShare.footage).toBeCloseTo(2 / 12);
    const entropy = -(10 / 12) * Math.log2(10 / 12) - (2 / 12) * Math.log2(2 / 12);
    expect(stats.kindEntropyBits).toBeCloseTo(entropy);
    expect(stats.maxSameKindRun).toBe(2);
    expect(stats.wordGapCutPct).toBeCloseTo(0.5);
    expect(stats.beatCutPct).toBeCloseTo(0.5);
    expect(stats.shotsPerMin).toBeCloseTo(20);
    expect(stats.meanShotSec).toBeCloseTo(3);
    expect(stats.stdevShotSec).toBeCloseTo(Math.sqrt(0.5));
  });
});
