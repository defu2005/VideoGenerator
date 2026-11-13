import { existsSync, mkdirSync, readFileSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComposePlanSchema, EditSettingsSchema, TimelineSchema, type ComposePlan, type Timeline } from "@vg/shared";
import { RenderService, type MediaTools } from "../src/services/renderService.js";
import { projectDir } from "../src/storage/paths.js";
import { createPipelineHarness } from "./pipelineFixtures.js";

type Harness = ReturnType<typeof createPipelineHarness>;
const harnesses: Harness[] = [];

afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.close();
});

const SCENE_A = "11111111-1111-4111-8111-111111111111";
const SCENE_B = "22222222-2222-4222-8222-222222222222";
const motion = { type: "kenburns" as const, from: { zoom: 1, x: 0.5, y: 0.5 }, to: { zoom: 1.12, x: 0.5, y: 0.5 } };

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

const FIXED_PROJECT_ID = "99999999-9999-4999-8999-999999999999";

/** Give the harness project a fixed id so clip hashes (which include it) are stable between runs. */
function pinProjectId(harness: Harness): void {
  const db = harness.sqlite;
  db.pragma("foreign_keys = OFF");
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>)
    .map((row) => row.name)
    .filter((name) => (db.prepare(`PRAGMA table_info("${name}")`).all() as Array<{ name: string }>).some((c) => c.name === "project_id"));
  for (const table of tables) db.prepare(`UPDATE "${table}" SET project_id = ? WHERE project_id = ?`).run(FIXED_PROJECT_ID, harness.projectId);
  db.prepare("UPDATE projects SET id = ? WHERE id = ?").run(FIXED_PROJECT_ID, harness.projectId);
  db.pragma("foreign_keys = ON");
  (harness as { projectId: string }).projectId = FIXED_PROJECT_ID;
}

function setup(options: { subtitles?: boolean; music?: boolean } = {}) {
  const harness = createPipelineHarness();
  harnesses.push(harness);
  pinProjectId(harness);
  const dir = projectDir(harness.config.DATA_DIR, harness.projectId);
  for (const folder of ["visuals", "voice", "music", "timeline"]) mkdirSync(join(dir, folder), { recursive: true });
  const timeline: Timeline = TimelineSchema.parse({
    formatVersion: 1,
    target: { width: 160, height: 90, fps: 30 },
    totalDurationSec: 3,
    scenes: [
      {
        sceneId: SCENE_A, order: 0, label: "Một", startSec: 0, endSec: 1.5, durationSec: 1.5, durationFrames: 45,
        voice: { trackId: "t1", path: "voice/a.wav", startSec: 0.1, durationSec: 1 },
        visuals: [{ kind: "IMAGE", candidateId: "c1", path: "visuals/a.png", startSec: 0, endSec: 1.5, motion, licenseKind: "CC0" }],
        fadeInSec: 0.5, fadeOutSec: 0.25,
      },
      {
        sceneId: SCENE_B, order: 1, label: "Hai", startSec: 1.5, endSec: 3, durationSec: 1.5, durationFrames: 45,
        voice: null,
        visuals: [{ kind: "PLACEHOLDER", candidateId: null, path: null, startSec: 1.5, endSec: 3, motion, licenseKind: null }],
        fadeInSec: 0.25, fadeOutSec: 0.8,
      },
    ],
    music: options.music === false ? null : {
      candidateId: "m1", title: "Calm", path: "music/m.wav", sourceDurationSec: 2, loop: true, startOffsetSec: 0,
      volume: 0.3, fadeInSec: 0.5, fadeOutSec: 0.5, duckingDb: -12, licenseKind: "CC0",
    },
    subtitles: options.subtitles === false ? null : {
      srtPath: join(dir, "timeline", "subtitles.srt"), assPath: join(dir, "timeline", "subtitles.ass"), cueCount: 1,
    },
    warnings: [],
    licenseSummary: { CC0: 2 },
  });
  writeFileSync(join(dir, "visuals/a.png"), "png");
  writeFileSync(join(dir, "voice/a.wav"), "wav");
  writeFileSync(join(dir, "music/m.wav"), "wav");
  for (const file of ["visuals/a.png", "voice/a.wav", "music/m.wav"]) utimesSync(join(dir, file), 1_700_000_000, 1_700_000_000);
  writeFileSync(join(dir, "timeline/subtitles.ass"), ASS);
  writeFileSync(join(dir, "timeline/subtitles.srt"), "1\n00:00:00,100 --> 00:00:01,000\nXin chào\n");
  const state = { timeline, inputHash: "timeline-hash-1" };
  const timelines = { get: () => ({ timeline: state.timeline, inputHash: state.inputHash, updatedAt: "now" }) };
  return { harness, dir, state, timelines, project: () => harness.repository.getProject(harness.projectId)! };
}

