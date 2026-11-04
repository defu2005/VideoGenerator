import { describe, expect, it } from "vitest";
import {
  aspectsNeededFromAccounts,
  missingRenderAspects,
  parseRenderJobScope,
  renderAspectLabel,
  renderJobScope,
  subtitleLayoutForAspect,
  VERTICAL_DURATION_WARN_SEC,
} from "../src/render/variants.js";

describe("render variants helpers", () => {
  it("collects unique aspects from profile accounts", () => {
    expect(aspectsNeededFromAccounts([
      { format: "landscape" },
      { format: "vertical" },
      { format: "vertical", enabled: false },
      { format: "landscape" },
    ])).toEqual(["16:9", "9:16"]);
  });

  it("picks missing formats against existing renders", () => {
    expect(missingRenderAspects({
      needed: ["16:9", "9:16"],
      projectAspect: "16:9",
      existing: [
        { aspectRatio: null, status: "DONE" },
        { aspectRatio: "9:16", status: "FAILED" },
      ],
    })).toEqual(["9:16"]);

    expect(missingRenderAspects({
      needed: ["16:9", "9:16"],
      projectAspect: "16:9",
      existing: [
        { aspectRatio: null, status: "DONE" },
        { aspectRatio: "9:16", status: "DONE", deleted: true },
      ],
    })).toEqual(["9:16"]);
  });

  it("labels variants in Vietnamese", () => {
    expect(renderAspectLabel("9:16")).toBe("Dọc 9:16");
    expect(renderAspectLabel("16:9")).toBe("Ngang 16:9");
    expect(renderAspectLabel(null)).toBe("Ngang 16:9");
  });

  it("round-trips job scope", () => {
    expect(renderJobScope("9:16")).toBe("aspect:9:16");
    expect(parseRenderJobScope("aspect:9:16")).toBe("9:16");
    expect(parseRenderJobScope(null)).toBeNull();
  });
});

describe("subtitleLayoutForAspect (vertical)", () => {
  it("narrows line width, enlarges font, and sits above the 15% safe zone", () => {
    const landscape = subtitleLayoutForAspect("16:9", 42);
    const vertical = subtitleLayoutForAspect("9:16", 42);
    expect(vertical.width).toBe(1080);
    expect(vertical.height).toBe(1920);
    expect(vertical.maxCharsPerLine).toBe(Math.max(16, Math.round(42 * 0.6)));
    expect(vertical.maxCharsPerLine).toBeLessThan(landscape.maxCharsPerLine);
    expect(vertical.fontSize).toBeGreaterThan(landscape.fontSize * (1080 / 1920));
    expect(vertical.marginBottom / vertical.height).toBeGreaterThanOrEqual(0.15);
    expect(vertical.marginBottom / vertical.height).toBeLessThan(1 / 3);
    expect(VERTICAL_DURATION_WARN_SEC).toBe(180);
  });
});
