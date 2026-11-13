import { describe, expect, it } from "vitest";
import type { TimelineScene } from "@vg/shared";
import { planProject } from "../src/compose/composeService.js";
import { planEval } from "../src/compose/eval/runEval.js";
import type { FootageHit } from "../src/providers/footage/types.js";

function scene(id: string, seconds: number): TimelineScene {
  const frames = Math.round(seconds * 30);
  return {
    sceneId: id,
    order: 0,
    label: id,
    startSec: 0,
    endSec: frames / 30,
    durationSec: frames / 30,
    durationFrames: frames,
    voice: null,
    visuals: [{
      kind: "IMAGE",
      candidateId: `still-${id}`,
      path: "still.png",
      startSec: 0,
      endSec: frames / 30,
      motion: { type: "kenburns", from: { zoom: 1, x: 0.5, y: 0.5 }, to: { zoom: 1, x: 0.5, y: 0.5 } },
      motionPreset: "static",
      licenseKind: "ROYALTY_FREE",
    }],
    fadeInSec: 0,
    fadeOutSec: 0,
  };
}

function hit(id: string, tags: string, extra: Partial<FootageHit> = {}): FootageHit {
  return {
    provider: "pixabay",
    clipId: id,
    url: `https://video.example/${id}.mp4`,
    width: 1920,
    height: 1080,
    durationSec: 8,
    author: `author-${id}`,
    licenseName: "Pixabay Content License",
    pageUrl: `https://pixabay.com/videos/id-${id}/`,
    previewImage: "",
    tags: tags.split(",").map((tag) => tag.trim()),
    files: [],
    ...extra,
  };
}

/** 20 words over 8 s, with a sentence end every 5 words so pacing has cut points. */
const words = Array.from({ length: 20 }, (_, index) => ({ startSec: index * 0.4, endSec: index * 0.4 + 0.3, text: index % 5 === 4 ? "xong." : "từ" }));

async function plan(scenes: { id: string; query: string; alt?: string }[], search: (query: string) => FootageHit[], seconds = 8) {
  return planProject({
    timeline: { scenes: scenes.map((item) => scene(item.id, seconds)), music: null },
    scenes: scenes.map((item) => ({ id: item.id, narration: "Một hai ba.", visualQueries: { primary: item.query, alternatives: item.alt ? [item.alt] : [] } })),
    voiceTracks: scenes.map((item) => ({ sceneId: item.id, words, timingSource: "provider" as const })),
    recipeId: "explainer",
    preset: "news",
    aspect: "16:9",
    footageSearch: async (query) => search(query),
  });
}

function clipIds(shots: { source: { kind: string; clipId?: string } }[]): string[] {
  return shots.flatMap((shot) => shot.source.kind === "footage" && shot.source.clipId ? [shot.source.clipId] : []);
}

