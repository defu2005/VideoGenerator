import { describe, expect, it } from "vitest";
import {
  FOOTAGE_MIN_SCORE,
  assignFootage,
  emptyFootageUse,
  footageFit,
  footageRelevance,
  noteFootageUse,
  pickInSec,
  rankFootage,
  type RankableFootage,
} from "./footage.js";

let next = 0;
function clip(tags: string, extra: Partial<RankableFootage> = {}): RankableFootage {
  next += 1;
  return {
    provider: "pixabay",
    clipId: String(next),
    width: 1920,
    height: 1080,
    durationSec: 12,
    author: `author-${next}`,
    pageUrl: `https://pixabay.com/videos/id-${next}/`,
    tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
    ...extra,
  };
}

const wide = { aspect: "16:9" as const };

/** Pixabay-style clips (3–4 tags) with a human label: is this clip right for the scene? */
const LABELLED: { queries: string[]; text?: string; on: string[]; off: string[] }[] = [
  {
    queries: ["person scrolling smartphone", "hands holding phone"],
    on: ["smartphone, hands, scrolling", "woman, phone, sofa, texting", "mobile, phone, social media", "man, smartphone, street, night"],
    off: ["sunset, beach, sky", "person, hiking, mountain"],
  },
  {
    queries: ["social media apps phone screen", "facebook app icon"],
    text: "Facebook chiếm 45%, YouTube 30%, TikTok 25%.",
    on: ["social media, apps, phone, icons", "facebook, app, smartphone, logo"],
    off: ["screen, cinema, movie, audience", "media, newspaper, press, print"],
  },
  {
    queries: ["distracted student phone desk", "clock time passing"],
    on: ["student, phone, distracted, desk", "clock, time, hands, ticking"],
    off: ["desk, lamp, interior, design", "student, graduation, ceremony"],
  },
  {
    queries: ["glass of water", "woman drinking water morning"],
    on: ["water, glass, pouring, drink", "woman, drinking, water, kitchen"],
    off: ["waterfall, water, river, nature", "glass, window, skyscraper, reflection"],
  },
  {
    queries: ["city traffic night"],
    on: ["traffic, city, night, lights", "cars, highway, night"],
    off: ["night, stars, milky way", "city, park, children, playing"],
  },
  {
    queries: ["brain neurons activity", "person thinking window"],
    on: ["brain, neurons, animation, science", "man, thinking, window, rain"],
    off: ["abstract, particles, lights, loop", "window, curtains, wind"],
  },
  {
    queries: ["ocean"],
    on: ["sea, waves, beach", "ocean, aerial, drone"],
    off: ["mountain, snow, peak"],
  },
];

