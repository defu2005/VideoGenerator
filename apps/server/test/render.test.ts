import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TimelineSchema, type Timeline } from "@vg/shared";
import { registerRenderRoutes } from "../src/api/render.js";
import { runFfmpeg } from "../src/media/ffmpeg.js";
import { StageError } from "../src/pipeline/stageExecutor.js";
import { RenderService, type MediaTools } from "../src/services/renderService.js";
import { RenderExecutor } from "../src/stages/render/renderExecutor.js";
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

function setup(options: { subtitles?: boolean; music?: boolean } = {}) {
  const harness = createPipelineHarness();
  harnesses.push(harness);
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

describe("RenderService with a fake ffmpeg", () => {
  it("renders clips, the final pass, sidecars and thumbnails, then reuses everything", async () => {
    const { harness, dir, timelines, project } = setup();
    const { tools, calls } = fakeTools();
    const service = new RenderService(harness.sqlite, harness.config, timelines, tools);
    const progress = vi.fn();
    const { render, reused } = await service.render(project(), new AbortController().signal, progress);

    expect(reused).toBe(false);
    expect(render.report.clipsRendered).toBe(2);
    expect(render.report.ok).toBe(true);
    expect(render.report.thumbnails).toEqual([SCENE_A, SCENE_B]);
    const final = calls.find((call) => call.args.includes("output.part.mp4"))!;
    expect(final.cwd).toBe(join(dir, "render"));
    expect(final.args).toContain("-filter_complex_script");
    expect(final.args).toEqual(expect.arrayContaining(["-map", "[vout]", "-map", "[aout]", "-movflags", "+faststart"]));
    expect(existsSync(join(dir, "render/output.mp4"))).toBe(true);
    expect(existsSync(join(dir, "render/output.part.mp4"))).toBe(false);
    expect(readFileSync(join(dir, "render/subtitles.ass"), "utf8")).toBe(ASS);
    expect(readFileSync(join(dir, "render/credits.txt"), "utf8")).toContain("Giấy phép: chưa rõ");
    expect(render.hasSubtitles).toBe(true);
    expect(progress).toHaveBeenCalledWith(78, expect.any(String));
    expect(service.get(harness.projectId).render?.id).toBe(render.id);

    const count = calls.length;
    const again = await service.render(project(), new AbortController().signal);
    expect(again.reused).toBe(true);
    expect(calls.length).toBe(count);
  });

  it("reuses cached clips when only the mix changes", async () => {
    const { harness, state, timelines, project } = setup();
    const { tools, calls } = fakeTools();
    const service = new RenderService(harness.sqlite, harness.config, timelines, tools);
    await service.render(project(), new AbortController().signal);
    state.inputHash = "timeline-hash-2";
    state.timeline = { ...state.timeline, music: { ...state.timeline.music!, volume: 0.1 } };
    calls.length = 0;
    const { render, reused } = await service.render(project(), new AbortController().signal);
    expect(reused).toBe(false);
    expect(render.report.clipsReused).toBe(2);
    expect(render.report.clipsRendered).toBe(0);
    expect(calls.filter((call) => call.args.some((arg) => arg.endsWith(".part.mp4") && arg !== "output.part.mp4"))).toHaveLength(0);
  });

  it("leaves no output and no row when ffmpeg fails", async () => {
    const { harness, dir, timelines, project } = setup();
    const { tools } = fakeTools({ failOn: (args) => args.includes("output.part.mp4") });
    const service = new RenderService(harness.sqlite, harness.config, timelines, tools);
    const error = await service.render(project(), new AbortController().signal).catch((caught) => caught);
    expect(error).toBeInstanceOf(StageError);
    expect((error as StageError).code).toBe("RENDER_FINAL_FAILED");
    expect(existsSync(join(dir, "render/output.mp4"))).toBe(false);
    expect(readdirSync(join(dir, "render")).some((name) => name.includes(".part."))).toBe(false);
    expect(service.get(harness.projectId).render).toBeNull();
  });

  it("stops on abort", async () => {
    const { harness, timelines, project } = setup();
    const { tools } = fakeTools({ hang: true });
    const service = new RenderService(harness.sqlite, harness.config, timelines, tools);
    const controller = new AbortController();
    const pending = service.render(project(), controller.signal);
    setTimeout(() => controller.abort(), 10);
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(service.get(harness.projectId).render).toBeNull();
  });

  it("reports probe problems without failing the render", async () => {
    const { harness, timelines, project } = setup();
    const { tools } = fakeTools();
    tools.probe = vi.fn(async () => ({ durationSec: 2.5, width: 160, height: 90, hasVideo: true, hasAudio: false }));
    const service = new RenderService(harness.sqlite, harness.config, timelines, tools);
    const { render } = await service.render(project(), new AbortController().signal);
    expect(render.report.ok).toBe(false);
    expect(render.report.issues.map((issue) => issue.code)).toEqual(["NO_AUDIO", "DURATION_MISMATCH"]);
  });

  it("asks for a timeline first", async () => {
    const { harness, project } = setup();
    const service = new RenderService(harness.sqlite, harness.config, { get: () => ({ timeline: null, inputHash: null, updatedAt: null }) }, fakeTools().tools);
    await expect(service.render(project(), new AbortController().signal)).rejects.toMatchObject({ code: "RENDER_NO_TIMELINE" });
  });

  it("serves the render over the API with ranges and guarded thumbnails", async () => {
    const { harness, timelines, project } = setup();
    const service = new RenderService(harness.sqlite, harness.config, timelines, fakeTools().tools);
    const app = Fastify();
    registerRenderRoutes(app, service, { getProject: async (id) => harness.repository.getProject(id) });
    const empty = await app.inject({ method: "GET", url: `/api/projects/${harness.projectId}/render` });
    expect(empty.json()).toEqual({ render: null });

    await service.render(project(), new AbortController().signal);
    const meta = await app.inject({ method: "GET", url: `/api/projects/${harness.projectId}/render` });
    expect(meta.json().render.width).toBe(160);
    const ranged = await app.inject({ method: "GET", url: `/api/projects/${harness.projectId}/render/video`, headers: { range: "bytes=0-0" } });
    expect(ranged.statusCode).toBe(206);
    const credits = await app.inject({ method: "GET", url: `/api/projects/${harness.projectId}/render/credits` });
    expect(credits.headers["content-disposition"]).toContain("credits.txt");
    const thumb = await app.inject({ method: "GET", url: `/api/projects/${harness.projectId}/render/thumbs/${SCENE_A}` });
    expect(thumb.statusCode).toBe(200);
    const unknown = await app.inject({ method: "GET", url: `/api/projects/${harness.projectId}/render/thumbs/33333333-3333-4333-8333-333333333333` });
    expect(unknown.statusCode).toBe(404);
    await app.close();
  });
});

describe("RenderService with real ffmpeg", () => {
  it("renders a tiny two-scene video that passes its own checks", async () => {
    const { harness, dir, timelines, project } = setup();
    const ff = (args: string[]) => runFfmpeg(["-y", "-hide_banner", "-loglevel", "error", ...args]);
    await ff(["-f", "lavfi", "-i", "testsrc=s=320x240:d=1", "-frames:v", "1", join(dir, "visuals/a.png")]);
    await ff(["-f", "lavfi", "-i", "sine=f=440:d=1", "-ac", "1", join(dir, "voice/a.wav")]);
    await ff(["-f", "lavfi", "-i", "sine=f=220:d=2", join(dir, "music/m.wav")]);

    const service = new RenderService(harness.sqlite, harness.config, timelines);
    const executor = new RenderExecutor(service);
    const job = harness.repository.createJob({ projectId: harness.projectId, stage: "RENDER", maxAttempts: 1, previousState: "PENDING" });
    const result = await executor.run({
      project: project(),
      job,
      signal: new AbortController().signal,
      reportProgress: vi.fn(),
      recordUsage: vi.fn(),
      logger: Fastify({ logger: { level: "silent" } }).log,
    });
    const render = service.get(harness.projectId).render!;
    expect(result.message).toContain("160×90");
    expect(render.report.issues).toEqual([]);
    expect(render.report.ok).toBe(true);
    expect(Math.abs(render.durationSec - 3)).toBeLessThanOrEqual(0.2);
    expect(render.report.hasAudio).toBe(true);
    expect(render.report.thumbnails).toHaveLength(2);
    expect(existsSync(join(dir, "render/thumbs", `${SCENE_A}.jpg`))).toBe(true);
  }, 60_000);
});
