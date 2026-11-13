import { describe, expect, it } from "vitest";
import { getLangPack } from "./lang/index.js";
import { comparableGroups, findContrastWord, parseNumbers, startsWithOrdinal, type NumberMention } from "./numbers.js";

const vi = getLangPack("vi");
const en = getLangPack("en");
const digits = getLangPack("fr");

function one(words: string[], lang = vi) {
  const mentions = parseNumbers(words, lang);
  expect(mentions).toHaveLength(1);
  return mentions[0]!;
}

describe("vietnamese numbers", () => {
  it("reads 1,5 triệu", () => {
    expect(one(["1,5", "triệu"])).toMatchObject({ value: 1_500_000, unit: "count", raw: "1,5 triệu" });
  });

  it("reads 1.500 as thousands", () => {
    expect(one(["1.500"]).value).toBe(1500);
  });

  it("reads 1.500.000 as thousands", () => {
    expect(one(["1.500.000"]).value).toBe(1_500_000);
  });

  it("reads 20%", () => {
    expect(one(["20%"])).toMatchObject({ value: 20, unit: "percent" });
  });

  it("reads 20 phần trăm", () => {
    expect(one(["20", "phần", "trăm"])).toMatchObject({ value: 20, unit: "percent", wordEnd: 3 });
  });

  it("reads gấp 3 lần", () => {
    expect(one(["gấp", "3", "lần"])).toMatchObject({ value: 3, unit: "times", wordStart: 0, wordEnd: 3 });
  });

  it("reads năm 2020", () => {
    expect(one(["năm", "2020"])).toMatchObject({ value: 2020, unit: "year", raw: "năm 2020" });
  });

  it("reads 2 tỷ đồng", () => {
    expect(one(["2", "tỷ", "đồng"])).toMatchObject({ value: 2_000_000_000, unit: "cur:vnd" });
  });

  it("reads 3 nghìn người", () => {
    expect(one(["3", "nghìn", "người"])).toMatchObject({ value: 3000, unit: "word:người" });
  });

  it("reads 5 ngàn", () => {
    expect(one(["5", "ngàn"])).toMatchObject({ value: 5000, unit: "count" });
  });

  it("reads 100 USD", () => {
    expect(one(["100", "USD"])).toMatchObject({ value: 100, unit: "cur:usd", raw: "100 USD" });
  });

  it("reads 1,5 with a trailing comma", () => {
    expect(one(["1,5,"])).toMatchObject({ value: 1.5, unit: "count", raw: "1,5," });
  });

  it("reads a year alone", () => {
    expect(one(["2020"])).toMatchObject({ value: 2020, unit: "year" });
  });

  it("groups a sentence with three increasing years as a line", () => {
    const mentions = parseNumbers(
      ["Năm", "2020", "có", "10", "người,", "năm", "2021", "có", "20", "người,", "năm", "2022", "có", "30", "người"],
      vi,
    );
    expect(mentions.map((mention) => mention.value)).toEqual([2020, 10, 2021, 20, 2022, 30]);
    const groups = comparableGroups(mentions);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      kind: "series",
      chart: "line",
      unit: "word:người",
      items: [
        { value: 10, year: 2020 },
        { value: 20, year: 2021 },
        { value: 30, year: 2022 },
      ],
    });
  });
});

describe("english numbers", () => {
  it("reads 1.5 million", () => {
    expect(one(["1.5", "million"], en)).toMatchObject({ value: 1_500_000, unit: "count" });
  });

  it("reads 1,500", () => {
    expect(one(["1,500"], en).value).toBe(1500);
  });

  it("reads 1.500 as a decimal", () => {
    expect(one(["1.500"], en).value).toBe(1.5);
  });

  it("reads 20 percent", () => {
    expect(one(["20", "percent"], en)).toMatchObject({ value: 20, unit: "percent" });
  });

  it("reads 3 times", () => {
    expect(one(["3", "times"], en)).toMatchObject({ value: 3, unit: "times" });
  });

  it("reads in 2020", () => {
    expect(one(["in", "2020"], en)).toMatchObject({ value: 2020, unit: "year", raw: "in 2020" });
  });

  it("reads 2 billion", () => {
    expect(one(["2", "billion"], en).value).toBe(2_000_000_000);
  });

  it("reads $100", () => {
    expect(one(["$100"], en)).toMatchObject({ value: 100, unit: "cur:usd" });
  });

  it("reads 3k", () => {
    expect(one(["3k"], en)).toMatchObject({ value: 3000, unit: "count" });
  });
});

