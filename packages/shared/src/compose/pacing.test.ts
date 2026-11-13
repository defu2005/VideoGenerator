import { describe, expect, it } from "vitest";
import { paceBand, paceSpan } from "./pacing.js";
import { cutCandidates, type SceneWord } from "./words.js";

function wordsEvery(step: number, count: number, sentenceAt: number[] = []): SceneWord[] {
  return Array.from({ length: count }, (_, index) => {
    const start = 0.2 + index * step;
    return {
      i: index,
      text: sentenceAt.includes(index) ? "xong." : "từ",
      startSec: start,
      endSec: start + 0.25,
      sentenceEnd: sentenceAt.includes(index),
      punct: sentenceAt.includes(index),
    };
  });
}

describe("paceSpan", () => {
  it("splits 12 seconds of news into three to five shots inside the band", () => {
    const words = wordsEvery(0.5, 22);
    const cuts = paceSpan({
      startSec: 0,
      endSec: 12,
      cuts: cutCandidates(words, 12),
      beatsSec: [],
      band: paceBand("news", "16:9"),
      guardSec: 0.8,
    });
    const edges = [0, ...cuts, 12];
    expect(edges.length - 1).toBeGreaterThanOrEqual(3);
    expect(edges.length - 1).toBeLessThanOrEqual(5);
    for (let index = 0; index < edges.length - 1; index += 1) {
      const len = edges[index + 1]! - edges[index]!;
      expect(len).toBeGreaterThanOrEqual(1.8);
      expect(len).toBeLessThanOrEqual(5);
    }
    expect(cuts.every((cut) => cut >= 0.8 && cut <= 11.2)).toBe(true);
  });

  it("uses a beat when one is available", () => {
    const words = wordsEvery(0.4, 28);
    const cuts = paceSpan({
      startSec: 0,
      endSec: 12,
      cuts: cutCandidates(words, 12),
      beatsSec: [3, 6, 9],
      band: paceBand("news", "16:9"),
      guardSec: 0.8,
    });
    expect(cuts.some((cut) => [3, 6, 9].some((beat) => Math.abs(cut - beat) <= 0.12))).toBe(true);
  });

  it("prefers a sentence end to a mid-phrase cut", () => {
    const words = wordsEvery(0.5, 16, [5, 11]);
    const withSentence = paceSpan({
      startSec: 0,
      endSec: 10,
      cuts: cutCandidates(words, 10),
      beatsSec: [],
      band: paceBand("news", "16:9"),
      guardSec: 0.8,
    });
    const plain = cutCandidates(words.map((word) => ({ ...word, sentenceEnd: false, punct: false })), 10);
    const without = paceSpan({
      startSec: 0,
      endSec: 10,
      cuts: plain,
      beatsSec: [],
      band: paceBand("news", "16:9"),
      guardSec: 0.8,
    });
    const sentenceCuts = cutCandidates(words, 10).filter((cut) => cut.sentenceEnd).map((cut) => cut.t);
    const used = withSentence.filter((cut) => sentenceCuts.some((at) => Math.abs(at - cut) < 1e-6));
    expect(used.length).toBeGreaterThan(0);
    expect(withSentence).not.toEqual(without);
  });

  it("is deterministic and shortens the band for a vertical frame", () => {
    const input = {
      startSec: 0,
      endSec: 12,
      cuts: cutCandidates(wordsEvery(0.5, 22), 12),
      beatsSec: [4],
      band: paceBand("news", "16:9"),
      guardSec: 0.8,
    };
    expect(paceSpan(input)).toEqual(paceSpan(input));
    expect(paceBand("news", "9:16").target).toBeCloseTo(2.4);
  });
});
