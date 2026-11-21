import { describe, expect, it } from "vitest";
import { ScriptSchema } from "../src/schemas/script.js";
import { planScenes } from "../src/scenes/planScenes.js";

// TASK-146 slice 1 pin: today's planScenes output for scripts with NO beat fields.
// This must stay green with zero source edits. Later slices must not change these values
// (old-script behaviour unchanged). Beat keys must be absent, not undefined or null.

const BEAT_KEYS = ["beatPurpose", "emotion", "visualIntent", "factIds", "opensLoops", "closesLoops", "sectionKey"];

// Same shape as apps/server/test/task145OldScript.test.ts (old script, no beat fields).
const oldScript = ScriptSchema.parse({
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
});

// Multi-sentence fixture: exercises packUnit packing, clause split and tiny-scene merge.
const multiScript = ScriptSchema.parse({
  title: "Test",
  hook: "Hook one. Hook two.",
  sections: [
    {
      id: "s1",
      heading: "s1",
      narration: "First sentence has seven words for this. Second sentence has seven words for this. Tiny part.",
      visualQueries: { primary: "s1 primary", alternatives: ["s1 alt one", "s1 alt two"] },
      visualNotes: "s1 visual",
      musicMood: "s1 mood",
      energy: "medium",
      estDurationSec: 0,
    },
    {
      id: "s2",
      heading: "s2",
      narration: "one two three four. five six seven eight. nine ten eleven twelve.",
      visualQueries: { primary: "s2 primary", alternatives: ["s2 alt one", "s2 alt two"] },
      visualNotes: "s2 visual",
      musicMood: "s2 mood",
      energy: "medium",
      estDurationSec: 0,
    },
  ],
  outro: "Closing text.",
  music: { mood: "", energy: "medium", keywords: [] },
});

const settingsVi = { sceneDurationSec: 5, wordsPerMinute: 120, language: "vi" } as const;
const settingsEn = { sceneDurationSec: 5, wordsPerMinute: 60, language: "en" } as const;