describe("planProject footage ranking", () => {
  it("shows a still when every hit is off-topic, and footage when the hits match", async () => {
    const made = await plan(
      [{ id: "a", query: "glass of water" }, { id: "b", query: "city traffic night" }],
      (query) => query === "glass of water"
        ? [hit("1", "waterfall, water, river"), hit("2", "glass, window, skyscraper"), hit("3", "sunset, beach, sky")]
        : [hit("4", "night, stars, sky"), hit("5", "traffic, city, night"), hit("6", "cars, highway, night"), hit("7", "city, traffic, lights")],
    );
    expect(made.scenes[0]?.shots.every((shot) => shot.kind === "still")).toBe(true);
    expect(made.scenes[1]?.shots.every((shot) => shot.kind === "footage")).toBe(true);
    expect(clipIds(made.scenes[1]!.shots)).not.toContain("4");
    // The closest match opens the scene.
    expect(clipIds(made.scenes[1]!.shots)[0]).toBe("5");
  });

  it("searches the alternative queries too and never shows one clip in two scenes", async () => {
    const pool = [hit("1", "sea, waves, beach"), hit("2", "ocean, waves, surf"), hit("3", "sea, boat, waves"), hit("4", "beach, waves, sea, sand")];
    const asked: string[] = [];
    const made = await plan(
      [{ id: "a", query: "sea waves", alt: "beach sand" }, { id: "b", query: "ocean waves", alt: "surf" }],
      (query) => { asked.push(query); return pool; },
    );
    expect(asked).toEqual(expect.arrayContaining(["sea waves", "beach sand", "ocean waves", "surf"]));
    const first = new Set(clipIds(made.scenes[0]!.shots));
    const second = new Set(clipIds(made.scenes[1]!.shots));
    expect(first.size).toBeGreaterThan(0);
    expect(second.size).toBeGreaterThan(0);
    expect([...first].filter((id) => second.has(id))).toEqual([]);
  });

  it("cuts a second shot from the far end of a long clip when the scene runs out of clips", async () => {
    const made = await plan(
      [{ id: "a", query: "sea waves" }],
      () => [hit("1", "sea, waves, beach", { durationSec: 20 }), hit("2", "sea, waves, surf", { durationSec: 20 })],
      12,
    );
    const shots = made.scenes[0]!.shots;
    expect(shots.length).toBeGreaterThan(2);
    expect(shots.every((shot) => shot.kind === "footage")).toBe(true);
    const windows = new Map<string, { inSec: number; len: number }[]>();
    for (const shot of shots) {
      if (shot.source.kind !== "footage") continue;
      const list = windows.get(shot.source.clipId) ?? [];
      list.push({ inSec: shot.source.inSec, len: shot.endSec - shot.startSec });
      windows.set(shot.source.clipId, list);
    }
    for (const list of windows.values()) {
      expect(list.length).toBeLessThanOrEqual(2);
      expect(list[0]!.inSec).toBe(0.5);
      if (list[1]) {
        // The second part starts at least 1 s after the first one ends, and stops 0.5 s before the clip ends.
        expect(list[1].inSec).toBeGreaterThanOrEqual(list[0]!.inSec + list[0]!.len + 1 - 1e-6);
        expect(list[1].inSec + list[1].len).toBeLessThanOrEqual(19.5 + 0.01);
      }
    }
    expect([...windows.values()].some((list) => list.length === 2)).toBe(true);
  });

  it("falls back to a still, with a reason, when the clips are too short to reuse", async () => {
    const made = await plan(
      [{ id: "a", query: "sea waves" }],
      () => [hit("1", "sea, waves, beach", { durationSec: 5 }), hit("2", "sea, waves, surf", { durationSec: 5 })],
      12,
    );
    const shots = made.scenes[0]!.shots;
    expect(shots.filter((shot) => shot.kind === "footage").length).toBe(2);
    const stills = shots.filter((shot) => shot.kind === "still");
    expect(stills.length).toBeGreaterThan(0);
    expect(stills.every((shot) => shot.reason.endsWith("+F-still"))).toBe(true);
    expect(made.scenes[0]!.warnings).toEqual([]);
  });

  it("gives the same plan for the same input", async () => {
    const search = () => [hit("1", "sea, waves, beach"), hit("2", "ocean, waves"), hit("3", "sea, boat, waves")];
    const first = await plan([{ id: "a", query: "sea waves" }], search);
    expect(await plan([{ id: "a", query: "sea waves" }], search)).toEqual(first);
  });
});

describe("compose eval plans (no rendering)", () => {
  const cases = [
    { id: "explainer", shots: [12, 30] },
    { id: "listicle", shots: [18, 40] },
    { id: "story", shots: [12, 30] },
  ] as const;

  for (const item of cases) {
    it(`${item.id}: the final setup meets the plan targets and shows no off-topic clip`, async () => {
      const { plan: made, footage } = await planEval(item.id, "compose");
      expect(made.stats.kindEntropyBits).toBeGreaterThanOrEqual(1.2);
      expect(made.stats.maxSameKindRun).toBeLessThanOrEqual(2);
      expect(made.stats.kindShare.still).toBeLessThanOrEqual(0.4);
      expect(made.stats.shotsPerMin).toBeGreaterThanOrEqual(item.shots[0]);
      expect(made.stats.shotsPerMin).toBeLessThanOrEqual(item.shots[1]);
      expect(footage.shots).toBeGreaterThan(0);
      expect(footage.offTopic).toBe(0);
      expect(made.scenes.flatMap((scene) => scene.warnings)).toEqual([]);
    });
  }

  it("taking clips in the provider's order shows off-topic clips, which is what ranking removes", async () => {
    const { footage } = await planEval("explainer", "rule");
    expect(footage.offTopic).toBeGreaterThan(0);
  });
});
