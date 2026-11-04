import { describe, expect, it } from "vitest";
import { STOCK_IMAGE_PROVIDERS, preferredSources } from "../src/index.js";

describe("preferredSources", () => {
  it("never removes providers and keeps a full order", () => {
    const plan = preferredSources({ topic: "random topic about nothing special" });
    expect(plan.order).toHaveLength(STOCK_IMAGE_PROVIDERS.length);
    expect(new Set(plan.order)).toEqual(new Set(STOCK_IMAGE_PROVIDERS));
  });

  it("puts NASA first for space / science topics", () => {
    const plan = preferredSources({ topic: "Apollo moon landing and NASA rockets" });
    expect(plan.order[0]).toBe("nasa");
    expect(plan.limits.nasa).toBeGreaterThan(plan.limits.pexels);
  });

  it("prioritizes museum sources for history / art", () => {
    const plan = preferredSources(
      { topic: "Renaissance painting", style: "documentary" },
      { sceneText: "Van Gogh wheat field museum art" },
    );
    expect(plan.order.slice(0, 4)).toEqual(["met", "loc", "smithsonian", "europeana"]);
  });

  it("prioritizes stock sources for everyday life", () => {
    const plan = preferredSources({ topic: "coffee shop lifestyle street food" });
    expect(plan.order.slice(0, 3)).toEqual(["pexels", "unsplash", "pixabay"]);
  });
});