describe("TASK-146 slice 1 pin: planScenes output without beat fields", () => {
  it("pins the old-script plan (hook, section, outro)", () => {
    const scenes = planScenes(oldScript, settingsVi);
    expect(scenes).toMatchInlineSnapshot(`
      [
        {
          "durationOverrideSec": null,
          "energy": "medium",
          "estDurationSec": 2,
          "kind": "hook",
          "label": "Hook",
          "musicMood": "calm",
          "narration": "Một câu mở đầu.",
          "order": 0,
          "queryVariant": false,
          "sectionId": null,
          "startSec": 0,
          "transitionNote": "",
          "visualDescription": "ghi chú",
          "visualNotes": "ghi chú",
          "visualQueries": {
            "alternatives": [
              "alt",
              "phần một close-up",
              "phần một wide shot",
            ],
            "primary": "phần một",
          },
        },
        {
          "durationOverrideSec": null,
          "energy": "medium",
          "estDurationSec": 2,
          "kind": "section",
          "label": "Phần một",
          "musicMood": "calm",
          "narration": "Nội dung phần một.",
          "order": 1,
          "queryVariant": false,
          "sectionId": "s1",
          "startSec": 2,
          "transitionNote": "",
          "visualDescription": "ghi chú",
          "visualNotes": "ghi chú",
          "visualQueries": {
            "alternatives": [
              "phần một",
              "phần một close-up",
              "phần một wide shot",
            ],
            "primary": "alt",
          },
        },
        {
          "durationOverrideSec": null,
          "energy": "medium",
          "estDurationSec": 1,
          "kind": "outro",
          "label": "Outro",
          "musicMood": "calm",
          "narration": "Kết thúc.",
          "order": 2,
          "queryVariant": true,
          "sectionId": null,
          "startSec": 4,
          "transitionNote": "",
          "visualDescription": "ghi chú",
          "visualNotes": "ghi chú",
          "visualQueries": {
            "alternatives": [
              "phần một",
              "alt",
              "phần một wide shot",
            ],
            "primary": "phần một close-up",
          },
        },
      ]
    `);
  });

  it("pins the multi-sentence plan (packing, clause split, tiny merge, query rotation)", () => {
    const scenes = planScenes(multiScript, settingsEn);
    expect(scenes).toMatchInlineSnapshot(`
      [
        {
          "durationOverrideSec": null,
          "energy": "medium",
          "estDurationSec": 4,
          "kind": "hook",
          "label": "Hook",
          "musicMood": "s1 mood",
          "narration": "Hook one. Hook two.",
          "order": 0,
          "queryVariant": false,
          "sectionId": null,
          "startSec": 0,
          "transitionNote": "",
          "visualDescription": "s1 visual",
          "visualNotes": "s1 visual",
          "visualQueries": {
            "alternatives": [
              "s1 alt one",
              "s1 alt two",
              "s1 primary close-up",
            ],
            "primary": "s1 primary",
          },
        },
        {
          "durationOverrideSec": null,
          "energy": "medium",
          "estDurationSec": 7,
          "kind": "section",
          "label": "s1",
          "musicMood": "s1 mood",
          "narration": "First sentence has seven words for this.",
          "order": 1,
          "queryVariant": false,
          "sectionId": "s1",
          "startSec": 4,
          "transitionNote": "",
          "visualDescription": "s1 visual",
          "visualNotes": "s1 visual",
          "visualQueries": {
            "alternatives": [
              "s1 primary",
              "s1 alt two",
              "s1 primary close-up",
            ],
            "primary": "s1 alt one",
          },
        },
        {
          "durationOverrideSec": null,
          "energy": "medium",
          "estDurationSec": 9,
          "kind": "section",
          "label": "s1",
          "musicMood": "s1 mood",
          "narration": "Second sentence has seven words for this. Tiny part.",
          "order": 2,
          "queryVariant": false,
          "sectionId": "s1",
          "startSec": 11,
          "transitionNote": "",
          "visualDescription": "s1 visual",
          "visualNotes": "s1 visual",
          "visualQueries": {
            "alternatives": [
              "s1 primary",
              "s1 alt one",
              "s1 primary close-up",
            ],
            "primary": "s1 alt two",
          },
        },
        {
          "durationOverrideSec": null,
          "energy": "medium",
          "estDurationSec": 4,
          "kind": "section",
          "label": "s2",
          "musicMood": "s2 mood",
          "narration": "one two three four.",
          "order": 3,
          "queryVariant": false,
          "sectionId": "s2",
          "startSec": 20,
          "transitionNote": "",
          "visualDescription": "s2 visual",
          "visualNotes": "s2 visual",
          "visualQueries": {
            "alternatives": [
              "s2 alt one",
              "s2 alt two",
              "s2 primary close-up",
            ],
            "primary": "s2 primary",
          },
        },
        {
          "durationOverrideSec": null,
          "energy": "medium",
          "estDurationSec": 4,
          "kind": "section",
          "label": "s2",
          "musicMood": "s2 mood",
          "narration": "five six seven eight.",
          "order": 4,
          "queryVariant": false,
          "sectionId": "s2",
          "startSec": 24,
          "transitionNote": "",
          "visualDescription": "s2 visual",
          "visualNotes": "s2 visual",
          "visualQueries": {
            "alternatives": [
              "s2 primary",
              "s2 alt two",
              "s2 primary close-up",
            ],
            "primary": "s2 alt one",
          },
        },
        {
          "durationOverrideSec": null,
          "energy": "medium",
          "estDurationSec": 4,
          "kind": "section",
          "label": "s2",
          "musicMood": "s2 mood",
          "narration": "nine ten eleven twelve.",
          "order": 5,
          "queryVariant": false,
          "sectionId": "s2",
          "startSec": 28,
          "transitionNote": "",
          "visualDescription": "s2 visual",
          "visualNotes": "s2 visual",
          "visualQueries": {
            "alternatives": [
              "s2 primary",
              "s2 alt one",
              "s2 primary close-up",
            ],
            "primary": "s2 alt two",
          },
        },
        {
          "durationOverrideSec": null,
          "energy": "medium",
          "estDurationSec": 2,
          "kind": "outro",
          "label": "Outro",
          "musicMood": "s2 mood",
          "narration": "Closing text.",
          "order": 6,
          "queryVariant": true,
          "sectionId": null,
          "startSec": 32,
          "transitionNote": "",
          "visualDescription": "s2 visual",
          "visualNotes": "s2 visual",
          "visualQueries": {
            "alternatives": [
              "s2 primary",
              "s2 alt one",
              "s2 alt two",
            ],
            "primary": "s2 primary close-up",
          },
        },
      ]
    `);
  });

  it("emits no beat keys at all for scripts without beat fields", () => {
    for (const scene of [...planScenes(oldScript, settingsVi), ...planScenes(multiScript, settingsEn)]) {
      for (const key of BEAT_KEYS) {
        expect(key in scene).toBe(false);
      }
    }
  });
});