/** A fake ffmpeg: writes whatever output file the args name, records each call. */
function fakeTools(overrides: { failOn?: (args: string[]) => boolean; hang?: boolean } = {}) {
  const calls: { args: string[]; cwd?: string }[] = [];
  const tools: MediaTools = {
    ffmpeg: vi.fn(async (args, options) => {
      calls.push({ args, cwd: options.cwd });
      if (overrides.hang) {
        await new Promise((_, reject) => options.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
      }
      if (overrides.failOn?.(args)) throw new Error("Invalid filtergraph");
      const out = args[args.length - 1];
      if (out !== "-") writeFileSync(options.cwd && !out.includes(":") && !out.startsWith("/") ? join(options.cwd, out) : out, "x");
      options.onStdout?.("out_time_us=1500000\n");
      return { stdout: "", stderr: "" };
    }),
    probe: vi.fn(async () => ({ durationSec: 3, width: 160, height: 90, hasVideo: true, hasAudio: true })),
  };
  return { tools, calls };
}


const GOLDEN = join(import.meta.dirname, "fixtures", "renderSplit.golden.json");

function composePlanFixture(): ComposePlan {
  return ComposePlanSchema.parse({
    version: 1, engine: "compose", preset: "story", aspect: "16:9",
    scenes: [
      {
        sceneId: SCENE_A, durationSec: 1.5, durationFrames: 45, fps: 30, warnings: [],
        shots: [{ id: "a", kind: "still", startSec: 0, endSec: 1.5, reason: "baseline",
          source: { kind: "still", candidateId: "c1", path: "visuals/a.png", motion: "static" } }],
      },
      {
        sceneId: SCENE_B, durationSec: 1.5, durationFrames: 45, fps: 30, warnings: [],
        shots: [{ id: "b", kind: "footage", startSec: 0, endSec: 1.5, reason: "baseline",
          source: { kind: "footage", clipId: "clip-1", path: "footage/a.mp4", inSec: 0,
            license: { provider: "pexels", clipId: "clip-1", author: "Ada Footage", licenseName: "Pexels License", pageUrl: "https://www.pexels.com/video/1" } } }],
      },
    ],
    stats: { shotsPerMin: 40, meanShotSec: 1.5, stdevShotSec: 0, kindEntropyBits: 1, maxSameKindRun: 1, wordGapCutPct: 1, beatCutPct: null,
      kindShare: { still: 0.5, footage: 0.5, kinetic_text: 0, chart: 0 } },
  });
}

async function capture(name: "default" | "hooked") {
  const { harness, dir, timelines, project } = setup();
  const { tools, calls } = fakeTools();
  mkdirSync(join(dir, "footage"), { recursive: true });
  writeFileSync(join(dir, "footage/a.mp4"), "mp4");
  utimesSync(join(dir, "footage/a.mp4"), 1_700_000_000, 1_700_000_000);
  const now = () => new Date("2026-01-02T03:04:05.000Z");
  const service = name === "hooked"
    ? new RenderService(harness.sqlite, harness.config, timelines, tools, now, undefined, undefined, {
      plan: async () => ({ plan: composePlanFixture(), warnings: ["Cảnh 9: thử"] }),
      renderScene: async (_p, _s, _t, _c, outPath) => { writeFileSync(outPath, "clip"); return { frames: 45, warnings: [], graphicShots: [] }; },
    })
    : new RenderService(harness.sqlite, harness.config, timelines, tools, now);
  const { render } = await service.render(project(), new AbortController().signal);
  const row = harness.sqlite.prepare("SELECT * FROM renders WHERE id = ?").get(render.id) as Record<string, unknown>;
  const report = JSON.parse(String(row.report)) as Record<string, unknown>;
  delete report.elapsedSec;
  const versionDir = join(dir, "render", "versions", render.id);
  const text = JSON.stringify({
    inputHash: render.inputHash,
    report,
    row: { ...row, id: "<id>", report: "<report>", output_path: "<out>", credits_path: "<c>", srt_path: "<s>", created_at: "<t>" },
    ffmpeg: calls.map((c) => ({ ...c, args: c.args })),
    versionFiles: readdirSync(versionDir).sort(),
    renderFiles: readdirSync(join(dir, "render")).sort(),
    subtitlesAss: readFileSync(join(dir, "render", "subtitles.ass"), "utf8"),
    credits: readFileSync(join(versionDir, "credits.txt"), "utf8"),
  }, null, 1);
  return text
    .split(render.id).join("<RID>")
    .split(JSON.stringify(dir).slice(1, -1)).join("<DIR>")
    .split(JSON.stringify(harness.config.DATA_DIR).slice(1, -1)).join("<DATA>");
}

describe("render golden (guide step 1: the split must not change output)", () => {
  it("keeps input hash, report and ffmpeg calls identical", async () => {
    const out = { default: await capture("default"), hooked: await capture("hooked") };
    if (process.env.UPDATE_GOLDEN === "1" || !existsSync(GOLDEN)) {
      writeFileSync(GOLDEN, JSON.stringify(out, null, 1));
      return;
    }
    const golden = JSON.parse(readFileSync(GOLDEN, "utf8")) as typeof out;
    expect(out.default).toBe(golden.default);
    expect(out.hooked).toBe(golden.hooked);
  });
});
