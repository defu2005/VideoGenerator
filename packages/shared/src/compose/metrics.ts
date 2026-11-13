import { shotVariantParams } from "./graphicKind.js";
import { SHOT_KINDS, type BeatGrid, type ComposeStats, type ScenePlan, type ShotKind } from "./schema.js";
import type { SceneWord } from "./words.js";

export function computeStats(
  plan: { scenes: ScenePlan[] },
  scenesWords: SceneWord[][],
  sceneBeats: Array<number[] | null>,
): ComposeStats {
  const shots = plan.scenes.flatMap((scene) => scene.shots);
  const total = shots.reduce((sum, shot) => sum + (shot.endSec - shot.startSec), 0);
  const kindShare = Object.fromEntries(SHOT_KINDS.map((kind) => [kind, 0])) as Record<ShotKind, number>;
  for (const shot of shots) kindShare[shot.kind] += (shot.endSec - shot.startSec) / (total || 1);
  let entropy = 0;
  for (const kind of SHOT_KINDS) {
    const share = kindShare[kind];
    if (share > 0) entropy -= share * Math.log2(share);
  }
  const lengths = shots.map((shot) => shot.endSec - shot.startSec);
  const mean = lengths.reduce((sum, value) => sum + value, 0) / (lengths.length || 1);
  const variance = lengths.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (lengths.length || 1);
  let run = 0;
  let maxRun = 0;
  let previous: ShotKind | null = null;
  for (const scene of plan.scenes) {
    for (const shot of scene.shots) {
      run = shot.kind === previous ? run + 1 : 1;
      previous = shot.kind;
      if (run > maxRun) maxRun = run;
    }
  }
  const inner: Array<{ scene: number; t: number }> = [];
  plan.scenes.forEach((scene, sceneIndex) => {
    for (let index = 0; index < scene.shots.length - 1; index += 1) {
      inner.push({ scene: sceneIndex, t: scene.shots[index]!.endSec });
    }
  });
  const gaps = inner.filter((cut) => {
    const words = scenesWords[cut.scene] ?? [];
    return !words.some((word) => word.startSec < cut.t && cut.t < word.endSec);
  });
  const beatCuts = inner.filter((cut) => {
    const beats = sceneBeats[cut.scene];
    return beats != null && beats.some((beat) => Math.abs(beat - cut.t) <= 0.12);
  });
  const hasGrid = sceneBeats.some((beats) => beats != null && beats.length > 0);
  return {
    shotsPerMin: total > 0 ? (shots.length / total) * 60 : 0,
    meanShotSec: mean,
    stdevShotSec: Math.sqrt(variance),
    kindShare,
    kindEntropyBits: entropy,
    maxSameKindRun: maxRun,
    wordGapCutPct: inner.length === 0 ? 1 : gaps.length / inner.length,
    beatCutPct: hasGrid ? (inner.length === 0 ? 0 : beatCuts.length / inner.length) : null,
    shotVariants: shots.map((shot) => shotVariantParams(shot)),
  };
}
