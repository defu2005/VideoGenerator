import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScriptSchema, planScenes, TimelineSchema, type Timeline } from "@vg/shared";
import { RenderService, type MediaTools } from "../src/services/renderService.js";
import { projectDir } from "../src/storage/paths.js";
import { createPipelineHarness } from "./pipelineFixtures.js";

// TASK-145 back-compat (guide line 230): a script saved before the beat fields existed must render the timeline
// through fake ffmpeg. fakeTools and setup are copied from render.test.ts (not exported there); that file is unchanged.

type Harness = ReturnType<typeof createPipelineHarness>;
const harnesses: Harness[] = [];
afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.close();
});

const ASS = `[Script Info]
ScriptType: v4.00+
PlayResX: 160
PlayResY: 90

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,10,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,1,0,2,4,4,4,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.10,0:00:01.00,Default,,0,0,0,,Xin chào
`;

const motion = { type: "kenburns" as const, from: { zoom: 1, x: 0.5, y: 0.5 }, to: { zoom: 1.12, x: 0.5, y: 0.5 } };

// Same shape as render.test.ts setup(): a real harness, a project folder with fixture media, a Timeline value.
function setup(timeline: Timeline) {
  const harness = createPipelineHarness();
  harnesses.push(harness);
  const dir = projectDir(harness.config.DATA_DIR, harness.projectId);
  for (const folder of ["visuals", "voice", "music", "timeline"]) mkdirSync(join(dir, folder), { recursive: true });
  writeFileSync(join(dir, "visuals/a.png"), "png");
  writeFileSync(join(dir, "voice/a.wav"), "wav");
  writeFileSync(join(dir, "music/m.wav"), "wav");
  writeFileSync(join(dir, "timeline/subtitles.ass"), ASS);
  writeFileSync(join(dir, "timeline/subtitles.srt"), "1\n00:00:00,100 --> 00:00:01,000\nXin chào\n");
  const state = { timeline, inputHash: "old-script-render-hash" };
  const timelines = { get: () => ({ timeline: state.timeline, inputHash: state.inputHash, updatedAt: "now" }) };
  return { harness, dir, timelines, project: () => harness.repository.getProject(harness.projectId)! };
}

/** A fake ffmpeg: writes whatever output file the args name, records each call. */
function fakeTools(durationSec: number) {
  const calls: { args: string[]; cwd?: string }[] = [];
  const tools: MediaTools = {
    ffmpeg: vi.fn(async (args, options) => {
      calls.push({ args, cwd: options.cwd });
      const out = args[args.length - 1];
      if (out !== "-") writeFileSync(options.cwd && !out.includes(":") && !out.startsWith("/") ? join(options.cwd, out) : out, "x");
      options.onStdout?.("out_time_us=1500000\n");
      return { stdout: "", stderr: "" };
    }),
    probe: vi.fn(async () => ({ durationSec, width: 160, height: 90, hasVideo: true, hasAudio: true })),
  };
  return { tools, calls };
}

// Old script: no beatPurpose, emotion, visualIntent, factIds, opensLoops, closesLoops or sectionKey.
const oldScript = {
  title: "Bản cũ",
  hook: "Một câu mở đầu.",
  sections: [{
    id: "s1", heading: "Phần một", narration: "Nội dung phần một.",
    visualQueries: { primary: "phần một", alternatives: ["alt"] }, visualNotes: "ghi chú",
    musicMood: "calm", energy: "medium", estDurationSec: 10,
  }],
  outro: "Kết thúc.",
  music: { mood: "", energy: "medium", keywords: [] },
};
const settings = { sceneDurationSec: 5, wordsPerMinute: 120, language: "vi" } as never;

/** Builds the Timeline a render reads from planScenes output: order, timing and the fixture media the schema needs. */
function timelineFromPlan(scenes: ReturnType<typeof planScenes>): Timeline {
  let cursor = 0;
  const built = scenes.map((scene, index) => {
    const durationSec = scene.durationOverrideSec ?? scene.estDurationSec;
    const startSec = cursor;
    cursor += durationSec;
    return {
      sceneId: randomUUID(), order: index, label: scene.label, startSec, endSec: cursor, durationSec,
      durationFrames: Math.round(durationSec * 30),
      voice: null,
      visuals: [{ kind: "PLACEHOLDER" as const, candidateId: null, path: null, startSec, endSec: cursor, motion, licenseKind: null }],
      fadeInSec: 0.25, fadeOutSec: 0.25,
    };
  });
  return TimelineSchema.parse({
    formatVersion: 1,
    target: { width: 160, height: 90, fps: 30 },
    totalDurationSec: cursor,
    scenes: built,
    music: null,
    subtitles: null,
    warnings: [],
    licenseSummary: {},
  });
}

describe("old script renders the timeline with fake ffmpeg (TASK-145 back-compat)", () => {
  it("renders hook, section and outro in order for a script with no beat fields", async () => {
    const plans = planScenes(ScriptSchema.parse(oldScript), settings);
    const timeline = timelineFromPlan(plans);
    const { harness, timelines, project } = setup(timeline);
    const { tools } = fakeTools(timeline.totalDurationSec);
    const service = new RenderService(harness.sqlite, harness.config, timelines, tools);
    const { render } = await service.render(project(), new AbortController().signal);

    expect(render.report.ok).toBe(true);
    expect(render.report.clipsRendered).toBe(timeline.scenes.length);
    const kinds = plans.map((scene) => scene.kind);
    expect(kinds).toEqual(["hook", "section", "outro"]);
    expect(timeline.scenes.map((scene) => scene.order)).toEqual([0, 1, 2]);
    expect(timeline.scenes.map((scene) => scene.label)).toEqual(plans.map((scene) => scene.label));
  });
});
