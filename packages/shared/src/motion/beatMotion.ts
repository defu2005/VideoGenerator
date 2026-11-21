import type { MotionPreset } from "../edit/plan.js";
import type { BeatPurpose } from "../script/outline.js";

/** A scene's place in a script beat. `start` is true on the first scene of the beat. */
export type BeatMark = { purpose: BeatPurpose; start: boolean };
export type BeatScene = { sceneId: string; startSec: number; beat?: BeatMark };

/** Camera move on the first scene of each beat. null: the beat keeps the camera-motion cycle. */
export const BEAT_MOTION: Record<BeatPurpose, MotionPreset | null> = {
  hook: "punch_in",
  setup: "pan_right",
  tension: "push_in",
  reveal: "punch_in",
  evidence: "push_in",
  explanation: "static",
  payoff: "pull_out",
  reflection: "pull_out",
  transition: null,
  cta: "static",
};

const PAN_PRESETS = new Set<MotionPreset>(["pan_left", "pan_right", "pan_up"]);

/**
 * Pure. On the first scene of a beat, swaps the cycle value for the beat's move, unless:
 * - the move is a pan and the previous or next scene already pans the same way;
 * - the move is punch_in and the last punch_in was less than `capSec` ago.
 * Scenes in `fixed` (motions the LLM chose) keep their motion. Every scene keeps its place in the output.
 */
export function applyBeatMotion(
  motions: { sceneId: string; preset: MotionPreset }[],
  scenes: BeatScene[],
  capSec: number,
  fixed: ReadonlySet<string> = new Set(),
): { sceneId: string; preset: MotionPreset }[] {
  const byId = new Map(scenes.map((scene) => [scene.sceneId, scene]));
  const out: { sceneId: string; preset: MotionPreset }[] = [];
  let lastPunchAt = -Infinity;
  for (const [index, item] of motions.entries()) {
    const scene = byId.get(item.sceneId);
    const beat = scene?.beat;
    const want = beat?.start && !fixed.has(item.sceneId) ? BEAT_MOTION[beat.purpose] : null;
    let preset = item.preset;
    if (want) {
      const previous = out[out.length - 1]?.preset;
      const next = motions[index + 1]?.preset;
      const repeatsPan = PAN_PRESETS.has(want) && (want === previous || want === next);
      const tooClose = want === "punch_in" && scene !== undefined && scene.startSec - lastPunchAt < capSec;
      if (!repeatsPan && !tooClose) preset = want;
    }
    if (preset === "punch_in" && scene) lastPunchAt = scene.startSec;
    out.push({ sceneId: item.sceneId, preset });
  }
  return out;
}
