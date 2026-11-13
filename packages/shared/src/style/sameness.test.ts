import { describe, expect, it } from "vitest";
import { hashToHex } from "../visuals/phash.js";
import { stylePackFromChoices } from "./pack.js";
import { lookHistoryEntry, pickVariants, type LookHistory } from "./picker.js";
import { resolveStyle } from "./resolve.js";
import {
  buildVideoLook,
  comboSimilarity,
  compareVisualSameness,
  frameSimilarity,
  kindSimilarity,
  styleSimilarity,
  visualSameness,
  visualSamenessIssues,
  type VideoLook,
} from "./sameness.js";

const WIDE = { width: 1920, height: 1080 };
const classic = resolveStyle({ pack: stylePackFromChoices({ id: "a", name: "A", presetId: "classic" }) }, WIDE);
const paper = resolveStyle({ pack: stylePackFromChoices({ id: "b", name: "B", presetId: "paper" }) }, WIDE);

/** Frame hashes with a chosen number of bits flipped from a base pattern. */
function frames(base: bigint, flips: number[]): string[] {
  const masks = [0n, 0xffff000000000000n, 0x0000ffff00000000n, 0xffffffff00000000n];
  return flips.map((count, index) => {
    let hash = base ^ masks[index % masks.length]!;
    for (let bit = 0; bit < count; bit += 1) hash ^= 1n << BigInt(bit);
    return hashToHex(hash & 0xffffffffffffffffn);
  });
}

function look(patch: Partial<VideoLook> & { videoId: string }, style = classic): VideoLook {
  return {
    channelId: "ch-a",
    createdAt: "2026-11-12T00:00:00.000Z",
    style: {
      packId: style.packId,
      packVersion: style.packVersion,
      fingerprint: style.fingerprint,
      palette: [style.color.bg, style.color.accent, style.color.text],
      fonts: [style.font.display.id, style.font.body.id],
      layout: style.layout.family,
      ease: style.tokens.motion.ease,
      caseDisplay: style.type.caseDisplay,
      backgrounds: ["glow"],
    },
    combos: [
      { templateId: "list_full", key: "layout=rows", sec: 6 },
      { templateId: "chart", key: "background=glow", sec: 4 },
    ],
    kindShare: { still: 0.5, footage: 0.3, list_full: 0.12, chart: 0.08 },
    frameHashes: frames(0x0f0f0f0f0f0f0f0fn, [0, 0, 0, 0]),
    ...patch,
  };
}

describe("sameness parts", () => {
  it("scores identical videos 1 and unrelated ones near 0", () => {
    const a = look({ videoId: "v1" });
    expect(visualSameness(a, look({ videoId: "v2" }), "channel").score).toBeCloseTo(1, 5);
    const b = look({
      videoId: "v3",
      combos: [{ templateId: "compare", key: "background=grid", sec: 5 }],
      kindShare: { footage: 0.9, compare: 0.1 },
      frameHashes: frames(0xf0f0f0f0f0f0f0f0n, [0, 0, 0]),
    });
    expect(visualSameness(a, b, "channel").score).toBeLessThan(0.1);
  });

  it("weights combinations by screen time", () => {
    const a = look({ videoId: "v1" });
    const mostly = look({ videoId: "v2", combos: [{ templateId: "list_full", key: "layout=rows", sec: 9 }, { templateId: "chart", key: "background=beam", sec: 1 }] });
    const barely = look({ videoId: "v3", combos: [{ templateId: "list_full", key: "layout=rows", sec: 1 }, { templateId: "chart", key: "background=beam", sec: 9 }] });
    expect(comboSimilarity(a, mostly)!).toBeGreaterThan(comboSimilarity(a, barely)!);
    expect(comboSimilarity(look({ videoId: "x", combos: [] }), look({ videoId: "y", combos: [] }))).toBeNull();
  });

  it("matches frames that differ by a few bits and not ones that differ by many", () => {
    const a = look({ videoId: "v1", frameHashes: frames(0x1234567890abcdefn, [0, 0, 0, 0]) });
    expect(frameSimilarity(a, look({ videoId: "v2", frameHashes: frames(0x1234567890abcdefn, [3, 5, 8, 12]) }))).toBe(1);
    expect(frameSimilarity(a, look({ videoId: "v3", frameHashes: frames(0x1234567890abcdefn, [20, 24, 28, 30]) }))).toBe(0);
    expect(frameSimilarity(a, look({ videoId: "v4", frameHashes: frames(0x1234567890abcdefn, [2, 2, 26, 26]) }))).toBe(0.5);
    expect(frameSimilarity(a, look({ videoId: "v5", frameHashes: [] }))).toBeNull();
  });

  it("drops parts without evidence and rescales", () => {
    const a = look({ videoId: "v1", frameHashes: [], combos: [] });
    const b = look({ videoId: "v2", frameHashes: [], combos: [], kindShare: { still: 0.5, footage: 0.5 } });
    const { score, parts } = visualSameness(a, b, "channel");
    expect(parts.combos).toBeNull();
    expect(parts.frames).toBeNull();
    expect(score).toBeCloseTo(kindSimilarity(a, b), 5);
    expect(kindSimilarity(a, b)).toBeCloseTo(0.8, 5);
  });

  it("tells two style packs apart and treats the same fingerprint as the same look", () => {
    const a = look({ videoId: "v1" });
    const b = look({ videoId: "v2", channelId: "ch-b" }, paper);
    expect(styleSimilarity(a.style, a.style)).toBe(1);
    expect(styleSimilarity(a.style, b.style)).toBeLessThan(0.5);
    // Same templates and frames, different style: the cross-channel score falls, the in-channel score does not.
    expect(visualSameness(a, b, "channel").score).toBeCloseTo(1, 5);
    expect(visualSameness(a, b, "cross").score).toBeLessThan(0.8);
    expect(visualSameness(a, { ...b, style: a.style }, "cross").score).toBeCloseTo(1, 5);
  });
});

