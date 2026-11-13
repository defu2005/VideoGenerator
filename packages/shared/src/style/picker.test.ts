import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { axisChoices, BACKGROUND_AXIS, homeSize, TEMPLATE_MANIFESTS, templateImportProblems, TemplateManifestSchema, templateTokenLint, type TemplateManifest } from "./axes.js";
import { applyVariantChoices, lookHistoryEntry, pickVariants, variantKey, variantOptions, type LookHistory, type VariantInput } from "./picker.js";
import { BASE_STYLE_TOKENS, mergeStyleTokens, type StyleTokens } from "./tokens.js";

/** Templates on contract tokens-v1. TASK-110 appends each one as it is converted. */
const CONVERTED = ["list_full", "compare", "quote_full", "kinetic_text", "chart", "map"] as const;

const open: StyleTokens = mergeStyleTokens(BASE_STYLE_TOKENS, {
  motion: { entrances: ["slide", "rise", "scale", "fade"] },
  background: { treatments: ["glow", "beam", "shapes", "flat", "grid"] },
  layout: { family: "centered" },
  consistency: 0,
});

function input(patch: Partial<VariantInput> = {}): VariantInput {
  return {
    seed: "channel-a|video-1",
    shots: Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, templateId: "list_full" })),
    tokens: open,
    aspect: "16:9",
    packSeed: "channel-a",
    ...patch,
  };
}

const LIST = TEMPLATE_MANIFESTS.list_full!;
const axis = (id: string) => LIST.axes.find((item) => item.id === id)!;

describe("template manifests", () => {
  it("are valid, and every template carries the shared background axis", () => {
    for (const manifest of Object.values(TEMPLATE_MANIFESTS)) {
      expect(TemplateManifestSchema.parse(manifest)).toEqual(manifest);
      expect(manifest.axes.some((item) => item.id === "background")).toBe(true);
    }
    expect(LIST.contract).toBe("tokens-v1");
    for (const id of CONVERTED) {
      const manifest = TEMPLATE_MANIFESTS[id]!;
      expect(manifest.contract, id).toBe("tokens-v1");
      expect(manifest.version, id).toBe(2);
      const own = manifest.axes.filter((item) => !item.shared && item.role !== "content" && item.values.length >= 2);
      expect(own.length, id).toBeGreaterThanOrEqual(1);
      expect(manifest.axes.some((item) => item.id === "entrance"), id).toBe(true);
      expect(manifest.axes.some((item) => item.id === "background"), id).toBe(true);
    }
  });

  it("rejects a manifest with a duplicate axis", () => {
    expect(TemplateManifestSchema.safeParse({ ...LIST, axes: [BACKGROUND_AXIS, BACKGROUND_AXIS] }).success).toBe(false);
  });
});

describe("axisChoices", () => {
  const ctx = (tokens: StyleTokens, packSeed = "p") => ({ tokens, aspect: "16:9" as const, packSeed });

  it("keeps only the values that suit the layout family", () => {
    const editorial = mergeStyleTokens(open, { layout: { family: "editorial" } });
    expect(axisChoices(LIST, axis("layout"), ctx(editorial)).values).toEqual(["rows", "rail"]);
    expect(axisChoices(LIST, axis("title"), ctx(editorial)).values).toEqual(["bar", "underline"]);
    const poster = mergeStyleTokens(open, { layout: { family: "poster" } });
    expect(axisChoices(LIST, axis("layout"), ctx(poster)).values).toEqual(["rows", "cards"]);
  });

  it("takes entrances and backgrounds from the style tokens", () => {
    const tokens = mergeStyleTokens(open, { motion: { entrances: ["fade", "rise"] }, background: { treatments: ["grid"] } });
    expect(axisChoices(LIST, axis("entrance"), ctx(tokens)).values).toEqual(["fade", "rise"]);
    expect(axisChoices(LIST, axis("background"), ctx(tokens)).values).toEqual(["grid"]);
  });

  it("narrows signature axes to the channel's home values", () => {
    expect(homeSize(5, 1)).toBe(1);
    expect(homeSize(5, 0)).toBe(5);
    expect(homeSize(5, 0.6)).toBe(3);
    const strict = mergeStyleTokens(open, { consistency: 1 });
    const homes = new Set<string>();
    for (let i = 0; i < 24; i += 1) {
      const { values } = axisChoices(LIST, axis("background"), ctx(strict, `channel-${i}`));
      expect(values).toHaveLength(1);
      homes.add(values[0]!);
      // The home is the same in every template, because the axis is shared.
      expect(axisChoices(TEMPLATE_MANIFESTS.chart!, BACKGROUND_AXIS, ctx(strict, `channel-${i}`)).values).toEqual(values);
    }
    // Different channels settle on different homes.
    expect(homes.size).toBeGreaterThanOrEqual(3);
    // Non-signature axes are not narrowed.
    expect(axisChoices(LIST, axis("layout"), ctx(strict)).values).toEqual(["rows", "cards", "rail"]);
  });

  it("keeps compare's side-by-side layout off tall frames", () => {
    const manifest = TEMPLATE_MANIFESTS.compare!;
    const layout = manifest.axes.find((item) => item.id === "layout")!;
    expect(axisChoices(manifest, layout, { tokens: open, aspect: "9:16", packSeed: "p" }).values).toEqual(["stack"]);
    expect(axisChoices(manifest, layout, { tokens: open, aspect: "16:9", packSeed: "p" }).values).toEqual(["split", "stack"]);
  });

  it("relaxes a step instead of returning nothing", () => {
    const manifest: TemplateManifest = { ...LIST, axes: [{ id: "layout", role: "layout", values: [{ id: "wide_only", aspects: ["16:9"] }], signature: false, shared: false }] };
    const result = axisChoices(manifest, manifest.axes[0]!, { tokens: open, aspect: "9:16", packSeed: "p" });
    expect(result).toEqual({ values: ["wide_only"], relaxed: ["fit"] });
  });
});

