import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MergedStorySchema } from "../src/schemas/script.js";
import { planScenes } from "../src/scenes/planScenes.js";
import type { Script } from "../src/schemas/script.js";

function section(id: string, narration: string, heading = id): Script["sections"][number] {
  return {
    id,
    heading,
    narration,
    visualQueries: { primary: `${id} primary`, alternatives: [`${id} alt one`, `${id} alt two`] },
    visualNotes: `${id} visual`,
    musicMood: `${id} mood`,
    energy: "medium",
    estDurationSec: 0,
  };
}

function script(input: Partial<Script> = {}): Script {
  return {
    title: "Test",
    hook: "",
    sections: [section("s1", "A short narration.")],
    outro: "",
    music: { mood: "", energy: "medium", keywords: [] },
    ...input,
  };
}

const settings = { sceneDurationSec: 5, wordsPerMinute: 60, language: "en" };
const normalize = (value: string) => value.replace(/\s+/gu, " ").trim();

describe("planScenes", () => {
  it("preserves order and never merges scenes across script units", () => {
    const input = script({
      hook: "Hook text.",
      sections: [section("s1", "First section."), section("s2", "Second section.")],
      outro: "Closing text.",
    });
    const scenes = planScenes(input, settings);
    expect(scenes.map(({ kind, label }) => [kind, label])).toEqual([
      ["hook", "Hook"],
      ["section", "s1"],
      ["section", "s2"],
      ["outro", "Outro"],
    ]);
    expect(scenes.map((scene) => scene.order)).toEqual([0, 1, 2, 3]);
  });

  it("greedily packs sentences near the target and computes cumulative timing", () => {
    const input = script({ sections: [section("s1", "one two three. four five six. seven eight nine.")] });
    const scenes = planScenes(input, settings);
    expect(scenes).toHaveLength(2);
    expect(scenes[0].estDurationSec).toBe(6);
    expect(scenes[1].startSec).toBe(6);
    expect(scenes[1].estDurationSec).toBe(3);
  });

  it("splits overlong sentences at clauses and preserves all words and punctuation", () => {
    const narration = "one two three four, five six seven eight, nine ten eleven twelve, thirteen fourteen fifteen sixteen.";
    const scenes = planScenes(script({ sections: [section("s1", narration)] }), settings);
    expect(scenes.length).toBeGreaterThan(1);
    expect(normalize(scenes.map((scene) => scene.narration).join(" "))).toBe(normalize(narration));
    expect(scenes.every((scene) => scene.estDurationSec <= settings.sceneDurationSec * 1.6)).toBe(true);
  });

  it("splits a long unpunctuated sentence into the part count closest to the target", () => {
    const narration = Array.from({ length: 70 }, (_, index) => `word${index}`).join(" ");
    const scenes = planScenes(script({ sections: [section("s1", narration)] }), {
      ...settings,
      sceneDurationSec: 7,
      wordsPerMinute: 60,
    });
    expect(scenes).toHaveLength(10);
    expect(scenes.map((scene) => scene.estDurationSec)).toEqual(Array(10).fill(7));
    expect(normalize(scenes.map((scene) => scene.narration).join(" "))).toBe(normalize(narration));
  });

  it("merges a trailing tiny scene with the previous scene when it fits", () => {
    const narration = "First sentence has seven words for this. Second sentence has seven words for this. Tiny part.";
    const scenes = planScenes(script({ sections: [section("s1", narration)] }), settings);
    expect(scenes.at(-1)?.narration).toContain("Tiny part.");
    expect(scenes.at(-1)?.estDurationSec).toBeLessThanOrEqual(settings.sceneDurationSec * 1.8);
  });

  it("distributes queries and inherits hook/outro visual context", () => {
    const input = script({
      hook: "one two three four. five six seven eight. nine ten eleven twelve.",
      sections: [section("s1", "one two three four. five six seven eight. nine ten eleven twelve.")],
      outro: "one two three four.",
    });
    const scenes = planScenes(input, settings);
    expect(scenes[0].visualQueries.primary).toBe("s1 primary");
    expect(scenes[1].visualQueries.primary).toBe("s1 alt one");
    expect(scenes.find((scene) => scene.kind === "section")?.visualQueries.primary).toBe("s1 primary close-up");
    expect(scenes.find((scene) => scene.kind === "section")?.queryVariant).toBe(true);
    expect(scenes.at(-1)?.visualQueries.primary).not.toBe(scenes.at(-2)?.visualQueries.primary);
    expect(scenes.at(-1)?.visualNotes).toBe("s1 visual");
    expect(scenes[0].musicMood).toBe("s1 mood");
    expect(scenes.some((scene) => scene.queryVariant)).toBe(true);
  });

  it("never assigns identical primary queries to consecutive scenes across deterministic randomized scripts", () => {
    for (let seed = 0; seed < 80; seed += 1) {
      const input = script({
        hook: seed % 2 ? "Hook starts here. Hook continues." : "",
        sections: [
          section("s1", Array.from({ length: 1 + seed % 6 }, (_, index) => `First ${index} has words.`).join(" ")),
          section("s2", Array.from({ length: 1 + seed % 5 }, (_, index) => `Second ${index} has words.`).join(" ")),
        ],
        outro: seed % 3 ? "Outro finishes this. Another final thought." : "",
      });
      const scenes = planScenes(input, settings);
      for (let index = 1; index < scenes.length; index += 1) {
        expect(scenes[index].visualQueries.primary).not.toBe(scenes[index - 1].visualQueries.primary);
      }
    }
  });

  it("is deterministic and uses durations to set cumulative starts", () => {
    const input = script({ sections: [section("s1", "one two three four. five six seven eight.")] });
    const first = planScenes(input, settings);
    const second = planScenes(input, settings);
    expect(first).toEqual(second);
    expect(first[1].startSec).toBe(first[0].estDurationSec);
  });

  it("preserves narration across many randomized scripts", () => {
    for (let seed = 0; seed < 80; seed += 1) {
      const phrases = Array.from({ length: 1 + seed % 8 }, (_, index) =>
        `Từ${seed}_${index} says ${index + 2} words!`);
      const input = script({
        hook: seed % 2 ? "Hook starts here." : "",
        sections: [section("s1", phrases.join(" "))],
        outro: seed % 3 ? "Outro finishes this." : "",
      });
      const scenes = planScenes(input, settings);
      const expected = normalize([input.hook, ...input.sections.map((item) => item.narration), input.outro].join(" "));
      expect(normalize(scenes.map((scene) => scene.narration).join(" "))).toBe(expected);
    }
  });

  it.each([3, 7])("preserves and deterministically plans the real Vietnamese fixture at %ss", (target) => {
    const fixturePath = fileURLToPath(new URL("./fixtures/copilot-merged-story-vi.json", import.meta.url));
    const fixture = MergedStorySchema.parse(JSON.parse(readFileSync(fixturePath, "utf8")) as unknown);
    const fixtureSettings = { sceneDurationSec: target, wordsPerMinute: 150, language: "vi" };
    const scenes = planScenes(fixture.script, fixtureSettings);
    const repeated = planScenes(fixture.script, fixtureSettings);
    const expected = normalize([
      fixture.script.hook,
      ...fixture.script.sections.map((item) => item.narration),
      fixture.script.outro,
    ].join(" "));
    expect(normalize(scenes.map((scene) => scene.narration).join(" "))).toBe(expected);
    expect(repeated).toEqual(scenes);
    for (let index = 1; index < scenes.length; index += 1) {
      expect(scenes[index].visualQueries.primary).not.toBe(scenes[index - 1].visualQueries.primary);
    }

    const unitScenes = new Map<string, typeof scenes>();
    for (const scene of scenes) {
      const key = `${scene.kind}:${scene.sectionId ?? scene.label}`;
      unitScenes.set(key, [...(unitScenes.get(key) ?? []), scene]);
    }
    for (const group of unitScenes.values()) {
      const unitDuration = group.reduce((sum, scene) => sum + scene.estDurationSec, 0);
      for (const scene of group) {
        expect(scene.estDurationSec).toBeLessThanOrEqual(target * 1.8);
        if (unitDuration < target * 0.5) {
          expect(group).toHaveLength(1);
        } else {
          expect(scene.estDurationSec).toBeGreaterThanOrEqual(target * 0.5);
        }
      }
    }
  });

  it("uses the recipe scene length and visual mix", () => {
    const narration = "One two three four five. Six seven eight nine ten. Eleven twelve thirteen fourteen fifteen.";
    const wide = planScenes(script({ sections: [section("s1", narration)] }), { ...settings, sceneDurationSec: 20 });
    const packed = planScenes(script({ sections: [section("s1", narration)] }), {
      ...settings,
      sceneDurationSec: 20,
      targetSceneSec: [2, 4],
      visualMix: ["chart"],
    });
    expect(packed.length).toBeGreaterThan(wide.length);
    expect(packed[0]?.visualQueries.primary).toContain("chart");
  });
});
