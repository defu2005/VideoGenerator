import { describe, expect, it } from "vitest";
import { ScriptSchema } from "../src/schemas/script.js";
import { planScenes } from "../src/scenes/planScenes.js";

// TASK-146 slice 1 red tests: scenes carry the section beat; a reveal section gets its own first scene.
// Guards (tests 3-6) pass today on purpose; they must stay green after the change.

const BEAT_KEYS = ["beatPurpose", "emotion", "visualIntent", "factIds"] as const;

const sectionBase = (id: string, narration: string) => ({
  id,
  heading: id,
  narration,
  visualQueries: { primary: `${id} primary`, alternatives: [`${id} alt one`, `${id} alt two`] },
  visualNotes: `${id} visual`,
  musicMood: `${id} mood`,
  energy: "medium",
  estDurationSec: 0,
});

const SETUP_NARRATION = "Setup has seven words for this sentence. Setup second sentence follows here.";
const REVEAL_NARRATION = "Reveal one. Two three. Four five six seven. Eight nine.";

const beatScript = ScriptSchema.parse({
  title: "Beats",
  hook: "Hook opens the story.",
  sections: [
    {
      ...sectionBase("s1", SETUP_NARRATION),
      beatPurpose: "setup",
      emotion: "curious",
      visualIntent: "a wide shot of the workshop",
      factIds: ["f1", "f2"],
    },
    {
      ...sectionBase("s2", REVEAL_NARRATION),
      beatPurpose: "reveal",
      emotion: "awe",
      visualIntent: "the finished machine, close-up",
      factIds: ["f3"],
    },
    sectionBase("s3", "Plain section with no beat fields at all."),
  ],
  outro: "Closing line.",
  music: { mood: "", energy: "medium", keywords: [] },
});

const settings = { sceneDurationSec: 5, wordsPerMinute: 60, language: "en" } as const;

describe("TASK-146 slice 1: beats carried onto scenes", () => {
  it("copies the four beat fields from each section onto every scene cut from it", () => {
    const scenes = planScenes(beatScript, settings);
    const s1 = scenes.filter((scene) => scene.sectionId === "s1");
    const s2 = scenes.filter((scene) => scene.sectionId === "s2");
    expect(s1.length).toBeGreaterThan(0);
    expect(s2.length).toBeGreaterThan(0);
    for (const scene of s1) {
      expect(scene).toMatchObject({
        beatPurpose: "setup",
        emotion: "curious",
        visualIntent: "a wide shot of the workshop",
        factIds: ["f1", "f2"],
      });
    }
    for (const scene of s2) {
      expect(scene).toMatchObject({ beatPurpose: "reveal", emotion: "awe", visualIntent: "the finished machine, close-up", factIds: ["f3"] });
    }
  });

  it("gives the reveal sentence its own first scene (first sentence of a reveal section)", () => {
    const s2 = planScenes(beatScript, settings).filter((scene) => scene.sectionId === "s2");
    expect(s2[0]?.narration).toBe("Reveal one.");
    expect(s2[1]?.narration.startsWith("Two three.")).toBe(true);
  });

  it("packs a long comma-heavy reveal sentence like normal text, never into sub-half-target scenes", () => {
    const longReveal = "Reveal one, two three, four five six seven eight nine ten eleven. Second sentence follows here.";
    const script = ScriptSchema.parse({
      ...beatScript,
      hook: "",
      outro: "",
      sections: [{ ...sectionBase("r1", longReveal), beatPurpose: "reveal" }],
    });
    const scenes = planScenes(script, settings).filter((scene) => scene.sectionId === "r1");
    const splitAt = scenes.findIndex((scene) => scene.narration.startsWith("Second sentence"));
    expect(splitAt).toBeGreaterThan(0);
    const head = scenes.slice(0, splitAt);
    expect(head.map((scene) => scene.narration).join(" ")).toBe("Reveal one, two three, four five six seven eight nine ten eleven.");
    for (const scene of head) expect(scene.estDurationSec).toBeGreaterThanOrEqual(settings.sceneDurationSec * 0.5);
  });
});

describe("TASK-146 slice 1: guards that must stay green", () => {
  it("keeps a non-reveal section cut exactly as it is with no beat fields", () => {
    const plain = ScriptSchema.parse({
      ...beatScript,
      sections: [
        { ...sectionBase("s2", REVEAL_NARRATION), beatPurpose: "setup" },
      ],
    });
    const bare = ScriptSchema.parse({ ...beatScript, sections: [sectionBase("s2", REVEAL_NARRATION)] });
    const strip = (scenes: ReturnType<typeof planScenes>) =>
      scenes.map(({ narration, estDurationSec, startSec, order }) => ({ narration, estDurationSec, startSec, order }));
    expect(strip(planScenes(plain, settings))).toEqual(strip(planScenes(bare, settings)));
  });

  it("gives a one-sentence reveal section exactly one scene", () => {
    const single = ScriptSchema.parse({
      ...beatScript,
      sections: [{ ...sectionBase("s2", "Only one sentence here."), beatPurpose: "reveal" }],
    });
    expect(planScenes(single, settings).filter((scene) => scene.sectionId === "s2")).toHaveLength(1);
  });

  it("never stamps beat keys on hook, outro or sections without beat fields", () => {
    for (const scene of planScenes(beatScript, settings)) {
      if (scene.sectionId === "s1" || scene.sectionId === "s2") continue;
      for (const key of BEAT_KEYS) expect(key in scene).toBe(false);
    }
  });

  it("no scene spans two beats, narration is preserved and timing stays cumulative", () => {
    const scenes = planScenes(beatScript, settings);
    const sectionNarration = new Map(beatScript.sections.map((section) => [section.id, section.narration]));
    for (const scene of scenes) {
      if (scene.sectionId) expect(sectionNarration.get(scene.sectionId)).toContain(scene.narration);
    }
    const joined = scenes.map((scene) => scene.narration).join(" ").replace(/\s+/gu, " ").trim();
    const expected = [beatScript.hook, ...beatScript.sections.map((s) => s.narration), beatScript.outro]
      .join(" ").replace(/\s+/gu, " ").trim();
    expect(joined).toBe(expected);
    expect(scenes.map((scene) => scene.order)).toEqual(scenes.map((_, index) => index));
    for (let index = 1; index < scenes.length; index += 1) {
      expect(scenes[index].startSec).toBeCloseTo(scenes[index - 1].startSec + scenes[index - 1].estDurationSec, 5);
    }
  });
});
