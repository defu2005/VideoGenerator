import { describe, expect, it } from "vitest";
import { cuesWithoutTimings, splitCue, toAss, toSrt, wrapLines } from "../src/subtitles/index.js";

describe("subtitle helpers", () => {
  it("wraps text in balanced 2-line blocks without losing text", () => {
    const wrapped = wrapLines("Câu văn dài để test wrap line", 12, 2);
    expect(wrapped).toHaveLength(2);
    expect(wrapped.join(" ")).toBe("Câu văn dài để test wrap line");
    expect(wrapped.every((line) => line.length <= 18)).toBe(true);
  });

  it("splits a long cue without breaking a word", () => {
    const cue = { startSec: 0.5, endSec: 6.6, text: "Tôi đang xem một đoạn rất dài để kiểm tra cách tách câu và không bị cắt giữa từ trong một câu cực dài hơn nữa cho phụ đề." };
    const result = splitCue(cue, { aspectRatio: "16:9", maxCharsPerLine: 42, maxLines: 2 });
    expect(result.length).toBeGreaterThan(1);
    expect(result.map((item) => item.text).join(" ")).toBe(cue.text);
    for (const item of result) {
      expect(item.text).not.toContain("  ");
      expect(item.startSec).toBeLessThanOrEqual(item.endSec);
      expect(item.endSec - item.startSec).toBeGreaterThanOrEqual(0.1);
    }
    expect(result[0].startSec).toBe(0.5);
    expect(result.at(-1)?.endSec).toBe(6.6);
  });

  it("builds timed cues for narration without voice timings", () => {
    const cues = cuesWithoutTimings("Đây là câu đầu. Đây là câu thứ hai.", 4, { aspectRatio: "16:9" });
    expect(cues.length).toBeGreaterThan(0);
    expect(cues[0].startSec).toBe(0);
    expect(cues.at(-1)?.endSec).toBe(4);
  });

  it("serializes SRT and ASS output", () => {
    const cues = [{ startSec: 1, endSec: 3, text: "Hello world" }];
    expect(toSrt(cues)).toContain("1\n00:00:01,000 --> 00:00:03,000\nHello world\n");
    const ass = toAss(cues, { aspectRatio: "16:9" });
    expect(ass).toContain("[V4+ Styles]");
    expect(ass).toContain("WrapStyle: 2");
    expect(ass).toContain("Hello world");
  });

  it("falls back to a scaled ASS font size when a zero size is provided", () => {
    const ass = toAss([{ startSec: 1, endSec: 3, text: "Hello world" }], { aspectRatio: "9:16", fontSize: 0 });
    const match = ass.match(/Style: Default,Arial,(\d+),&H00FFFFFF/);
    expect(match).not.toBeNull();
    expect(Number(match?.[1] ?? "0")).toBeGreaterThan(0);
    expect(Number(match?.[1] ?? "0")).not.toBe(0);
  });
});
