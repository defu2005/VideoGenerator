import { describe, expect, it } from "vitest";
import type { KindSpan, ShotKind } from "./schema.js";
import { checkVariety, enforceVariety, type VarietyScene } from "./variety.js";

function words(count: number, seconds = 1) {
  return Array.from({ length: count }, (_, index) => ({
    text: `w${index}`,
    startSec: index * seconds,
    endSec: (index + 1) * seconds,
  }));
}

function span(kind: ShotKind, start: number, end: number, reason = "r", lines?: string[]): KindSpan {
  return {
    kind,
    wordStart: start,
    wordEnd: end,
    reason,
    ...(lines ? { payload: { kind: "kinetic_text" as const, lines, emphasis: [], style: "bold" as const } } : {}),
  };
}

function scene(spans: KindSpan[], count: number, flags: { hasFootage?: boolean; hasStill?: boolean } = {}, seconds = 1): VarietyScene {
  return { words: words(count, seconds), spans, hasFootage: flags.hasFootage ?? false, hasStill: flags.hasStill ?? false };
}

describe("variety", () => {
  it("reports and breaks a run of three", () => {
    const scenes = [scene([span("footage", 0, 1), span("footage", 1, 2), span("footage", 2, 3)], 3, { hasFootage: true, hasStill: true })];
    expect(checkVariety(scenes).some((item) => item.rule === "V1-run" && item.span === 2)).toBe(true);
    const fixed = enforceVariety(scenes);
    expect(fixed.scenes[0]?.spans[2]?.kind).toBe("still");
    expect(fixed.changes.some((change) => change.rule === "V1-run")).toBe(true);
    expect(checkVariety(fixed.scenes)).toEqual([]);
    expect(scenes[0]?.spans[2]?.kind).toBe("footage");
  });

  it("counts a run across scene edges", () => {
    const scenes = [
      scene([span("footage", 0, 1), span("footage", 1, 2)], 2, { hasFootage: true, hasStill: true }),
      scene([span("footage", 0, 1)], 1, { hasFootage: true, hasStill: true }),
    ];
    const fixed = enforceVariety(scenes);
    expect(fixed.scenes[1]?.spans[0]?.kind).toBe("still");
  });

  it("converts the longest still when footage is available for half the scenes", () => {
    const scenes = [
      scene([span("still", 0, 5), span("footage", 5, 6)], 6, { hasFootage: true, hasStill: true }),
      scene([span("footage", 0, 1)], 1, { hasFootage: true, hasStill: true }),
    ];
    expect(checkVariety(scenes).some((item) => item.rule === "V2-still")).toBe(true);
    const fixed = enforceVariety(scenes);
    expect(fixed.scenes[0]?.spans[0]?.kind).toBe("footage");
    expect(fixed.changes.some((change) => change.rule === "V2-still")).toBe(true);
    expect(checkVariety(fixed.scenes)).toEqual([]);
  });

  it("counts map, compare, quote and list toward the 30 percent cap", () => {
    const scenes = [scene([
      span("map", 0, 4),
      span("still", 4, 10),
    ], 10, { hasStill: true })];
    expect(checkVariety(scenes).some((item) => item.rule === "V3-graphic")).toBe(true);
    const fixed = enforceVariety(scenes);
    expect(fixed.scenes[0]?.spans[0]?.kind).toBe("still");
    expect(checkVariety(fixed.scenes).some((item) => item.rule === "V3-graphic")).toBe(false);
  });

  it("converts the shortest graphic first and keeps the hook", () => {
    const scenes = [scene([
      span("kinetic_text", 0, 4, "body", ["a"]),
      span("kinetic_text", 4, 6, "R2-hook", ["b"]),
      span("still", 6, 16),
    ], 16, { hasStill: true })];
    expect(checkVariety(scenes).some((item) => item.rule === "V3-graphic")).toBe(true);
    const fixed = enforceVariety(scenes);
    expect(fixed.scenes[0]?.spans[0]?.kind).toBe("still");
    expect(fixed.scenes[0]?.spans[1]?.kind).toBe("kinetic_text");
    expect(fixed.scenes[0]?.spans[1]?.reason).toBe("R2-hook");
    expect(checkVariety(fixed.scenes).some((item) => item.rule === "V3-graphic")).toBe(false);
  });

  it("shortens a kinetic subtitle longer than 3 seconds", () => {
    const scenes = [scene([
      span("kinetic_text", 0, 4, "r", ["w0 w1 w2 w3"]),
      span("still", 4, 14),
    ], 14, { hasStill: true })];
    expect(checkVariety(scenes).some((item) => item.rule === "V4-subtitle")).toBe(true);
    const fixed = enforceVariety(scenes);
    expect(fixed.scenes[0]?.spans[0]?.wordEnd).toBe(3);
    expect(fixed.scenes[0]?.spans[0]?.kind).toBe("kinetic_text");
    expect(fixed.scenes[0]?.spans).toHaveLength(2);
    expect(fixed.scenes[0]?.spans[1]?.wordStart).toBe(3);
    expect(checkVariety(fixed.scenes).some((item) => item.rule === "V4-subtitle")).toBe(false);
  });

  it("keeps every word covered when the last span of a scene is shortened", () => {
    const scenes = [scene([
      span("still", 0, 10),
      span("kinetic_text", 10, 14, "r", ["w10 w11 w12 w13"]),
    ], 14, { hasStill: true })];
    const fixed = enforceVariety(scenes);
    const spans = fixed.scenes[0]!.spans;
    expect(spans[1]).toMatchObject({ kind: "kinetic_text", wordStart: 11, wordEnd: 14 });
    expect(spans[0]?.wordEnd).toBe(11);
    expect(spans[0]?.wordStart).toBe(0);
  });

  it("converts a kinetic subtitle that cannot be shortened to one word", () => {
    const scenes = [{
      words: [
        { text: "xin chao", startSec: 0, endSec: 4 },
        ...Array.from({ length: 10 }, (_, index) => ({ text: `s${index}`, startSec: 4 + index, endSec: 5 + index })),
      ],
      spans: [
        span("kinetic_text", 0, 1, "r", ["xin chao"]),
        span("still", 1, 11),
      ],
      hasFootage: false,
      hasStill: true,
    }];
    const fixed = enforceVariety(scenes);
    expect(fixed.scenes[0]?.spans[0]?.kind).toBe("still");
    expect(fixed.changes.some((change) => change.rule === "V4-subtitle" && change.to === "still")).toBe(true);
  });

  it("applies V3 before V1 and leaves no new violation", () => {
    const scenes = [scene([
      span("kinetic_text", 0, 4, "r", ["a"]),
      span("footage", 4, 5),
      span("footage", 5, 6),
      span("footage", 6, 7),
    ], 7, { hasFootage: true, hasStill: true })];
    const fixed = enforceVariety(scenes);
    const rules = fixed.changes.map((change) => change.rule);
    expect(rules.indexOf("V3-graphic")).toBeGreaterThanOrEqual(0);
    expect(rules.indexOf("V3-graphic")).toBeLessThan(rules.indexOf("V1-run"));
    expect(checkVariety(fixed.scenes)).toEqual([]);
    expect(fixed.scenes[0]?.spans).toHaveLength(scenes[0]!.spans.length);
  });

  it("keeps a run when the scene has neither footage nor a still", () => {
    const scenes = [scene([
      span("kinetic_text", 0, 1),
      span("kinetic_text", 1, 2),
      span("kinetic_text", 2, 3),
    ], 3)];
    const fixed = enforceVariety(scenes);
    expect(fixed.scenes[0]?.spans.map((item) => item.kind)).toEqual(["kinetic_text", "kinetic_text", "kinetic_text"]);
    expect(checkVariety(fixed.scenes).some((item) => item.rule === "V1-run")).toBe(true);
    expect(fixed.scenes[0]?.spans).toHaveLength(3);
  });

  it("is deterministic", () => {
    const scenes = [scene([span("footage", 0, 1), span("footage", 1, 2), span("footage", 2, 3)], 3, { hasFootage: true, hasStill: true })];
    expect(enforceVariety(scenes)).toEqual(enforceVariety(scenes));
    expect(checkVariety(scenes)).toEqual(checkVariety(scenes));
  });
});
