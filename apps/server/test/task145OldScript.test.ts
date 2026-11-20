import { describe, expect, it } from "vitest";
import { ScriptSchema, planScenes } from "@vg/shared";

// TASK-145 row 18 (old-script plan). Guide docs/cursor/TASK-145.md line 230 and 209: a script saved before the beat
// fields existed (no beatPurpose, emotion, visualIntent, factIds, opensLoops, closesLoops, sectionKey) must still
// parse and plan scenes. Rendering the timeline with fake ffmpeg is NOT covered here.

const oldScript = {
  title: "Bản cũ",
  hook: "Một câu mở đầu.",
  sections: [
    {
      id: "s1",
      heading: "Phần một",
      narration: "Nội dung phần một.",
      visualQueries: { primary: "phần một", alternatives: ["alt"] },
      visualNotes: "ghi chú",
      musicMood: "calm",
      energy: "medium",
      estDurationSec: 10,
    },
  ],
  outro: "Kết thúc.",
  music: { mood: "", energy: "medium", keywords: [] },
};

const settings = { sceneDurationSec: 5, wordsPerMinute: 120, language: "vi" } as never;

describe("old script without beat fields (TASK-145 row 18)", () => {
  it("parses with the current schema and keeps beat fields absent", () => {
    const parsed = ScriptSchema.parse(oldScript);
    const section = parsed.sections[0]!;
    expect(section.beatPurpose).toBeUndefined();
    expect(section.factIds).toBeUndefined();
    expect(section.opensLoops).toBeUndefined();
    expect(section.closesLoops).toBeUndefined();
  });

  it("plans scenes for hook, section and outro without requiring beat fields", () => {
    const scenes = planScenes(ScriptSchema.parse(oldScript), settings);
    expect(scenes.map((scene) => scene.kind)).toEqual(["hook", "section", "outro"]);
    expect(scenes.map((scene) => scene.order)).toEqual([0, 1, 2]);
  });
});
