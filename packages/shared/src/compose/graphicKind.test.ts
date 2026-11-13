import { describe, expect, it } from "vitest";
import { ComposeStatsSchema } from "./schema.js";
import {
  applyGraphicTiming,
  fitGraphicPayload,
  graphicDurationBounds,
  quoteWords,
  shotVariantParams,
} from "./graphicKind.js";

const QUOTE = "Đầu tư vào tri thức luôn mang lại lợi nhuận cao nhất";

describe("fitGraphicPayload", () => {
  it("accepts a map with a focus and rejects one with nothing to draw", () => {
    expect(fitGraphicPayload("map", { focus: "VN", zoom: "fly" })).toMatchObject({ kind: "map", focus: "VN", zoom: "fly" });
    expect(fitGraphicPayload("map", { label: "Việt Nam" })).toBeNull();
    expect(fitGraphicPayload("map", { focus: "VN", label: "x".repeat(41) })).toBeNull();
    expect(fitGraphicPayload("map", { focus: "VN", sublabel: "x".repeat(31) })).toBeNull();
  });

  it("rejects a compare side that is too long and an empty badge is kept off the payload", () => {
    expect(fitGraphicPayload("compare", {
      left: { label: "Thuê nhà", text: "8 triệu mỗi tháng" },
      right: { label: "Mua nhà", text: "15 triệu mỗi tháng" },
      style: "versus",
    })).toMatchObject({ style: "versus" });
    expect(fitGraphicPayload("compare", {
      left: { label: "x".repeat(17), text: "a" },
      right: { label: "B", text: "b" },
    })).toBeNull();
    expect(fitGraphicPayload("compare", {
      left: { label: "A", text: "x".repeat(41) },
      right: { label: "B", text: "b" },
    })).toBeNull();
    expect(fitGraphicPayload("compare", {
      left: { label: "A", text: "a" },
      right: { label: "B", text: "b" },
      badge: "ABCD",
    })).toBeNull();
  });

  it("keeps a quote of 6 to 28 words and drops the rest", () => {
    expect(quoteWords(QUOTE)).toHaveLength(12);
    expect(fitGraphicPayload("quote_full", { quote: QUOTE, speaker: "Benjamin Franklin", emphasis: [3, 4], reveal: "ghost" })).toMatchObject({ reveal: "ghost" });
    expect(fitGraphicPayload("quote_full", { quote: "Chỉ năm từ thôi mà" })).toBeNull();
    expect(fitGraphicPayload("quote_full", { quote: Array.from({ length: 29 }, () => "từ").join(" ") })).toBeNull();
    expect(fitGraphicPayload("quote_full", { quote: QUOTE, emphasis: [0, 1, 2, 3] })).toBeNull();
  });

  it("drops a seventh list item and rejects fewer than three", () => {
    const items = ["Một", "Hai", "Ba", "Bốn", "Năm", "Sáu", "Bảy"];
    const fitted = fitGraphicPayload("list_full", { items, title: "Việc" });
    expect(fitted && fitted.kind === "list_full" ? fitted.items : []).toEqual(items.slice(0, 6));
    expect(fitGraphicPayload("list_full", { items: ["Một", "Hai"] })).toBeNull();
    expect(fitGraphicPayload("list_full", { items: ["Một", "Hai", "x".repeat(37)] })).toBeNull();
    expect(fitGraphicPayload("list_full", { items: ["Một", "Hai", "Ba"], title: "x".repeat(41) })).toBeNull();
  });
});

describe("graphic timing and variants", () => {
  it("stamps the contrast word, the quote and each list item from the spoken words", () => {
    const compare = applyGraphicTiming(
      { kind: "compare" as const, left: { label: "A", text: "một" }, right: { label: "B", text: "hai" } },
      [{ text: "Trước", startSec: 1 }, { text: "nhưng", startSec: 2.4 }, { text: "sau", startSec: 3 }],
      1,
      4,
      "vi",
    );
    expect(compare.rightAt).toBeCloseTo(1.4);

    const quote = applyGraphicTiming(
      { kind: "quote_full" as const, quote: "Một hai ba bốn năm sáu" },
      ["Một", "hai", "ba", "bốn", "năm", "sáu"].map((text, index) => ({ text, startSec: index * 0.4 })),
      0,
      4,
      "vi",
    );
    expect(quote.wordTimes).toEqual([0, 0.4, 0.8, 1.2, 1.6, 2]);

    const list = applyGraphicTiming(
      { kind: "list_full" as const, items: ["Uống nước", "Đi bộ", "Ngủ sớm"] },
      [
        { text: "Uống", startSec: 0.4 }, { text: "nước", startSec: 0.7 },
        { text: "Đi", startSec: 1.8 }, { text: "bộ", startSec: 2 },
        { text: "Ngủ", startSec: 3.1 }, { text: "sớm", startSec: 3.4 },
      ],
      0,
      5,
      "vi",
    );
    expect(list.itemTimes).toEqual([0.4, 1.8, 3.1]);
  });

  it("records the variant fields the learning loop compares", () => {
    expect(shotVariantParams({
      id: "m",
      kind: "map",
      source: { kind: "map", zoom: "fly", highlight: "glow", neighbours: false, sublabel: "Đông Nam Á", from: "VN" },
    }).params).toEqual({ zoom: "fly", highlight: "glow", neighbours: false, sublabel: true, from: "VN" });
    expect(shotVariantParams({
      id: "q",
      kind: "quote_full",
      source: { kind: "quote_full", reveal: "appear", emphasis: [1], role: "Nhà khoa học" },
    }).params).toEqual({ reveal: "appear", emphasis: true, role: true });
    expect(graphicDurationBounds("list_full", { items: [1, 2, 3, 4, 5, 6] })?.min).toBeCloseTo(5.6);
    expect(graphicDurationBounds("list_full", { items: [1, 2, 3, 4, 5, 6] })?.max).toBe(12);
    expect(graphicDurationBounds("compare", { reveal: "together" })).toEqual({ min: 2, max: 6 });
    expect(graphicDurationBounds("map")).toEqual({ min: 2.5, max: 7 });
  });

  it("still parses a plan saved before these kinds existed", () => {
    const stats = ComposeStatsSchema.parse({
      shotsPerMin: 1, meanShotSec: 1, stdevShotSec: 0,
      kindShare: { still: 1, footage: 0, kinetic_text: 0, chart: 0 },
      kindEntropyBits: 0, maxSameKindRun: 1, wordGapCutPct: 1, beatCutPct: null,
    });
    expect(stats.kindShare.map).toBe(0);
    expect(stats.shotVariants).toEqual([]);
  });
});
