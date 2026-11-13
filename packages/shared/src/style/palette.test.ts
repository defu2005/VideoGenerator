import { describe, expect, it } from "vitest";
import { colorDistance, contrastRatio, parseHex, toHex } from "./color.js";
import { BASE_CONTRAST, checkPalette, resolvePalette, TEXT_CONTRAST } from "./palette.js";

/** Small seeded generator so the random palettes are the same on every run. */
function colors(count: number, seed = 7): string[] {
  let state = seed;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state & 0xff;
  };
  return Array.from({ length: count }, () => toHex([next(), next(), next()]));
}

describe("colour maths", () => {
  it("parses 3 and 6 digit hex and rejects the rest", () => {
    expect(parseHex("#abc")).toEqual([170, 187, 204]);
    expect(parseHex("0F172A")).toEqual([15, 23, 42]);
    expect(parseHex("blue")).toBeNull();
    expect(parseHex(undefined)).toBeNull();
  });

  it("gives the WCAG contrast", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#FFFFFF")).toBeCloseTo(4.48, 2);
    expect(contrastRatio("#123456", "#123456")).toBe(1);
  });

  it("measures colour distance on a 0 to 1 scale", () => {
    expect(colorDistance("#000000", "#FFFFFF")).toBeCloseTo(1, 2);
    expect(colorDistance("#FF0000", "#FF0000")).toBe(0);
    expect(colorDistance("#FF0000", "#FE0505")).toBeLessThan(0.02);
    expect(colorDistance("#FF0000", "#0000FF")).toBeGreaterThan(0.4);
  });
});

describe("resolvePalette", () => {
  it("keeps the TASK-067b look for the default dark seed", () => {
    const roles = resolvePalette({ mode: "dark", brand: "#0F172A", accent: "#F5C518" });
    expect(roles.bg).toBe("#0F172A");
    expect(roles.text).toBe("#FFFFFF");
    expect(roles.accent).toBe("#F5C518");
    expect(roles.onAccent).toBe(roles.bgDeep);
    expect(roles.series).toHaveLength(6);
    expect(roles.series[0]).toBe(roles.accent);
    expect(checkPalette(roles)).toEqual([]);
  });

  it("darkens a light brand in dark mode and lightens a dark brand in light mode, keeping the hue side", () => {
    const dark = resolvePalette({ mode: "dark", brand: "#FFE08A", accent: "#F5C518" });
    expect(contrastRatio(dark.text, dark.bgAlt)).toBeGreaterThanOrEqual(BASE_CONTRAST - 0.05);
    const [r, , b] = parseHex(dark.bg)!;
    expect(r).toBeGreaterThan(b);
    const light = resolvePalette({ mode: "light", brand: "#1E3A8A", accent: "#2563EB" });
    expect(contrastRatio(light.text, light.bgAlt)).toBeGreaterThanOrEqual(BASE_CONTRAST - 0.05);
    const [lr, , lb] = parseHex(light.bg)!;
    expect(lb).toBeGreaterThan(lr);
  });

  it("moves an unreadable accent until it reads on the raised tone", () => {
    const dark = resolvePalette({ mode: "dark", brand: "#0F172A", accent: "#1E293B" });
    expect(contrastRatio(dark.accent, dark.bgAlt)).toBeGreaterThanOrEqual(TEXT_CONTRAST - 0.05);
    const light = resolvePalette({ mode: "light", brand: "#F6F1E7", accent: "#FDE68A" });
    expect(contrastRatio(light.accent, light.bgAlt)).toBeGreaterThanOrEqual(TEXT_CONTRAST - 0.05);
  });

  it("has no contrast issue for any seed, in both modes, with and without a custom ink", () => {
    const pool = colors(240);
    for (let i = 0; i + 3 < pool.length; i += 4) {
      for (const mode of ["dark", "light"] as const) {
        const plain = resolvePalette({ mode, brand: pool[i]!, accent: pool[i + 1]!, accent2: pool[i + 2]! });
        expect(checkPalette(plain), `${mode} ${pool[i]} ${pool[i + 1]}`).toEqual([]);
        const inked = resolvePalette({ mode, brand: pool[i]!, accent: pool[i + 1]!, ink: pool[i + 3]! });
        expect(checkPalette(inked), `${mode} ink ${pool[i + 3]} on ${pool[i]}`).toEqual([]);
      }
    }
  });

  it("reports a palette that was edited by hand into low contrast", () => {
    const roles = { ...resolvePalette({ mode: "dark", brand: "#0F172A", accent: "#F5C518" }), text: "#334155" };
    expect(checkPalette(roles).map((issue) => issue.pair)).toContain("text/bg");
  });
});
