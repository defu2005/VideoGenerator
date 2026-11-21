import { describe, expect, it } from "vitest";
import { fallbackEditPlan } from "../src/edit/plan.js";
import { buildTimeline, type TimelineSceneInput } from "../src/timeline/build.js";

// TASK-146 slice 3 pin: today's camera-motion defaults for scenes with NO beat data.
// Must stay green with zero source edits. Later slices must keep old-script output byte-identical.

const EXPECTED_CYCLE = ["push_in", "pan_left", "pull_out", "pan_right", "static", "pan_up", "push_in"];

function scene(order: number): TimelineSceneInput {
  return {
    id: `s${order}`,
    order,
    label: `Scene ${order}`,
    noVisual: false,
    durationOverrideSec: null,
    estDurationSec: 5,
    voice: { trackId: `v${order}`, path: `/abs/voice${order}.mp3`, durationSec: 4 },
    visuals: [{ candidateId: `c${order}`, path: `visuals/${order}.jpg`, ready: true, licenseKind: "CC0", motion: null }],
  };
}

const scenes = EXPECTED_CYCLE.map((_, index) => scene(index));

describe("TASK-146 slice 3 pin: motion defaults without beat data", () => {
  it("fallbackEditPlan assigns the alternating camera-motion cycle by scene index", () => {
    const plan = fallbackEditPlan({
      title: "",
      scenes: scenes.map((item) => ({ sceneId: item.id, startSec: 0, durationSec: 5, hook: item.order === 0 })),
    });
    expect(plan.motions.map((item) => item.preset)).toEqual(EXPECTED_CYCLE);
    expect(plan.motions.map((item) => item.sceneId)).toEqual(scenes.map((item) => item.id));
  });

  it("buildTimeline puts the same preset on the first visual of each scene", () => {
    const result = buildTimeline({ aspectRatio: "16:9", musicEnabled: false, music: null, scenes });
    expect(result.scenes.map((item) => item.visuals[0]?.motionPreset)).toEqual(EXPECTED_CYCLE);
  });

  it("buildTimeline keeps the story rhythm: zoomin into scene 1, cut elsewhere", () => {
    const result = buildTimeline({ aspectRatio: "16:9", musicEnabled: false, music: null, scenes: scenes.slice(0, 3) });
    expect(result.scenes[0]?.transitionOut).toEqual({ type: "zoomin", durationSec: 0.4 });
    expect(result.scenes[1]?.transitionOut).toEqual({ type: "cut", durationSec: 0 });
  });

  it("a scene with no ready visual gets a placeholder that still carries the scene preset", () => {
    const result = buildTimeline({
      aspectRatio: "16:9",
      musicEnabled: false,
      music: null,
      scenes: [{ ...scene(0), visuals: [] }, scene(1)],
    });
    expect(result.scenes[0]?.visuals[0]).toMatchObject({ kind: "PLACEHOLDER", motionPreset: "push_in" });
    expect(result.scenes[1]?.visuals[0]?.motionPreset).toBe("pan_left");
  });
});
