import { describe, expect, it } from "vitest";
import {
  applyVisionIssueCap,
  combineVisionScore,
  deriveSceneVisualStatus,
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
