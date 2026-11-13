import { describe, expect, it } from "vitest";
import { dHashFromGray, hamming, hashToHex, hexToHash, resolveBudget, stockWatermarkSuspected, visualFeaturesFor } from "../src/index.js";

describe("dHash", () => {
  it("is identical for the same pixels and far for an inverted image", () => {
    const pixels = new Uint8Array(72);
    for (let i = 0; i < pixels.length; i += 1) pixels[i] = i % 9;
    const left = dHashFromGray(pixels);
    const right = dHashFromGray(Uint8Array.from(pixels));
    expect(hamming(left, right)).toBe(0);
    const inverted = dHashFromGray(Uint8Array.from(pixels, (value) => 255 - value));
    expect(hamming(left, inverted)).toBeGreaterThan(12);
    expect(hexToHash(hashToHex(left))).toBe(left);
    const resized = Uint8Array.from(pixels);
    resized[0] = pixels[0] ?? 0;
    expect(hamming(left, dHashFromGray(resized))).toBeLessThanOrEqual(6);
  });
});

describe("visual quality", () => {
  it("widens search only in best mode and leaves the budget preset alone", () => {
    const eco = resolveBudget("ECO");
    expect(visualFeaturesFor(eco, "budget").visualSearchBreadth).toBe(8);
    expect(visualFeaturesFor(eco, "budget").visionCheck).toBe(false);
    const best = visualFeaturesFor(eco, "best");
    expect(best.visualSearchBreadth).toBe(32);
    expect(best.visionCheck).toBe(true);
    expect(best.visionRetryRounds).toBe(3);
    expect(best.webImageSearch).toBe(999);
    for (const mode of ["ECO", "BALANCED", "MAX"] as const) {
      const features = visualFeaturesFor(resolveBudget(mode), "best");
      expect(features.visualSearchBreadth).toBe(32);
      expect(features.visionCheck).toBe(true);
      expect(features.visionRetryRounds).toBe(3);
      expect(features.webImageSearch).toBe(999);
    }
  });
});

describe("stock watermark hosts", () => {
  it("rejects a stock host and a preview path on that host", () => {
    expect(stockWatermarkSuspected({ imageUrl: "https://images.shutterstock.com/comp/photo.jpg" })).toBe(true);
    expect(stockWatermarkSuspected({ sourceUrl: "https://example.org/photo.jpg" })).toBe(false);
  });
});
