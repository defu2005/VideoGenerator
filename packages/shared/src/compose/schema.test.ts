import { describe, expect, it } from "vitest";
import { MIN_GRAPHIC_SHOT_SEC, MIN_SHOT_SEC, shotFrames, validateScenePlan, type ScenePlan, type Shot } from "./schema.js";

function still(id: string, start: number, end: number, kind: Shot["kind"] = "still"): Shot {
  return {
    id,
    kind,
    startSec: start,
    endSec: end,
    source: kind === "still"
      ? { kind: "still", candidateId: null, path: "a.png", motion: "static" }
      : { kind: "kinetic_text", lines: ["một"], emphasis: [0], style: "bold" },
    reason: "test",
  };
}

function plan(shots: Shot[], durationSec = 4, durationFrames = 120): ScenePlan {
  return { sceneId: "s", durationSec, durationFrames, fps: 30, shots, warnings: [] };
}

describe("validateScenePlan", () => {
  it("accepts a plan that covers the scene on whole frames", () => {
    const scene = plan([still("a", 0, 2), still("b", 2, 4)]);
    expect(shotFrames(scene)).toEqual([60, 60]);
    expect(validateScenePlan(scene, [{ startSec: 1, endSec: 1.4 }])).toEqual([]);
  });

  it("rejects a gap", () => {
    expect(validateScenePlan(plan([still("a", 0, 1.5), still("b", 2, 4)]), [])).not.toEqual([]);
  });

  it("rejects an overlap", () => {
    expect(validateScenePlan(plan([still("a", 0, 2.2), still("b", 2, 4)]), [])).not.toEqual([]);
  });

  it("rejects a frame count that does not add up", () => {
    expect(validateScenePlan(plan([still("a", 0, 2), still("b", 2, 4)], 4, 119), [])).not.toEqual([]);
  });

  it("rejects a shot shorter than the minimum", () => {
    const short = still("a", 0, MIN_SHOT_SEC - 0.1);
    expect(validateScenePlan(plan([short, still("b", short.endSec, 4)]), [])).not.toEqual([]);
  });

  it("accepts a map inside 2.5–7 seconds and rejects one outside it", () => {
    const map: Shot = {
      id: "m", kind: "map", startSec: 0, endSec: 4, reason: "test",
      source: { kind: "map", focus: "VN", zoom: "push" },
    };
    expect(validateScenePlan(plan([map]), [])).toEqual([]);
    const short: Shot = { ...map, id: "s", endSec: 2 };
    expect(validateScenePlan(plan([short, still("b", 2, 4)]), [])).not.toEqual([]);
  });

  it("rejects a graphic outside 1.5–6 seconds", () => {
    const short = still("a", 0, MIN_GRAPHIC_SHOT_SEC - 0.2, "kinetic_text");
    expect(validateScenePlan(plan([short, still("b", short.endSec, 4)]), [])).not.toEqual([]);
    const long = still("g", 0, 6.2, "kinetic_text");
    expect(validateScenePlan(plan([long], 6.2, 186), [])).not.toEqual([]);
  });

  it("rejects a kind that does not match its source", () => {
    const shot = still("a", 0, 4);
    shot.kind = "footage";
    expect(validateScenePlan(plan([shot]), [])).not.toEqual([]);
  });

  it("rejects a cut that lands inside a word", () => {
    const scene = plan([still("a", 0, 2), still("b", 2, 4)]);
    expect(validateScenePlan(scene, [{ startSec: 1.8, endSec: 2.2 }])).not.toEqual([]);
  });
});
