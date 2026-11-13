import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  applyVisionIssueCap,
  combineVisionScore,
  deriveSceneVisualStatus,
  normalizeVisionCheckBatch,
  VisionCheckBatchSchema,
  VisionCheckSchema,
  VISION_IMAGE_TOKEN_ESTIMATE,
} from "../src/index.js";

describe("vision schemas and scoring", () => {
  it("parses a vision check payload", () => {
    const checked = VisionCheckSchema.parse({
      fit: 8,
      depicts: "A documentary still of a river",
      issues: [],
      cropOk: true,
      model: "mock-v1",
      checkedAt: "2026-11-04T00:00:00.000Z",
    });
    expect(checked.fit).toBe(8);
    expect(VISION_IMAGE_TOKEN_ESTIMATE).toBe(1_000);
  });

  it("caps hard issues and combines scores", () => {
    expect(applyVisionIssueCap(9, ["watermark"])).toBe(3);
    expect(applyVisionIssueCap(9, ["low_quality"])).toBe(9);
    expect(combineVisionScore({ visionFit: 10, textRerank: 1, codeScore: 1 })).toBe(1);
    expect(combineVisionScore({ visionFit: 0, textRerank: 0, codeScore: 0 })).toBe(0);
  });

  it("parses a batch vision response", () => {
    const batch = VisionCheckBatchSchema.parse({
      images: [{ label: "img-1", fit: 6, depicts: "buildings", issues: ["wrong_subject"], cropOk: true }],
    });
    expect(batch.images[0]?.fit).toBe(6);
  });

  it("normalizes unknown vision issues and extra keys before strict parse", () => {
    const raw = {
      images: [{
        label: "img-1",
        fit: "7",
        depicts: "hero",
        issues: ["blurry", "fan_art", "blurry"],
        cropOk: "true",
        subject: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
        reason: "extra",
      }],
      extraTop: true,
    };
    const { value, droppedIssues } = normalizeVisionCheckBatch(raw);
    const parsed = VisionCheckBatchSchema.parse(value);
    expect(parsed.images[0]?.issues).toEqual(["low_quality"]);
    expect(parsed.images[0]?.fit).toBe(7);
    expect(parsed.images[0]?.cropOk).toBe(true);
    expect(droppedIssues).toBeGreaterThan(0);
    expect(VisionCheckBatchSchema.parse(value)).toEqual(parsed);
  });

  it("clamps fit, clears bad issues, and keeps missing fit for schema rejection", () => {
    const high = normalizeVisionCheckBatch({
      images: [{ label: "a", fit: 12, depicts: "x", issues: [], cropOk: true }],
    });
    expect(VisionCheckBatchSchema.parse(high.value).images[0]?.fit).toBe(10);
    const low = normalizeVisionCheckBatch({
      images: [{ label: "a", fit: -1, depicts: "x", issues: [], cropOk: true }],
    });
    expect(VisionCheckBatchSchema.parse(low.value).images[0]?.fit).toBe(0);
    const missingFit = normalizeVisionCheckBatch({
      images: [{ label: "a", depicts: "x", issues: "nope", cropOk: false }],
    });
    expect(VisionCheckBatchSchema.safeParse(missingFit.value).success).toBe(false);
    expect(normalizeVisionCheckBatch({ images: [{ label: "a", fit: 1, depicts: "x", issues: [], cropOk: true }] }).value)
      .toEqual({ images: [{ label: "a", fit: 1, depicts: "x", issues: [], cropOk: true }] });
  });

  it("keeps wire JSON schema with issue enum after normalize helper exists", () => {
    const jsonSchema = z.toJSONSchema(VisionCheckBatchSchema) as { properties?: { images?: unknown } };
    expect(jsonSchema).toBeTruthy();
    const text = JSON.stringify(jsonSchema);
    expect(text).toContain("low_quality");
    expect(text).toContain("wrong_subject");
  });

  it("derives NEEDS_ATTENTION when vision flags the scene", () => {
    expect(deriveSceneVisualStatus(
      { status: "DISCOVERED", candidateId: "00000000-0000-4000-8000-000000000001" },
      [],
      false,
      "DONE",
      true,
    )).toBe("NEEDS_ATTENTION");
  });
});