describe("rankFootage", () => {
  it("keeps the clips a person would call on-topic and drops the rest", () => {
    for (const scene of LABELLED) {
      const on = scene.on.map((tags) => clip(tags));
      const off = scene.off.map((tags) => clip(tags));
      const kept = rankFootage(scene.text ?? "", scene.queries, [...off, ...on], emptyFootageUse(), wide);
      expect(kept.map((hit) => hit.tags.join(", ")).sort(), scene.queries[0]).toEqual([...scene.on].sort());
    }
  });

  it("puts the closer match first and is stable for the same input", () => {
    const hits = [clip("woman, phone, sofa"), clip("smartphone, hands, scrolling"), clip("person, hiking, mountain")];
    const queries = ["person scrolling smartphone", "hands holding phone"];
    const first = rankFootage("", queries, hits, emptyFootageUse(), wide);
    expect(first.map((hit) => hit.tags[0])).toEqual(["smartphone", "woman"]);
    expect(rankFootage("", queries, hits, emptyFootageUse(), wide)).toEqual(first);
  });

  it("reads the URL slug when a hit has no tags (Pexels)", () => {
    const hit = clip("", { provider: "pexels", pageUrl: "https://www.pexels.com/video/a-woman-drinking-water-in-the-kitchen-3129671/" });
    const other = clip("", { provider: "pexels", pageUrl: "https://www.pexels.com/video/waves-crashing-on-the-rocks-857195/" });
    expect(rankFootage("", ["woman drinking water"], [other, hit], emptyFootageUse(), wide)).toEqual([hit]);
  });

  it("matches plurals, -ing forms and close synonyms", () => {
    expect(footageRelevance("", ["dancing kids"], clip("children, dance, party"))).toBeGreaterThan(0.8);
    expect(footageRelevance("", ["cities"], clip("city, skylines"))).toBe(0.75);
    expect(footageRelevance("", ["city skyline"], clip("cities, skylines"))).toBe(1);
  });

  it("counts a filming-style word far less than a subject word", () => {
    const style = footageRelevance("", ["aerial city skyline"], clip("aerial, drone, forest"));
    const subject = footageRelevance("", ["aerial city skyline"], clip("city, skyline, buildings"));
    expect(style).toBeLessThan(FOOTAGE_MIN_SCORE);
    expect(subject).toBeGreaterThan(0.7);
  });

  it("adds a little for a name said in the scene, but not for Vietnamese words that lost their marks", () => {
    const hit = clip("facebook, app, logo");
    const base = footageRelevance("", ["social media app"], hit);
    expect(footageRelevance("Facebook chiếm 45%.", ["social media app"], hit)).toBeCloseTo(base + 0.05, 5);
    // "màn" would read as "man" without its mark; it must not match a clip tagged "man".
    const man = clip("man, walking, street");
    expect(footageRelevance("Màn hình sáng cả đêm.", ["city street"], man)).toBe(footageRelevance("", ["city street"], man));
  });

  it("marks an animation down unless the query asks for one", () => {
    const hit = clip("city, skyline, animation");
    // Without the mark-down: the query is covered (1) and two of three tags are on-topic.
    expect(footageRelevance("", ["city skyline"], hit)).toBeCloseTo(0.7 * (1 + 2 / 3) / 2, 5);
    expect(footageRelevance("", ["city skyline animation"], hit)).toBe(1);
  });

  it("trusts a hit without any words only when the clip itself is clean", () => {
    const bare = clip("", { pageUrl: "https://www.pexels.com/video/1" });
    expect(footageRelevance("", ["sea"], bare)).toBe(0.5);
    expect(rankFootage("", ["sea"], [bare], emptyFootageUse(), wide)).toEqual([bare]);
    expect(rankFootage("", ["sea"], [bare], emptyFootageUse(), { aspect: "9:16" })).toEqual([]);
  });

  it("prefers the clip whose shape matches the aspect", () => {
    const landscape = clip("sea, waves, beach");
    const portrait = clip("sea, waves, beach", { width: 1080, height: 1920 });
    expect(rankFootage("", ["sea waves"], [landscape, portrait], emptyFootageUse(), { aspect: "9:16" })[0]).toBe(portrait);
    expect(rankFootage("", ["sea waves"], [portrait, landscape], emptyFootageUse(), wide)[0]).toBe(landscape);
  });

  it("wants the clip to be 1 s longer than the shot and drops one that would freeze", () => {
    const exact = clip("sea, waves", { durationSec: 4 });
    expect(rankFootage("", ["sea waves"], [exact], emptyFootageUse(), { ...wide, shotSec: 4 })).toEqual([exact]);
    expect(pickInSec(4, 4)).toBe(0);
    const long = clip("sea, waves", { durationSec: 9 });
    const tight = clip("sea, waves", { durationSec: 4.5 });
    const short = clip("sea, waves", { durationSec: 3.8 });
    const ranked = rankFootage("", ["sea waves"], [short, tight, long], emptyFootageUse(), { ...wide, shotSec: 4 });
    expect(ranked).toEqual([long, tight]);
  });

  it("ranks a clip below the target resolution lower, counting its best file", () => {
    const small = clip("sea, waves", { width: 640, height: 360 });
    const big = clip("sea, waves");
    const viaFile = clip("sea, waves", { width: 640, height: 360, files: [{ width: 1920, height: 1080 }] });
    const options = { ...wide, targetShortSide: 1080 };
    expect(rankFootage("", ["sea waves"], [small, big], emptyFootageUse(), options)).toEqual([big, small]);
    expect(footageFit("", ["sea waves"], viaFile, options)).toBe(1);
    expect(footageFit("", ["sea waves"], small, options)).toBeCloseTo(0.6, 5);
    expect(footageFit("", ["sea waves"], small, wide)).toBe(1);
  });

  it("leaves out clips already used and ranks a third clip of one author down without dropping it", () => {
    const used = emptyFootageUse();
    const a1 = clip("sea, waves", { author: "An" });
    const a2 = clip("sea, waves", { author: "An" });
    const a3 = clip("sea, waves", { author: "An" });
    const other = clip("sea, waves", { author: "Binh" });
    noteFootageUse(used, a1, 0.5, 3);
    noteFootageUse(used, a2, 0.5, 3);
    expect(rankFootage("", ["sea waves"], [a1, a2, a3, other], used, wide)).toEqual([other, a3]);
    // A second window of the same clip does not count the author twice.
    noteFootageUse(used, a1, 8, 3);
    expect(used.authors.get("An")).toBe(2);
  });

  it("shares clips that two scenes found, so neither is left without footage", () => {
    const pool = [clip("sea, waves, beach"), clip("ocean, waves, surf"), clip("sea, boat, waves"), clip("beach, waves, sea, sand")];
    const lists = assignFootage([
      { text: "", queries: ["sea waves beach"], hits: pool },
      { text: "", queries: ["ocean waves surf"], hits: pool },
    ], wide);
    expect(lists.map((list) => list.length)).toEqual([2, 2]);
    expect(lists[0]![0]).toBe(pool[0]);
    expect(lists[1]![0]).toBe(pool[1]);
    expect(new Set(lists.flat()).size).toBe(4);
    expect(assignFootage([{ text: "", queries: ["sea waves"], hits: pool }], wide, 3)[0]!.length).toBe(3);
  });

  it("gives a clip found for two scenes to the scene it fits best", () => {
    const shared = clip("city, traffic, night");
    const sea = clip("sea, waves, beach");
    const lists = assignFootage([
      { text: "", queries: ["city skyline day"], hits: [shared] },
      { text: "", queries: ["city traffic night"], hits: [shared, sea] },
      { text: "", queries: ["sea waves"], hits: [sea, shared] },
    ], wide);
    expect(lists).toEqual([[], [shared], [sea]]);
  });
});

describe("pickInSec", () => {
  it("skips the first half second, and centres a clip that is too short for both edges", () => {
    expect(pickInSec(12, 3)).toBe(0.5);
    expect(pickInSec(3.6, 3)).toBe(0.3);
    expect(pickInSec(2.5, 3)).toBeNull();
  });

  it("takes the far end for a second shot, and refuses when the two parts would touch", () => {
    expect(pickInSec(20, 3, [{ inSec: 0.5, lenSec: 3 }])).toBe(16.5);
    expect(pickInSec(8, 3, [{ inSec: 0.5, lenSec: 3 }])).toBe(4.5);
    expect(pickInSec(7.9, 3, [{ inSec: 0.5, lenSec: 3 }])).toBeNull();
    expect(pickInSec(30, 3, [{ inSec: 0.5, lenSec: 3 }, { inSec: 26.5, lenSec: 3 }])).toBeNull();
  });
});