describe("pickVariants", () => {
  it("is deterministic and changes with the seed", () => {
    const first = pickVariants(input());
    expect(pickVariants(input())).toEqual(first);
    const other = pickVariants(input({ seed: "channel-a|video-2" }));
    expect(other.map((pick) => pick.key)).not.toEqual(first.map((pick) => pick.key));
  });

  it("only uses values the channel's style allows", () => {
    const tokens = mergeStyleTokens(open, { layout: { family: "editorial" }, motion: { entrances: ["rise"] }, background: { treatments: ["flat", "grid"] } });
    for (const pick of pickVariants(input({ tokens }))) {
      expect(["rows", "rail"]).toContain(pick.axes.layout);
      expect(["bar", "underline"]).toContain(pick.axes.title);
      expect(pick.axes.entrance).toBe("rise");
      expect(["flat", "grid"]).toContain(pick.axes.background);
      expect(pick.key).toBe(variantKey(pick.axes));
      expect(pick.relaxed).toEqual([]);
    }
  });

  it("does not repeat a combination inside a video while fresh ones exist, and varies neighbours", () => {
    const picks = pickVariants(input());
    expect(new Set(picks.map((pick) => pick.key)).size).toBe(picks.length);
    for (let i = 1; i < picks.length; i += 1) {
      expect(picks[i]!.axes.layout === picks[i - 1]!.axes.layout && picks[i]!.axes.background === picks[i - 1]!.axes.background).toBe(false);
    }
  });

  it("never reuses a combination from the last N videos while an unused one exists", () => {
    const history: LookHistory = { videos: [] };
    const seen: string[][] = [];
    for (let video = 0; video < 12; video += 1) {
      const picks = pickVariants(input({ seed: `channel-a|video-${video}`, shots: [{ id: "s0", templateId: "list_full" }, { id: "s1", templateId: "list_full" }], history, window: 5 }));
      const recent = new Set(seen.slice(-5).flat());
      for (const pick of picks) {
        expect(pick.reused).toBe(false);
        expect(recent.has(pick.key), `video ${video} reused ${pick.key}`).toBe(false);
      }
      seen.push(picks.map((pick) => pick.key));
      history.videos.unshift(lookHistoryEntry(`video-${video}`, picks));
    }
  });

  it("falls back to the least recently used combination when all were used, and says so", () => {
    const tokens = mergeStyleTokens(open, { layout: { family: "editorial" }, motion: { entrances: ["slide"] }, background: { treatments: ["flat"] }, consistency: 1 });
    const shots = [{ id: "s0", templateId: "list_full", pinned: { highlight: "bar", marker: "number" } }];
    // editorial: 2 layouts × 2 titles = 4 combinations in all.
    const history: LookHistory = { videos: [] };
    const keys: string[] = [];
    for (let video = 0; video < 6; video += 1) {
      const [pick] = pickVariants(input({ seed: `c|v${video}`, tokens, shots, history, window: 5 }));
      keys.push(pick!.key);
      expect(pick!.reused).toBe(video >= 4);
      history.videos.unshift(lookHistoryEntry(`v${video}`, [pick!]));
    }
    expect(new Set(keys.slice(0, 4)).size).toBe(4);
    // The fifth video takes the one used longest ago.
    expect(keys[4]).toBe(keys[0]);
    expect(keys[5]).toBe(keys[1]);
  });

  it("keeps pinned values, even ones outside the channel's style", () => {
    const tokens = mergeStyleTokens(open, { layout: { family: "editorial" }, background: { treatments: ["flat"] } });
    const picks = pickVariants(input({ tokens, shots: [{ id: "s0", templateId: "list_full", pinned: { layout: "cards", background: "glow", highlight: "pop", bogus: "x", title: "nope" } }] }));
    expect(picks[0]!.axes).toMatchObject({ layout: "cards", background: "glow", highlight: "pop" });
    expect(["bar", "underline"]).toContain(picks[0]!.axes.title);
    expect("bogus" in picks[0]!.axes).toBe(false);
  });

  it("gives legacy templates a background only, and an unknown template nothing", () => {
    const legacyCard: TemplateManifest = {
      id: "legacy_card",
      kind: "legacy_card",
      version: 1,
      contract: "legacy",
      axes: [BACKGROUND_AXIS],
      attribution: { origin: "own" },
    };
    const picks = pickVariants(input({
      shots: [{ id: "a", templateId: "legacy_card" }, { id: "b", templateId: "nope" }],
      manifests: { legacy_card: legacyCard },
    }));
    expect(Object.keys(picks[0]!.axes)).toEqual(["background"]);
    expect(picks[1]).toMatchObject({ axes: {}, key: "", relaxed: ["manifest"] });
  });

  it("holds a channel to its brand band across many videos", () => {
    const tokens = mergeStyleTokens(open, { consistency: 1 });
    const backgrounds = new Set<string>();
    const entrances = new Set<string>();
    const layouts = new Set<string>();
    const history: LookHistory = { videos: [] };
    for (let video = 0; video < 10; video += 1) {
      const picks = pickVariants(input({ seed: `c|v${video}`, tokens, history }));
      for (const pick of picks) {
        backgrounds.add(pick.axes.background!);
        entrances.add(pick.axes.entrance!);
        layouts.add(pick.axes.layout!);
      }
      history.videos.unshift(lookHistoryEntry(`v${video}`, picks));
    }
    expect(backgrounds.size).toBe(1);
    expect(entrances.size).toBe(1);
    expect(layouts.size).toBe(3);
  });
});