describe("compareVisualSameness", () => {
  const current = look({ videoId: "new" });
  const earlier = [
    look({ videoId: "new" }),
    look({ videoId: "a1", combos: [{ templateId: "list_full", key: "layout=cards", sec: 6 }], frameHashes: frames(0xaaaa5555aaaa5555n, [0, 0]) }),
    look({ videoId: "a2" }),
    look({ videoId: "b1", channelId: "ch-b" }),
    look({ videoId: "b2", channelId: "ch-b" }),
    // A light look also gives different frames: dHash follows the light and dark areas.
    look({ videoId: "c1", channelId: "ch-c", frameHashes: frames(0xf0f0f0f0f0f0f0f0n, [0, 0, 0, 0]) }, paper),
  ];

  it("finds the closest earlier video of the channel and the closest other channel", () => {
    const scores = compareVisualSameness(current, earlier);
    expect(scores.channel).toEqual({ videoId: "a2", similarity: expect.closeTo(1, 5) });
    expect(scores.channelMean!).toBeLessThan(1);
    expect(scores.crossChannel!.channelId).toBe("ch-b");
    expect(scores.crossChannel!.similarity).toBeCloseTo(1, 5);
    expect(scores.comparedVideos).toBe(5);
  });

  it("raises both findings above the thresholds and none below", () => {
    const issues = visualSamenessIssues(compareVisualSameness(current, earlier));
    expect(issues.map((issue) => issue.ruleId)).toEqual(["ORIG_VISUAL_SAME_CHANNEL", "ORIG_VISUAL_CROSS_CHANNEL"]);
    expect(issues[0]!.text).toContain("a2");
    expect(issues[1]!.text).toContain("ch-b");
    const quiet = compareVisualSameness(current, [earlier[1]!, earlier[5]!]);
    expect(visualSamenessIssues(quiet)).toEqual([]);
    expect(compareVisualSameness(current, [])).toEqual({ channel: null, channelMean: null, crossChannel: null, comparedVideos: 0 });
  });

  it("looks only at the window", () => {
    const many = Array.from({ length: 8 }, (_, i) => look({ videoId: `old-${i}`, combos: [{ templateId: "map", key: `k=${i}`, sec: 3 }], frameHashes: [], kindShare: { map: 1 } }));
    const scores = compareVisualSameness(current, [...many, look({ videoId: "twin" })], { maxChannelSameness: 0.85, maxCrossChannelSameness: 0.7, window: 5 });
    expect(scores.comparedVideos).toBe(5);
    expect(scores.channel!.videoId).not.toBe("twin");
  });
});

describe("rotation lowers sameness", () => {
  it("videos picked with the channel history look less alike than videos picked without it", () => {
    const style = resolveStyle({ pack: stylePackFromChoices({ id: "c", name: "C", presetId: "studio" }), video: { consistency: 0.2 } }, WIDE);
    const shots = Array.from({ length: 3 }, (_, i) => ({ id: `s${i}`, templateId: "list_full" }));
    const shotSec = Object.fromEntries(shots.map((shot) => [shot.id, 5]));
    const make = (useHistory: boolean) => {
      const history: LookHistory = { videos: [] };
      const looks: VideoLook[] = [];
      for (let video = 0; video < 6; video += 1) {
        // Without history every video starts from the same state, as the app does today.
        const picks = pickVariants({ seed: useHistory ? `c|v${video}` : "c", shots, tokens: style.tokens, aspect: style.aspect, packSeed: "c", history: useHistory ? history : undefined });
        history.videos.unshift(lookHistoryEntry(`v${video}`, picks));
        looks.push(buildVideoLook({ videoId: `v${video}`, channelId: "c", createdAt: "2026-11-12T00:00:00.000Z", style, picks, shotSec, kindShare: { list_full: 1 }, frameHashes: [] }));
      }
      return looks;
    };
    const mean = (looks: VideoLook[]) => {
      const scores = looks.slice(1).map((item, index) => comboSimilarity(item, looks[index]!)!);
      return scores.reduce((sum, value) => sum + value, 0) / scores.length;
    };
    expect(mean(make(false))).toBe(1);
    expect(mean(make(true))).toBe(0);
  });
});
