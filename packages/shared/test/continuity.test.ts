import { describe, expect, it } from "vitest";
import {
  ContinuityPlanSchema,
  emptyContinuityPlan,
  continuityQueries,
  rgbToLab,
  labDistance,
  continuityScore,
  continuityFindings,
  ContinuityReportSchema,
} from "../src/index.js";

describe("continuity schemas and helpers", () => {
  it("validates empty and full continuity plans", () => {
    const empty = emptyContinuityPlan();
    expect(ContinuityPlanSchema.safeParse(empty).success).toBe(true);

    const full = {
      characters: [{
        id: "hero",
        description: "Main character",
        appearsInScenes: ["11111111-1111-4111-8111-111111111111"],
        referenceQuery: "hero face close up",
      }],
      palette: {
        temperature: "warm" as const,
        saturation: "high" as const,
        dominantHues: ["#ff8800", "#334455"],
      },
      pacing: { hook: 3.5, body: 6, outro: 4 },
      motifs: [{
        id: "clock",
        description: "Ticking clock",
        scenes: ["11111111-1111-4111-8111-111111111111"],
      }],
      avoid: ["no blurry images", "no cartoons"],
    };
    const parsed = ContinuityPlanSchema.safeParse(full);
    expect(parsed.success).toBe(true);
  });

  it("adds character and motif queries while keeping original queries first", () => {
    const plan = emptyContinuityPlan();
    plan.palette.temperature = "cool";
    plan.palette.saturation = "low";
    plan.characters = [{
      id: "alice",
      description: "Alice",
      appearsInScenes: ["scene-1"],
      referenceQuery: "alice portrait",
    }];
    plan.motifs = [{
      id: "compass",
      description: "antique compass",
      scenes: ["scene-1"],
    }];

    const original = ["mountain path", "hiking trail"];
    const queries = continuityQueries(plan, "scene-1", original);

    expect(queries[0]).toBe("mountain path");
    expect(queries[1]).toBe("hiking trail");
    expect(queries).toContain("alice portrait cool colors low saturation");
    expect(queries).toContain("mountain path antique compass cool colors low saturation");

    // Scene not in plan
    expect(continuityQueries(plan, "scene-2", original)).toEqual(original);
  });

  it("converts sRGB to Lab accurately", () => {
    const white = rgbToLab([255, 255, 255]);
    expect(white[0]).toBeCloseTo(100, 2);
    expect(white[1]).toBeCloseTo(0, 1);
    expect(white[2]).toBeCloseTo(0, 1);

    const black = rgbToLab([0, 0, 0]);
    expect(black[0]).toBeCloseTo(0, 2);

    expect(labDistance(white, black)).toBeGreaterThan(95);
  });

  it("calculates continuity score bounded between 0 and 1", () => {
    const plan = emptyContinuityPlan();
    plan.palette.dominantHues = ["#ffffff"];
    const whiteLab = rgbToLab([255, 255, 255]);
    const score = continuityScore(plan, whiteLab, whiteLab, 5, "section");
    expect(score).toBeGreaterThan(0.9);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("detects color jumps, pacing outliers, and missing motif tags", () => {
    const plan = emptyContinuityPlan();
    plan.pacing.body = 5;
    plan.motifs = [{
      id: "river",
      description: "River flow",
      scenes: ["scene-2"],
    }];

    const scenes = [
      {
        id: "scene-1",
        kind: "section" as const,
        duration: 5,
        lab: rgbToLab([255, 255, 255]),
        tags: ["nature"],
      },
      {
        id: "scene-2",
        kind: "section" as const,
        duration: 10,
        shots: [10], // verified shot 10s vs target 5s: > 40% difference
        lab: rgbToLab([0, 0, 0]), // Jump > 35
        tags: ["forest"], // Missing "river"
      },
    ];

    const findings = continuityFindings(plan, scenes);
    expect(findings.some((f) => f.code === "color_jump")).toBe(true);
    expect(findings.some((f) => f.code === "pacing")).toBe(true);
    expect(findings.some((f) => f.code === "motif_missing")).toBe(true);
  });

  it("does not infer pacing from scene duration when no verified shots exist", () => {
    const plan = emptyContinuityPlan();
    plan.pacing.body = 5;
    const scenes = [{ id: "scene-1", kind: "section" as const, duration: 10, lab: null, tags: [] }];
    expect(continuityFindings(plan, scenes).some((f) => f.code === "pacing")).toBe(false);
  });

  it("validates ContinuityReport schema", () => {
    const report = {
      dimension: "continuity" as const,
      findings: [{
        code: "color_jump" as const,
        sceneIds: ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"],
        message: "Màu giữa hai cảnh thay đổi mạnh.",
        suggestedFix: "Đổi sang ứng viên khác.",
      }],
      characterCheck: "skipped" as const,
      characterReason: "Chưa cấu hình model vision.",
      estimatedPacing: true,
    };
    expect(ContinuityReportSchema.safeParse(report).success).toBe(true);
  });
});