describe("LLM choice among valid variants", () => {
  it("offers the rule pick first and only fresh combinations", () => {
    const history: LookHistory = { videos: [lookHistoryEntry("old", pickVariants(input({ seed: "c|old" })))] };
    const used = new Set(history.videos[0]!.combos.map((combo) => combo.key));
    const picks = pickVariants(input({ history }));
    const options = variantOptions(input({ history }), 4);
    options.forEach((item, index) => {
      expect(item.options[0]!.key).toBe(picks[index]!.key);
      expect(item.options.length).toBeLessThanOrEqual(4);
      for (const option of item.options) expect(used.has(option.key)).toBe(false);
    });
  });

  it("accepts an offered option and ignores anything else", () => {
    const picks = pickVariants(input());
    const options = variantOptions(input(), 3);
    const wanted = options[0]!.options[2]!;
    const next = applyVariantChoices(picks, options, { s0: wanted.key, s1: "layout=made_up", s2: 42, zz: "x" });
    expect(next[0]).toMatchObject({ key: wanted.key, axes: wanted.axes });
    expect(next.slice(1)).toEqual(picks.slice(1));
  });
});

describe("import gate and token lint", () => {
  const third: unknown = {
    id: "stat_tiles",
    kind: "chart",
    version: 1,
    contract: "tokens-v1",
    axes: [{ id: "layout", role: "layout", values: [{ id: "row" }, { id: "stack" }] }, BACKGROUND_AXIS],
    attribution: { origin: "third_party", name: "Stat tiles", author: "Someone", license: "Apache-2.0", sourceUrl: "https://github.com/heygen-com/hyperframes", commit: "abc1234" },
  };

  it("passes a third-party template with tokens, axes and attribution", () => {
    expect(templateImportProblems(third)).toEqual([]);
  });

  it("names every missing requirement", () => {
    const bad = { ...(third as object), contract: "legacy", axes: [BACKGROUND_AXIS], attribution: { origin: "third_party", license: "GPL-3.0" } };
    const problems = templateImportProblems(bad);
    expect(problems).toHaveLength(6);
    expect(problems.join(" ")).toMatch(/tokens-v1/);
    expect(problems.join(" ")).toMatch(/Giấy phép/);
    expect(templateImportProblems({ id: "x" }).length).toBeGreaterThan(0);
  });

  it("finds fixed values in a template and passes a tokenised one", () => {
    const fixed = '<style>.t{font-weight:700;color:#F5C518;font-size:42px}</style>\n<script>tl.from(a, { opacity: 0, duration: 0.3, ease: "power2.out" }, at(0, 0.3));</script>';
    expect(templateTokenLint(fixed)).toHaveLength(5);
    const tokenised = "<style>.t{font-weight:var(--vg-w-display)}</style>\n<script>tl.from(a, { opacity: 0, duration: M.base, ease: M.enter }, at(0, M.base));</script>";
    expect(templateTokenLint(tokenised)).toEqual([]);
  });

  it("passes every converted template file", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "apps", "server", "assets", "compose");
    for (const id of CONVERTED) {
      const html = readFileSync(join(root, id, "index.html"), "utf8");
      expect(templateTokenLint(html), id).toEqual([]);
    }
  });
});
