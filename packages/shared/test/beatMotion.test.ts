import { describe, expect, it } from "vitest";
import { validateEditPlan, type MotionPreset } from "../src/edit/plan.js";
import { applyBeatMotion, BEAT_MOTION } from "../src/motion/beatMotion.js";
import { buildTimeline, type TimelineSceneInput } from "../src/timeline/build.js";

// TASK-146 slice 3: beat purpose sets the camera move at the first scene of a beat.
// Later scenes in a beat keep the cycle; a pan repeating the previous pan and a punch_in
// closer than the frequency cap both keep the cycle value. A pan also keeps the cycle value
// when the previous or the next scene already pans the same way.

type Mark = { purpose: keyof typeof BEAT_MOTION; start: boolean };
type Scene = { sceneId: string; startSec: number; beat?: Mark };

const CYCLE: MotionPreset[] = ["push_in", "pan_left", "pull_out", "pan_right", "static", "pan_up", "push_in"];
const base = (presets: MotionPreset[]) => presets.map((preset, index) => ({ sceneId: `s${index}`, preset }));
const presetsOf = (items: { preset: MotionPreset }[]) => items.map((item) => item.preset);

describe("BEAT_MOTION table", () => {
  it("maps every beat purpose to a motion or to null (transition keeps the preset)", () => {
    expect(BEAT_MOTION).toEqual({
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
    });
  });
});

describe("applyBeatMotion", () => {
  it("leaves the cycle unchanged when no scene carries a beat", () => {
    const scenes: Scene[] = CYCLE.map((_, index) => ({ sceneId: `s${index}`, startSec: index * 5 }));
    expect(applyBeatMotion(base(CYCLE), scenes, 15)).toEqual(base(CYCLE));
  });

  it("sets the table motion on the first scene of a beat and keeps the cycle inside it", () => {
    const scenes: Scene[] = [
      { sceneId: "s0", startSec: 0 },
      { sceneId: "s1", startSec: 5, beat: { purpose: "reveal", start: true } },
      { sceneId: "s2", startSec: 10, beat: { purpose: "reveal", start: false } },
    ];
    const result = applyBeatMotion(base(["push_in", "pan_left", "pull_out"]), scenes, 15);
    expect(presetsOf(result)).toEqual(["push_in", "punch_in", "pull_out"]);
  });

  it("keeps the cycle value when a pan would repeat the previous scene's pan", () => {
    const scenes: Scene[] = [
      { sceneId: "s0", startSec: 0, beat: { purpose: "setup", start: true } },
      { sceneId: "s1", startSec: 5, beat: { purpose: "setup", start: true } },
    ];
    const result = applyBeatMotion(base(["push_in", "pan_left"]), scenes, 15);
    expect(presetsOf(result)).toEqual(["pan_right", "pan_left"]);
  });

  it("keeps the cycle value when a pan would repeat the next scene's pan", () => {
    const scenes: Scene[] = [
      { sceneId: "s2", startSec: 10, beat: { purpose: "setup", start: true } },
    ];
    const result = applyBeatMotion(base(["push_in", "pan_left", "pull_out", "pan_right"]), scenes, 15);
    expect(presetsOf(result)).toEqual(["push_in", "pan_left", "pull_out", "pan_right"]);
  });

  it("keeps the cycle value for a punch_in closer than the cap to the previous one", () => {
    const scenes: Scene[] = [
      { sceneId: "s0", startSec: 0, beat: { purpose: "hook", start: true } },
      { sceneId: "s1", startSec: 5, beat: { purpose: "reveal", start: true } },
      { sceneId: "s2", startSec: 20, beat: { purpose: "reveal", start: true } },
    ];
    const result = applyBeatMotion(base(["push_in", "pan_left", "pull_out"]), scenes, 15);
    expect(presetsOf(result)).toEqual(["punch_in", "pan_left", "punch_in"]);
  });

  it("keeps the cycle value for a transition beat, which has no motion", () => {
    const scenes: Scene[] = [{ sceneId: "s0", startSec: 0, beat: { purpose: "transition", start: true } }];
    expect(presetsOf(applyBeatMotion(base(["pan_left"]), scenes, 15))).toEqual(["pan_left"]);
  });
});

function scene(order: number, extra: Partial<TimelineSceneInput> = {}): TimelineSceneInput {
  return {
    id: `s${order}`,
    order,
    label: `Scene ${order}`,
    noVisual: false,
    durationOverrideSec: null,
    estDurationSec: 5,
    voice: { trackId: `v${order}`, path: `/abs/voice${order}.mp3`, durationSec: 4 },
    visuals: [{ candidateId: `c${order}`, path: `visuals/${order}.jpg`, ready: true, licenseKind: "CC0", motion: null }],
    ...extra,
  };
}

describe("beats reach the timeline and the stored edit plan", () => {
  it("buildTimeline applies the beat motion and carries the beat onto the output scene", () => {
    const scenes = [0, 1, 2, 3].map((order) => scene(order, order === 2 ? { beat: { purpose: "reveal", start: true } } : {}));
    const result = buildTimeline({ aspectRatio: "16:9", musicEnabled: false, music: null, scenes });
    expect(result.scenes.map((item) => item.visuals[0]?.motionPreset)).toEqual(["push_in", "pan_left", "punch_in", "pan_right"]);
    expect(result.scenes[2]?.beat).toEqual({ purpose: "reveal", start: true });
    expect("beat" in (result.scenes[0] ?? {})).toBe(false);
  });

  it("validateEditPlan applies beats, and an LLM motion still wins for its own scene", () => {
    const emphasis = [0, 1, 2].map((index) => ({
      sceneId: `s${index}`,
      startSec: index * 5,
      durationSec: 5,
      ...(index === 2 ? { beat: { purpose: "reveal" as const, start: true } } : {}),
    }));
    const plain = validateEditPlan({}, emphasis, "story");
    expect(presetsOf(plain.motions)).toEqual(["push_in", "pan_left", "punch_in"]);
    const llm = validateEditPlan({ motions: [{ sceneId: "s2", preset: "pull_out" }] }, emphasis, "story");
    expect(presetsOf(llm.motions)).toEqual(["push_in", "pan_left", "pull_out"]);
  });
});
