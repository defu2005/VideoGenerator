import { describe, expect, it } from "vitest";
import {
  DEFAULT_WEB_IMAGE_DOMAIN_DENYLIST,
  deriveSceneVisualStatus,
  ensureEntityPrefix,
  isFictionalWork,
  isHighRiskSource,
  isUnknownLicenseRisk,
  visualAttentionReason,
  withNegativeTerms,
  workEntity,
} from "../src/index.js";

const downloaded = {
  id: "candidate",
  localPath: "visuals/image.png",
  sha256: "a".repeat(64),
  actualWidth: 640,
  actualHeight: 480,
};

describe("scene image queries", () => {
  it("prefixes the work name and skips a negative term that the scene already uses", () => {
    expect(workEntity("Berserk")).toBe("Berserk");
    expect(ensureEntityPrefix("human spirit", "Berserk")).toBe("Berserk human spirit");
    expect(ensureEntityPrefix("Berserk eclipse", "Berserk")).toBe("Berserk eclipse");
    const query = withNegativeTerms("Berserk peaceful dawn", "The parade fills the street");
    expect(query).toContain("-cosplay");
    expect(query).toContain("-NASA");
    expect(query).not.toContain("-parade");
    expect(query).toContain('-"marching band"');
  });

  it("treats manga, anime, game, film and novel topics as fictional", () => {
    expect(isFictionalWork({ topic: "Berserk", niche: "manga phản biện" })).toBe(true);
    expect(isFictionalWork({ topic: "River documentary" })).toBe(false);
  });

  it("marks reddit and fan-art hosts as high risk and keeps other pages", () => {
    expect(isHighRiskSource(["https://www.reddit.com/r/berserk/image.jpg"])).toBe(true);
    expect(isHighRiskSource(["https://i.imgur.com/fan.jpg"])).toBe(true);
    expect(isHighRiskSource(["https://commons.wikimedia.org/wiki/File:Berserk.jpg"])).toBe(false);
  });
});

describe("visual relevance gate", () => {
  it("blocks an agent-approved off-topic image and keeps a user choice", () => {
    expect(visualAttentionReason({
      selection: { selectedBy: "AGENT", status: "APPROVED" },
      lowRelevance: true,
    })).toBe("lowRelevance");
    expect(deriveSceneVisualStatus(
      { status: "APPROVED", selectedBy: "AGENT", candidateId: "candidate" },
      [downloaded],
      false,
      "DONE",
      false,
      "lowRelevance",
    )).toBe("NEEDS_ATTENTION");
    expect(deriveSceneVisualStatus(
      { status: "APPROVED", selectedBy: "USER", candidateId: "candidate" },
      [downloaded],
      false,
      "DONE",
      false,
      "lowRelevance",
    )).toBe("READY_FOR_RENDER");
    expect(deriveSceneVisualStatus(
      { status: "CUSTOM", selectedBy: "USER", candidateId: "candidate" },
      [downloaded],
      false,
      "DONE",
      true,
      "no_candidate",
    )).toBe("READY_FOR_RENDER");
    expect(deriveSceneVisualStatus(
      { status: "APPROVED", selectedBy: "AGENT", candidateId: "candidate" },
      [downloaded],
      false,
      "DONE",
      false,
      "vision_reject",
    )).toBe("NEEDS_ATTENTION");
    expect(visualAttentionReason({
      selection: { selectedBy: "AGENT", status: "APPROVED" },
      visionRequired: true,
      hasVisionResult: false,
    })).toBe("vision_missing");
    expect(deriveSceneVisualStatus(
      { status: "APPROVED", selectedBy: "AGENT", candidateId: "candidate" },
      [downloaded],
      false,
      "DONE",
      false,
      "vision_missing",
    )).toBe("NEEDS_ATTENTION");
    expect(visualAttentionReason({
      selection: { selectedBy: "USER", status: "APPROVED" },
      lowRelevance: true,
      visionRequired: true,
      hasVisionResult: false,
    })).toBeNull();
    expect(isUnknownLicenseRisk({ provider: "brave", licenseKind: "UNKNOWN", licenseVerified: true })).toBe(true);
    expect(isUnknownLicenseRisk({ provider: "wikimedia", licenseKind: "UNKNOWN", licenseVerified: true })).toBe(false);
    expect(isUnknownLicenseRisk({ provider: "mock", licenseKind: "UNKNOWN", licenseVerified: false })).toBe(true);
    expect(DEFAULT_WEB_IMAGE_DOMAIN_DENYLIST).toEqual(expect.arrayContaining([
      "pinterest.com",
      "pinimg.com",
      "wallpaperflare.com",
      "craiyon.com",
      "prompthero.com",
      "nightcafe.studio",
      "lexica.art",
    ]));
  });
});