describe("digits-only fallback", () => {
  it("reads symbols and separators but not scale words", () => {
    expect(one(["20%"], digits)).toMatchObject({ value: 20, unit: "percent" });
    expect(one(["2020"], digits)).toMatchObject({ value: 2020, unit: "year" });
    expect(one(["1.5"], digits).value).toBe(1.5);
    expect(one(["1,500"], digits).value).toBe(1500);
    expect(one(["1.5", "million"], digits)).toMatchObject({ value: 1.5, unit: "word:million" });
  });
});

describe("number groups", () => {
  function mention(value: number, unit: NumberMention["unit"], start: number): NumberMention {
    return { value, unit, raw: String(value), wordStart: start, wordEnd: start + 1 };
  }

  it("turns shares near 100 into a pie and shares far from 100 into a bar", () => {
    const near = comparableGroups([mention(60, "percent", 0), mention(40, "percent", 2)]);
    expect(near).toHaveLength(1);
    expect(near[0]).toMatchObject({ kind: "shares", chart: "pie" });
    const far = comparableGroups([mention(10, "percent", 0), mention(20, "percent", 2)]);
    expect(far).toHaveLength(1);
    expect(far[0]).toMatchObject({ kind: "same_unit", chart: "bar", unit: "percent" });
  });

  it("makes no group for one mention or mixed units", () => {
    expect(comparableGroups([mention(10, "count", 0)])).toEqual([]);
    expect(comparableGroups([mention(10, "count", 0), mention(20, "word:đồng", 2)])).toEqual([]);
  });

  it("keeps a mention in one group", () => {
    const mentions: NumberMention[] = [
      { value: 2020, unit: "year", raw: "năm 2020", wordStart: 0, wordEnd: 2 },
      { value: 40, unit: "percent", raw: "40%", wordStart: 3, wordEnd: 4 },
      { value: 2021, unit: "year", raw: "năm 2021", wordStart: 5, wordEnd: 7 },
      { value: 60, unit: "percent", raw: "60%", wordStart: 8, wordEnd: 9 },
    ];
    const groups = comparableGroups(mentions);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.kind).toBe("series");
    const used = new Set(groups.flatMap((group) => group.items.map((item) => item.mentionIndex)));
    expect(used.size).toBe(groups.reduce((sum, group) => sum + group.items.length, 0));
  });
});

describe("ordinals and contrast", () => {
  it("matches an ordinal only at the start", () => {
    expect(startsWithOrdinal(["Thứ", "nhất,"], vi)).toBe(true);
    expect(startsWithOrdinal(["Số", "1"], vi)).toBe(true);
    expect(startsWithOrdinal(["1."], vi)).toBe(true);
    expect(startsWithOrdinal(["First,"], en)).toBe(true);
    expect(startsWithOrdinal(["Number", "1"], en)).toBe(true);
    expect(startsWithOrdinal(["xin", "thứ", "nhất"], vi)).toBe(false);
    expect(startsWithOrdinal(["2)"], digits)).toBe(true);
  });

  it("finds contrast words", () => {
    expect(findContrastWord(["đúng", "nhưng", "sai"], vi)).toEqual({ word: "nhưng", index: 1 });
    expect(findContrastWord(["Thực", "ra", "không"], vi)?.word).toBe("thực ra");
    expect(findContrastWord(["ok", "but", "no"], en)).toMatchObject({ word: "but", index: 1 });
    expect(findContrastWord(["yes", "in", "fact", "no"], en)).toEqual({ word: "in fact", index: 1 });
  });
});
