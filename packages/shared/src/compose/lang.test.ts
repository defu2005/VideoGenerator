import { describe, expect, it } from "vitest";
import { DIGITS_ONLY, getLangPack } from "./lang/index.js";

describe("language packs", () => {
  it("resolves vi-VN, EN, an unknown code and an empty code", () => {
    expect(getLangPack("vi-VN").code).toBe("vi");
    expect(getLangPack("EN").code).toBe("en");
    expect(getLangPack("fr")).toBe(DIGITS_ONLY);
    expect(getLangPack("")).toBe(DIGITS_ONLY);
    expect(getLangPack(null)).toBe(DIGITS_ONLY);
    expect(getLangPack(undefined).decimalSep).toBe(".");
    expect(getLangPack("fr").thousandSep).toBe(",");
    for (const list of [
      DIGITS_ONLY.percentWords,
      DIGITS_ONLY.yearMarkers,
      DIGITS_ONLY.ordinals,
      DIGITS_ONLY.contrastWords,
      DIGITS_ONLY.quoteMarks,
      DIGITS_ONLY.timesWords.before,
      DIGITS_ONLY.timesWords.after,
    ]) {
      expect(list).toEqual([]);
    }
    expect(DIGITS_ONLY.scaleWords).toEqual({});
  });
});
