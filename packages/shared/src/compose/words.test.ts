import { describe, expect, it } from "vitest";
import { cutCandidates, sceneWords } from "./words.js";

const scene = { durationSec: 5 };

describe("sceneWords", () => {
  it("shifts provider words by the voice lead and keeps punctuation", () => {
    const result = sceneWords(scene, {
      timingSource: "provider",
      words: [
        { startSec: 0, endSec: 0.4, text: "Xin" },
        { startSec: 0.4, endSec: 0.9, text: "chào." },
      ],
      cues: [],
    });
    expect(result.source).toBe("provider");
    expect(result.words[0]).toMatchObject({ startSec: 0.1, endSec: 0.5, sentenceEnd: false, punct: false });
    expect(result.words[1]).toMatchObject({ text: "chào.", sentenceEnd: true, punct: true });
  });

  it("spreads cue words evenly when the provider gave no words", () => {
    const result = sceneWords(scene, {
      words: [],
      cues: [{ startSec: 0, endSec: 2, text: "một hai ba" }],
    });
    expect(result.source).toBe("estimated");
    expect(result.words.map((word) => word.text)).toEqual(["một", "hai", "ba"]);
    expect(result.words[0]?.startSec).toBeCloseTo(0.1);
    expect(result.words[2]?.endSec).toBeCloseTo(2.1);
  });

  it("keeps Vietnamese diacritics and clamps past the scene", () => {
    const result = sceneWords(scene, {
      words: [{ startSec: 4.8, endSec: 6, text: "tiếng," }],
      cues: [],
    });
    expect(result.words[0]?.text).toBe("tiếng,");
    expect(result.words[0]?.punct).toBe(true);
    expect(result.words[0]?.endSec).toBe(5);
  });

  it("returns nothing when there are no cues", () => {
    expect(sceneWords(scene, null)).toEqual({ words: [], source: "none" });
  });

  it("places a candidate in a gap shorter than 40ms", () => {
    const words = sceneWords(scene, {
      words: [
        { startSec: 0, endSec: 0.2, text: "a" },
        { startSec: 0.22, endSec: 0.4, text: "b" },
      ],
      cues: [],
    }).words;
    const cuts = cutCandidates(words, scene.durationSec);
    expect(cuts[0]?.t).toBe(0);
    expect(cuts.at(-1)?.t).toBe(5);
    expect(cuts[1]?.t).toBeCloseTo(0.31);
    expect(cuts[1]?.gapSec).toBeCloseTo(0.02);
  });
});
