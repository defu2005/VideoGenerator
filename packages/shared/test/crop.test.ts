import { describe, expect, it } from "vitest";
import { planCrop } from "../src/index.js";

describe("planCrop", () => {
  it("shrinks an image that already has the video ratio", () => {
    expect(planCrop({ width: 1920, height: 1080, targetAspect: 16 / 9 })).toEqual({
      box: { x: 96, y: 54, width: 1728, height: 972 },
      rule: "same_ratio_scale",
      keepsSubject: true,
    });
    expect(planCrop({ width: 1000, height: 1000, targetAspect: 1 }).box).toEqual({ x: 50, y: 50, width: 900, height: 900 });
  });

  it("takes the largest target-ratio box from a different image", () => {
    expect(planCrop({ width: 4000, height: 3000, targetAspect: 16 / 9 }).box).toMatchObject({ width: 4000, height: 2250 });
    expect(planCrop({ width: 1080, height: 1920, targetAspect: 16 / 9 }).box).toMatchObject({ width: 1080, height: 608 });
  });

  it("clamps a focus at the edge and keeps a subject that fits", () => {
    const edge = planCrop({ width: 1000, height: 1000, targetAspect: 1, focus: { x: 0, y: 0 } });
    expect(edge.box.x).toBe(0);
    expect(edge.box.y).toBe(0);
    const kept = planCrop({
      width: 1000, height: 1000, targetAspect: 1,
      subjectBox: { x: 10, y: 10, width: 100, height: 100 },
    });
    expect(kept.keepsSubject).toBe(true);
    expect(kept.box.x).toBeLessThanOrEqual(10);
    const missed = planCrop({
      width: 1000, height: 1000, targetAspect: 1,
      subjectBox: { x: 0, y: 0, width: 1000, height: 1000 },
    });
    expect(missed.keepsSubject).toBe(false);
  });

  it("uses even sizes and stays within one pixel of the ratio", () => {
    const box = planCrop({ width: 1080, height: 1920, targetAspect: 16 / 9 }).box;
    expect(box.width % 2).toBe(0);
    expect(box.height % 2).toBe(0);
    expect(Math.abs(box.width / box.height - 16 / 9)).toBeLessThanOrEqual(1 / box.height);
  });
});
