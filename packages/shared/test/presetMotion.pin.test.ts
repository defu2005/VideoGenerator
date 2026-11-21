import { describe, expect, it } from "vitest";
import { presetMotion } from "../src/timeline/build.js";

// TASK-146 slice 3 pin: today's preset -> still camera move, one mapping shared by compose and preview.
// Step A of the push_in fix: this pins current output exactly, so the extraction is behaviour-neutral.

const wide = { zoom: 1, x: 0.5, y: 0.5 };
const close = { zoom: 1.12, x: 0.5, y: 0.5 };

describe("presetMotion pin (current behaviour)", () => {
  it("static holds the wide frame", () => {
    expect(presetMotion("static")).toEqual({ type: "kenburns", from: wide, to: wide });
  });

  it("pull_out zooms from close to wide", () => {
    expect(presetMotion("pull_out")).toEqual({ type: "kenburns", from: close, to: wide });
  });

  it("pans keep their travel direction", () => {
    expect(presetMotion("pan_left")).toEqual({ type: "pan", from: { zoom: 1.08, x: 0.62, y: 0.5 }, to: { zoom: 1.08, x: 0.38, y: 0.5 } });
    expect(presetMotion("pan_right")).toEqual({ type: "pan", from: { zoom: 1.08, x: 0.38, y: 0.5 }, to: { zoom: 1.08, x: 0.62, y: 0.5 } });
    expect(presetMotion("pan_up")).toEqual({ type: "pan", from: { zoom: 1.08, x: 0.5, y: 0.62 }, to: { zoom: 1.08, x: 0.5, y: 0.38 } });
  });

  it("punch_in zooms in from wide to close", () => {
    expect(presetMotion("punch_in")).toEqual({ type: "kenburns", from: wide, to: close });
  });

  it("push_in zooms in, like punch_in (it used to zoom out)", () => {
    expect(presetMotion("push_in")).toEqual({ type: "kenburns", from: wide, to: close });
  });
});
