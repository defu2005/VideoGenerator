import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { PROTECTED_PROJECT_ID, TimelineSchema, ComposePlanSchema, computeStats, MOTION_TEMPLATE_IDS, type Project, type Shot, type Timeline } from "@vg/shared";
import { resolveFfmpegPath, resolveFfprobePath } from "../src/media/ffmpeg.js";
import { ResourceGovernor } from "../src/jobs/resourceGovernor.js";
import { PreviewService, previewTarget } from "../src/preview/service.js";
import { previewBrowserPath, previewGraphicAsset } from "../src/preview/shotRenderer.js";
import { baseShotFacts, markNearDuplicates, measuredSafeArea, safeAreaCheck } from "../src/preview/facts.js";
import { loadPreviewPlan, type PreviewPlan, type PreviewScene } from "../src/preview/planSource.js";
import { composeInputFingerprint, PLAN_INPUTS_FILE, writePlanInputs } from "../src/compose/planInputs.js";
import { renderSingleShot } from "../src/compose/sceneClip.js";
import { editSavedComposeShot, prepareComposePlan } from "../src/services/composeBridge.js";
import { projectDir } from "../src/storage/paths.js";
import { createPipelineHarness } from "./pipelineFixtures.js";

type Harness = ReturnType<typeof createPipelineHarness>;
const harnesses: Harness[] = [];
afterEach(() => { for (const harness of harnesses.splice(0)) harness.close(); });

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("error", rejectPromise);
    child.on("close", (code) => (code === 0 ? resolvePromise(stdout) : rejectPromise(new Error(stderr))));
  });
}
const probe = async (file: string, entries: string) =>
  JSON.parse(await run(resolveFfprobePath(), ["-v", "error", "-show_entries", entries, "-of", "json", file])) as {
    streams?: { codec_type?: string; width?: number; height?: number }[]; format?: { duration?: string };
  };

const footage = (id: string, clip: string, start: number, end: number): Shot => ({
  id, kind: "footage", startSec: start, endSec: end, reason: "test",
  source: {
    kind: "footage", clipId: id, path: clip, inSec: 0,
    license: { provider: "pexels", clipId: id, author: "T", licenseName: "Pexels License", pageUrl: "https://www.pexels.com/video/x" },
  },
});

type Clips = { a: string; b: string; black: string };
type Setup = ReturnType<typeof setup>;
function setup(options: { spy?: boolean; governor?: { tryAcquirePreview: () => boolean; releasePreview: () => void } } = {}) {
  const harness = createPipelineHarness();
  harnesses.push(harness);
  const dir = projectDir(harness.config.DATA_DIR, harness.projectId);
  mkdirSync(dir, { recursive: true });
  return { harness, dir, options, rendered: [] as string[] };
}

async function makeClip(file: string, source: string) {
  await run(resolveFfmpegPath(), ["-y", "-f", "lavfi", "-i", source, "-frames:v", "90", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", file]);
}

function planOf(clips: Clips, voice: string | null = null, ass: string | null = null): PreviewPlan {
  const scene = (index: number, shots: Shot[], voiceFile: string | null): PreviewScene => ({
    sceneId: randomUUID(), index, label: `Cảnh ${index + 1}`, startSec: index * 2, durationSec: 2,
    plan: { sceneId: `p${index}`, durationSec: 2, durationFrames: 60, fps: 30, shots, warnings: [] },
    voice: voiceFile ? { path: voiceFile, offsetSec: 0 } : null,
  });
  return {
    basis: "timeline", aspect: "16:9", fps: 30,
    scenes: [
      scene(0, [footage("s0a", clips.black, 0, 1), footage("s0b", clips.a, 1, 2)], voice),
      scene(1, [footage("s1a", clips.a, 0, 1), footage("s1b", clips.b, 1, 2)], null),
    ],
    subtitleAssPath: ass, cropByPath: new Map(), notes: [],
  };
}

async function build(s: Setup, plan: (clips: Clips) => PreviewPlan) {
  const clips = { a: join(s.dir, "a.mp4"), b: join(s.dir, "b.mp4"), black: join(s.dir, "black.mp4") };
  await makeClip(clips.a, "testsrc2=size=320x180:rate=30:duration=3");
  await makeClip(clips.b, "mandelbrot=size=320x180:rate=30");
  await makeClip(clips.black, "color=c=black:size=320x180:rate=30:duration=3");
  const loaded = plan(clips);
  const { harness } = s;
  const service = new PreviewService({
    sqlite: harness.sqlite, dataDir: harness.config.DATA_DIR,
    getProject: async (id) => harness.repository.getProject(id) as Project | undefined,
    timeline: () => null,
    planLoader: async () => loaded,
    ...(s.options.governor ? { governor: s.options.governor } : {}),
    ...(s.options.spy ? { renderShot: async (shot, target, ctx) => { s.rendered.push(shot.id); return renderSingleShot(shot, target, ctx); } } : {}),
    fontFile: () => null,
  });
  return { service, plan: loaded, clips };
}

describe("preview service", () => {
  it("renders the requested shot and its one neighbor sample and the second call hits the cache", async () => {
    const s = setup({ spy: true });
    const { service, plan } = await build(s, (clips) => planOf(clips));
    const first = await service.frame(s.harness.projectId, { atSec: 3.5 });
    expect(s.rendered).toEqual(["s1b", "s1a"]);
    expect(first.cached).toBe(false);
    expect(first.file.mime).toBe("image/jpeg");
    expect(first.facts).toHaveLength(1);
    expect(first.facts[0]!.shotId).toBe("s1b");
    expect(first.facts[0]!.distanceToPrev).toEqual(expect.any(Number));
    expect(first.width).toBe(previewTarget("16:9").width);
    const image = await probe(join(s.dir, "preview", first.file.name), "stream=width,height");
    expect(Math.max(image.streams![0]!.width!, image.streams![0]!.height!)).toBeLessThanOrEqual(480);
    const second = await service.frame(s.harness.projectId, { sceneId: plan.scenes[1]!.sceneId, offsetSec: 1.5 });
    expect(s.rendered).toEqual(["s1b", "s1a"]);
    expect(second.cached).toBe(true);
    expect(second.file.id).toBe(first.file.id);
  }, 60_000);

  it("builds a contact sheet with three tiles per shot and one fact per shot", async () => {
    const s = setup();
    const { service } = await build(s, (clips) => planOf(clips));
    const started = Date.now();
    const sheet = await service.contactSheet(s.harness.projectId, { sceneId: "all" });
    const elapsed = Date.now() - started;
    expect(sheet.tiles).toHaveLength(12);
    expect(sheet.facts).toHaveLength(4);
    expect(sheet.facts[0]!.lumaFlag).toBe("dark");
    expect(sheet.warnings.some((line) => line.includes("quá tối"))).toBe(true);
    const image = await probe(join(s.dir, "preview", sheet.file.name), "stream=width,height");
    expect(image.streams![0]!.width).toBe(sheet.width);
    expect(image.streams![0]!.height).toBe(sheet.height);
    expect(elapsed).toBeLessThan(20_000);
    const again = await service.contactSheet(s.harness.projectId, { sceneId: "all" });
    expect(again.cached).toBe(true);
  }, 90_000);

  it("makes a clip of at most 3 s with audio and burned subtitles", async () => {
    const s = setup();
    const voice = join(s.dir, "voice.wav");
    await run(resolveFfmpegPath(), ["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", voice]);
    const ass = join(s.dir, "subs.ass");
    writeFileSync(ass, [
      "[Script Info]", "ScriptType: v4.00+", "PlayResX: 1920", "PlayResY: 1080", "",
      "[V4+ Styles]",
      "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
      "Style: Default,Arial,120,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,4,0,2,10,10,60,1", "",
      "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
      "Dialogue: 0,0:00:00.00,0:00:06.00,Default,,0,0,0,,HELLO PREVIEW", "",
    ].join("\n"));
    const built = await build(s, (clips) => planOf(clips, voice, ass));
    const sceneId = built.plan.scenes[0]!.sceneId;
    const clip = await built.service.clip(s.harness.projectId, { sceneId, durationSec: 3 });
    const info = await probe(join(s.dir, "preview", clip.file.name), "stream=codec_type,width,height:format=duration");
    expect(Number(info.format!.duration)).toBeLessThanOrEqual(3.05);
    expect(Number(info.format!.duration)).toBeGreaterThan(1.5);
    expect(info.streams!.some((stream) => stream.codec_type === "audio")).toBe(true);
    expect(Math.max(...info.streams!.map((stream) => stream.width ?? 0))).toBeLessThanOrEqual(480);
    // Burned subtitles: the same clip without the ASS file differs at the same instant.
    const grab = async (file: string, out: string) => {
      await run(resolveFfmpegPath(), ["-y", "-ss", "1.5", "-i", file, "-frames:v", "1", "-q:v", "3", out]);
      return readFileSync(out);
    };
    const a = await grab(join(s.dir, "preview", clip.file.name), join(s.dir, "f-sub.jpg"));
    built.plan.subtitleAssPath = null;
    const bare = await built.service.clip(s.harness.projectId, { sceneId, durationSec: 3 });
    const b = await grab(join(s.dir, "preview", bare.file.name), join(s.dir, "f-bare.jpg"));
    expect(bare.file.id).not.toBe(clip.file.id);
    expect(a.equals(b)).toBe(false);
  }, 120_000);

  it("flags near-duplicate shots through the service", async () => {
    const s = setup();
    const { service } = await build(s, (clips) => {
      const plan = planOf(clips);
      plan.scenes[1]!.plan.shots[1] = footage("s1c", clips.a, 1, 2);
      return plan;
    });
    const sheet = await service.contactSheet(s.harness.projectId, { sceneId: "all" });
    expect(sheet.facts[3]!.nearDuplicateOfPrev).toBe(true);
    expect(sheet.warnings.some((line) => line.includes("gần giống"))).toBe(true);
  }, 90_000);

  it("includes the previous scene's last shot for frame, clip and per-scene sheet facts", async () => {
    const s = setup();
    const { service, plan } = await build(s, (clips) => planOf(clips));
    const sceneId = plan.scenes[1]!.sceneId;
    const id = s.harness.projectId;
    const results = [
      await service.frame(id, { sceneId, offsetSec: 0.5 }),
      await service.clip(id, { sceneId, durationSec: 0.9 }),
      await service.contactSheet(id, { sceneId }),
    ];
    for (const result of results) {
      expect(result.facts[0]?.shotId).toBe("s1a");
      expect(result.facts[0]?.distanceToPrev).toBe(0);
      expect(result.facts[0]?.nearDuplicateOfPrev).toBe(true);
    }
  }, 60_000);

  it("refuses with PREVIEW_BUSY when the governor is saturated, and never runs on the protected project", async () => {
    const busy = setup({ governor: { tryAcquirePreview: () => false, releasePreview: () => undefined } });
    const { service } = await build(busy, (clips) => planOf(clips));
    await expect(service.frame(busy.harness.projectId, { atSec: 0.5 })).rejects.toMatchObject({ code: "PREVIEW_BUSY" });
    expect(busy.rendered).toEqual([]);
    await expect(service.frame(PROTECTED_PROJECT_ID, { atSec: 0.5 })).rejects.toMatchObject({ code: "PROJECT_PROTECTED" });
  }, 60_000);

  it("leaves stage states and input versions unchanged", async () => {
    const s = setup();
    const { service } = await build(s, (clips) => planOf(clips));
    const snap = () => JSON.stringify({
      stages: s.harness.sqlite.prepare("SELECT * FROM project_stages ORDER BY stage").all(),
      project: s.harness.sqlite.prepare("SELECT stage, status, version FROM projects").all(),
    });
    const before = snap();
    await service.frame(s.harness.projectId, { atSec: 0.5 });
    await service.contactSheet(s.harness.projectId, { sceneId: "all" });
    expect(snap()).toBe(before);
  }, 90_000);

  it("uses the selection basis when TIMELINE is not DONE", async () => {
    const s = setup();
    const { harness } = s;
    const now = new Date().toISOString();
    const sceneId = randomUUID();
    harness.sqlite.prepare(
      `INSERT INTO scenes (id, project_id, "order", kind, section_id, label, narration, visual_notes, no_visual, visual_queries,
        music_mood, energy, est_duration_sec, duration_override_sec, start_sec, transition_note, origin, edited, input_hash, created_at, updated_at)
       VALUES (?, ?, 0, 'section', NULL, 'Mở đầu', 'một hai ba bốn', '', 1, ?, '', 'medium', 3, NULL, 0, '', 'AGENT', 0, 'x', ?, ?)`,
    ).run(sceneId, harness.projectId, JSON.stringify({ primary: "", alternatives: [] }), now, now);
    const service = new PreviewService({
      sqlite: harness.sqlite, dataDir: harness.config.DATA_DIR,
      getProject: async (id) => harness.repository.getProject(id) as Project | undefined,
      timeline: () => null, fontFile: () => null,
    });
    const result = await service.frame(harness.projectId, { sceneId, offsetSec: 0.5 });
    expect(result.basis).toBe("selection");
    expect(result.notes.join(" ")).toContain("ước lượng");
  }, 60_000);
});

describe("preview budgets", () => {
  it("captures graphic animation on the requested clock without encoding a full shot", async (test) => {
    try { previewBrowserPath(); } catch { test.skip(); return; }
    const s = setup();
    const { harness } = s;
    const sceneId = randomUUID();
    const shot: Shot = { id: "quote", kind: "quote_full", startSec: 0, endSec: 4, reason: "fixture",
      source: { kind: "quote_full", quote: "Chữ hiện dần theo thời gian", speaker: "Fixture", role: "Người kể", emphasis: [], reveal: "ghost" } };
    const plan: PreviewPlan = { basis: "timeline", aspect: "16:9", fps: 30, subtitleAssPath: null, cropByPath: new Map(), notes: [],
      scenes: [{ sceneId, index: 0, label: "Fixture", startSec: 0, durationSec: 4, voice: null,
        plan: { sceneId, durationSec: 4, durationFrames: 120, fps: 30, shots: [shot], warnings: [] } }] };
    const service = new PreviewService({ sqlite: harness.sqlite, dataDir: harness.config.DATA_DIR, timeline: () => null,
      getProject: async (id) => {
        const project = harness.repository.getProject(id);
        return project ? { ...project, settings: { ...project.settings, budget: { mode: "QUALITY" } } } as Project : undefined;
      }, planLoader: async () => plan });
    const early = await service.frame(harness.projectId, { atSec: 0.2 });
    const late = await service.frame(harness.projectId, { atSec: 3.5 });
    expect(early.atSec).toBe(0.2);
    expect(late.atSec).toBe(3.5);
    expect(readFileSync(service.filePath(harness.projectId, early.file.name)!).equals(readFileSync(service.filePath(harness.projectId, late.file.name)!))).toBe(false);
    expect(readdirSync(service.previewDir(harness.projectId)).every((file) => file.endsWith(".jpg") || file.endsWith(".jpg.json"))).toBe(true);
    expect(early.facts[0]?.safeArea.method).toBe("dom");
    expect(late.facts[0]?.safeArea.method).toBe("dom");
    const cached = await service.frame(harness.projectId, { atSec: 3.5 });
    expect(cached.cached).toBe(true);
    expect(cached.facts[0]?.safeArea).toEqual(late.facts[0]?.safeArea);
    const clip = await service.clip(harness.projectId, { sceneId, startSec: 0.5, durationSec: 3 });
    const info = await probe(service.filePath(harness.projectId, clip.file.name)!, "stream=codec_type:format=duration");
    expect(Number(info.format?.duration)).toBeCloseTo(3, 1);
    expect(info.streams?.some((stream) => stream.codec_type === "audio")).toBe(true);
    expect(readdirSync(service.previewDir(harness.projectId)).filter((file) => file.endsWith(".mp4"))).toEqual([clip.file.name]);
  }, 60_000);

  it("restricts inline graphic assets to the managed storage root", () => {
    const s = setup();
    const inside = join(s.dir, "fixture.jpg");
    writeFileSync(inside, "fixture");
    const ctx = { dataDir: s.harness.config.DATA_DIR, projectId: s.harness.projectId, outDir: s.dir, resolvePath: (path: string) => path };
    expect(previewGraphicAsset(ctx, inside)).toBe(inside);
    const sibling = join(projectDir(s.harness.config.DATA_DIR, randomUUID()), "fixture.jpg");
    mkdirSync(join(sibling, ".."), { recursive: true });
    writeFileSync(sibling, "fixture");
    expect(() => previewGraphicAsset(ctx, sibling)).toThrow("outside managed project storage");
    expect(() => previewGraphicAsset(ctx, fileURLToPath(new URL("./fixtures/images/tiny.jpg", import.meta.url)))).toThrow("outside managed project storage");
  });

  it("keeps a frame under 3 s, a 10-scene footage sheet under 20 s and a 3 s clip under 15 s", async () => {
    const s = setup();
    const built = await build(s, (clips) => {
      const base = planOf(clips);
      const scenes = Array.from({ length: 10 }, (_, index): PreviewScene => {
        const source = [clips.a, clips.b][index % 2]!;
        const shots: Shot[] = [footage(`b${index}a`, source, 0, 1), footage(`b${index}b`, clips.a, 1, 2)];
        return { ...base.scenes[0]!, sceneId: randomUUID(), index, startSec: index * 2, plan: { sceneId: `b${index}`, durationSec: 2, durationFrames: 60, fps: 30, shots, warnings: [] }, voice: null };
      });
      return { ...base, scenes };
    });
    const id = s.harness.projectId;
    let t0 = Date.now();
    await built.service.frame(id, { atSec: 1 });
    const frameMs = Date.now() - t0;
    t0 = Date.now();
    await built.service.contactSheet(id, { sceneId: "all" });
    const sheetMs = Date.now() - t0;
    t0 = Date.now();
    await built.service.clip(id, { sceneId: built.plan.scenes[3]!.sceneId, durationSec: 2 });
    const clipMs = Date.now() - t0;
    console.log(`PREVIEW_TIMINGS frame=${frameMs}ms sheet10=${sheetMs}ms clip=${clipMs}ms`);
    expect(frameMs).toBeLessThan(3000);
    expect(sheetMs).toBeLessThan(20_000);
    expect(clipMs).toBeLessThan(15_000);
  }, 120_000);
});

describe("preview facts", () => {
  const frame = { width: 1920, height: 1080 };
  it("reports a footage ID only for a footage shot", () => {
    const at = { sceneId: "s", sceneIndex: 0, videoStartSec: 0, aspect: "16:9" as const, frame };
    const still: Shot = { id: "still", kind: "still", startSec: 0, endSec: 1, reason: "fixture",
      source: { kind: "still", candidateId: "still-candidate", path: "fixture.jpg", motion: "static" } };
    expect(baseShotFacts({ ...at, shot: still })).toMatchObject({ footageId: null, template: null });
    expect(baseShotFacts({ ...at, shot: footage("footage-clip", "fixture.mp4", 0, 1) })).toMatchObject({ footageId: "footage-clip", template: null });
  });
  it("flags text that overflows the safe area", () => {
    expect(safeAreaCheck(["Hi"], "16:9", frame).overflow).toBe(false);
    expect(safeAreaCheck(["x".repeat(80)], "16:9", frame).overflow).toBe(true);
    expect(safeAreaCheck(Array.from({ length: 12 }, () => "một dòng khá dài để chiếm chỗ trên màn hình"), "9:16", { width: 1080, height: 1920 }).overflow).toBe(true);
  });

  it("marks near-duplicate neighbours by hash distance", () => {
    const row = (phash: string) => ({ phash, distanceToPrev: null as number | null, nearDuplicateOfPrev: false });
    const rows = [row("ffff0000ffff0000"), row("ffff0000ffff0001"), row("00000000ffffffff")];
    markNearDuplicates(rows);
    expect(rows[1]!.nearDuplicateOfPrev).toBe(true);
    expect(rows[2]!.nearDuplicateOfPrev).toBe(false);
  });

  it("checks the measured text position even when the text fits by character count", () => {
    expect(safeAreaCheck(["Hi"], "16:9", frame).overflow).toBe(false);
    const box = { left: 24, top: 16, right: 450, bottom: 230 };
    expect(measuredSafeArea(box, [{ left: 20, right: 40, top: 30, bottom: 46 }])).toMatchObject({ method: "dom", overflow: true });
    expect(measuredSafeArea(box, [{ left: 26, right: 40, top: 30, bottom: 46 }]).overflow).toBe(false);
  });

  it("keeps the hash distance but distinguishes flat images with different colors", () => {
    const output = { distanceToPrev: null as number | null, nearDuplicateOfPrev: false };
    const facts = [
      { ...output, phash: "0000000000000000", meanColor: [0, 0, 255] as [number, number, number] },
      { ...output, phash: "0000000000000000", meanColor: [0, 128, 0] as [number, number, number] },
      { ...output, phash: "0000000000000000", meanColor: [0, 125, 0] as [number, number, number] },
    ];
    markNearDuplicates(facts);
    expect(facts[1]).toMatchObject({ distanceToPrev: 0, nearDuplicateOfPrev: false });
    expect(facts[2]).toMatchObject({ distanceToPrev: 0, nearDuplicateOfPrev: true });
  });

  it("counts characters per second of on-screen text", () => {
    const shot: Shot = { id: "k", kind: "kinetic_text", startSec: 0, endSec: 2, reason: "t", source: { kind: "kinetic_text", lines: ["abcd", "efgh"], emphasis: [], style: "bold" } };
    const facts = baseShotFacts({ shot, sceneId: "s", sceneIndex: 0, videoStartSec: 0, aspect: "16:9", frame });
    expect(facts.textChars).toBe(8);
    expect(facts.charsPerSecond).toBe(4);
    expect(facts.template).toBe("kinetic_text");
  });
});

describe("preview governor class", () => {
  it("limits parallel previews", () => {
    const harness = createPipelineHarness();
    harnesses.push(harness);
    const governor = new ResourceGovernor({ sqlite: harness.sqlite, sampler: () => null as never, workerCap: 2, onChange: () => undefined, budgetStopped: () => false });
    expect(governor.tryAcquirePreview("a")).toBe(true);
    expect(governor.tryAcquirePreview("b")).toBe(true);
    expect(governor.tryAcquirePreview("c")).toBe(false);
    governor.releasePreview("a");
    expect(governor.tryAcquirePreview("c")).toBe(true);
  });
});

describe("preview plan freshness and validation regressions", () => {
  const motion = { type: "kenburns" as const, from: { zoom: 1, x: 0.5, y: 0.5 }, to: { zoom: 1, x: 0.5, y: 0.5 } };

  it("detects stale plan when timeline image changes and regenerates with new visual", async () => {
    const harness = createPipelineHarness();
    harnesses.push(harness);
    harness.orchestrator.getPipeline(harness.projectId);
    const sceneId = randomUUID();
    const dir = join(harness.config.DATA_DIR, "projects", harness.projectId, "render");
    mkdirSync(dir, { recursive: true });

    // Old saved plan has visuals/old.jpg
    const oldShot: Shot = {
      id: "old-shot", kind: "still", startSec: 0, endSec: 2, reason: "previous",
      source: { kind: "still", candidateId: "old-cand", path: "visuals/old.jpg", motion: "static" },
    };
    const saved = ComposePlanSchema.parse({
      version: 1, engine: "compose", preset: "calm", aspect: "16:9",
      scenes: [{ sceneId, durationSec: 2, durationFrames: 60, fps: 30, warnings: [], shots: [oldShot] }],
      stats: computeStats({ scenes: [{ sceneId, durationSec: 2, durationFrames: 60, fps: 30, warnings: [], shots: [oldShot] }] }, [], []),
    });
    writeFileSync(join(dir, "compose-plan.json"), JSON.stringify(saved));

    // Timeline is DONE and has visuals/new.jpg
    const tl: Timeline = TimelineSchema.parse({
      formatVersion: 1, target: { width: 1920, height: 1080, fps: 30 }, totalDurationSec: 2,
      scenes: [{
        sceneId, order: 0, label: "Scene 1", startSec: 0, endSec: 2, durationSec: 2, durationFrames: 60,
        voice: null, fadeInSec: 0, fadeOutSec: 0,
        visuals: [{
          kind: "IMAGE", candidateId: "new-cand", path: "visuals/new.jpg", startSec: 0, endSec: 2,
          motion,
          licenseKind: null,
        }],
      }],
      music: null, subtitles: null, warnings: [], licenseSummary: {},
    });
    harness.sqlite.prepare("UPDATE project_stages SET state='DONE' WHERE project_id=? AND stage='TIMELINE'").run(harness.projectId);

    const project = harness.repository.getProject(harness.projectId)!;
    const preview = await loadPreviewPlan({ sqlite: harness.sqlite, dataDir: harness.config.DATA_DIR, timeline: () => tl }, project);

    expect(preview.basis).toBe("timeline");
    const shot = preview.scenes[0]!.plan.shots[0]!;
    expect(shot.source).toMatchObject({ kind: "still", path: "visuals/new.jpg" });
    expect(preview.notes.some((n) => n.includes("timeline đã thay đổi"))).toBe(true);
  });

  it("detects stale plan when scene duration or order changes", async () => {
    const harness = createPipelineHarness();
    harnesses.push(harness);
    harness.orchestrator.getPipeline(harness.projectId);
    const sceneA = randomUUID();
    const sceneB = randomUUID();
    const dir = join(harness.config.DATA_DIR, "projects", harness.projectId, "render");
    mkdirSync(dir, { recursive: true });

    // Saved plan has order B then A, both duration 2s
    const shotsB: Shot[] = [{ id: "b", kind: "still", startSec: 0, endSec: 2, reason: "prev", source: { kind: "still", candidateId: "cand-b", path: "visuals/b.jpg", motion: "static" } }];
    const shotsA: Shot[] = [{ id: "a", kind: "still", startSec: 0, endSec: 2, reason: "prev", source: { kind: "still", candidateId: "cand-a", path: "visuals/a.jpg", motion: "static" } }];
    const saved = ComposePlanSchema.parse({
      version: 1, engine: "compose", preset: "calm", aspect: "16:9",
      scenes: [
        { sceneId: sceneB, durationSec: 2, durationFrames: 60, fps: 30, warnings: [], shots: shotsB },
        { sceneId: sceneA, durationSec: 2, durationFrames: 60, fps: 30, warnings: [], shots: shotsA },
      ],
      stats: computeStats({ scenes: [
        { sceneId: sceneB, durationSec: 2, durationFrames: 60, fps: 30, warnings: [], shots: shotsB },
        { sceneId: sceneA, durationSec: 2, durationFrames: 60, fps: 30, warnings: [], shots: shotsA },
      ] }, [], []),
    });
    writeFileSync(join(dir, "compose-plan.json"), JSON.stringify(saved));

    // Timeline has order A (4s) then B (2s)
    const tl: Timeline = TimelineSchema.parse({
      formatVersion: 1, target: { width: 1920, height: 1080, fps: 30 }, totalDurationSec: 6,
      scenes: [
        {
          sceneId: sceneA, order: 0, label: "A", startSec: 0, endSec: 4, durationSec: 4, durationFrames: 120,
          voice: null, fadeInSec: 0, fadeOutSec: 0,
          visuals: [{ kind: "IMAGE", candidateId: "cand-a", path: "visuals/a.jpg", startSec: 0, endSec: 4, motion, licenseKind: null }],
        },
        {
          sceneId: sceneB, order: 1, label: "B", startSec: 4, endSec: 6, durationSec: 2, durationFrames: 60,
          voice: null, fadeInSec: 0, fadeOutSec: 0,
          visuals: [{ kind: "IMAGE", candidateId: "cand-b", path: "visuals/b.jpg", startSec: 0, endSec: 2, motion, licenseKind: null }],
        },
      ],
      music: null, subtitles: null, warnings: [], licenseSummary: {},
    });
    harness.sqlite.prepare("UPDATE project_stages SET state='DONE' WHERE project_id=? AND stage='TIMELINE'").run(harness.projectId);

    const project = harness.repository.getProject(harness.projectId)!;
    const preview = await loadPreviewPlan({ sqlite: harness.sqlite, dataDir: harness.config.DATA_DIR, timeline: () => tl }, project);

    expect(preview.scenes).toHaveLength(2);
    expect(preview.scenes[0]!.sceneId).toBe(sceneA);
    expect(preview.scenes[0]!.durationSec).toBe(4);
    expect(preview.scenes[1]!.sceneId).toBe(sceneB);
    expect(preview.scenes[1]!.durationSec).toBe(2);
  });

  it("handles added or deleted scenes by regenerating to match current timeline", async () => {
    const harness = createPipelineHarness();
    harnesses.push(harness);
    harness.orchestrator.getPipeline(harness.projectId);
    const scene1 = randomUUID();
    const scene2 = randomUUID();
    const dir = join(harness.config.DATA_DIR, "projects", harness.projectId, "render");
    mkdirSync(dir, { recursive: true });

    // Saved plan only had scene 1
    const shots1: Shot[] = [{ id: "s1", kind: "still", startSec: 0, endSec: 2, reason: "prev", source: { kind: "still", candidateId: "c1", path: "visuals/1.jpg", motion: "static" } }];
    const saved = ComposePlanSchema.parse({
      version: 1, engine: "compose", preset: "calm", aspect: "16:9",
      scenes: [{ sceneId: scene1, durationSec: 2, durationFrames: 60, fps: 30, warnings: [], shots: shots1 }],
      stats: computeStats({ scenes: [{ sceneId: scene1, durationSec: 2, durationFrames: 60, fps: 30, warnings: [], shots: shots1 }] }, [], []),
    });
    writeFileSync(join(dir, "compose-plan.json"), JSON.stringify(saved));

    // Timeline now has scene 1 and scene 2
    const tl: Timeline = TimelineSchema.parse({
      formatVersion: 1, target: { width: 1920, height: 1080, fps: 30 }, totalDurationSec: 4,
      scenes: [
        {
          sceneId: scene1, order: 0, label: "1", startSec: 0, endSec: 2, durationSec: 2, durationFrames: 60,
          voice: null, fadeInSec: 0, fadeOutSec: 0,
          visuals: [{ kind: "IMAGE", candidateId: "c1", path: "visuals/1.jpg", startSec: 0, endSec: 2, motion, licenseKind: null }],
        },
        {
          sceneId: scene2, order: 1, label: "2", startSec: 2, endSec: 4, durationSec: 2, durationFrames: 60,
          voice: null, fadeInSec: 0, fadeOutSec: 0,
          visuals: [{ kind: "IMAGE", candidateId: "c2", path: "visuals/2.jpg", startSec: 0, endSec: 2, motion, licenseKind: null }],
        },
      ],
      music: null, subtitles: null, warnings: [], licenseSummary: {},
    });
    harness.sqlite.prepare("UPDATE project_stages SET state='DONE' WHERE project_id=? AND stage='TIMELINE'").run(harness.projectId);

    const project = harness.repository.getProject(harness.projectId)!;
    const preview = await loadPreviewPlan({ sqlite: harness.sqlite, dataDir: harness.config.DATA_DIR, timeline: () => tl }, project);

    expect(preview.scenes).toHaveLength(2);
    expect(preview.scenes[0]!.sceneId).toBe(scene1);
    expect(preview.scenes[1]!.sceneId).toBe(scene2);
  });

  it("handles malformed JSON and schema mismatches gracefully", async () => {
    const harness = createPipelineHarness();
    harnesses.push(harness);
    harness.orchestrator.getPipeline(harness.projectId);
    const sceneId = randomUUID();
    const dir = join(harness.config.DATA_DIR, "projects", harness.projectId, "render");
    mkdirSync(dir, { recursive: true });

    writeFileSync(join(dir, "compose-plan.json"), "{ invalid-json: true");

    const tl: Timeline = TimelineSchema.parse({
      formatVersion: 1, target: { width: 1920, height: 1080, fps: 30 }, totalDurationSec: 2,
      scenes: [{
        sceneId, order: 0, label: "1", startSec: 0, endSec: 2, durationSec: 2, durationFrames: 60,
        voice: null, fadeInSec: 0, fadeOutSec: 0,
        visuals: [{ kind: "IMAGE", candidateId: "c", path: "visuals/img.jpg", startSec: 0, endSec: 2, motion, licenseKind: null }],
      }],
      music: null, subtitles: null, warnings: [], licenseSummary: {},
    });
    harness.sqlite.prepare("UPDATE project_stages SET state='DONE' WHERE project_id=? AND stage='TIMELINE'").run(harness.projectId);

    const project = harness.repository.getProject(harness.projectId)!;
    const preview = await loadPreviewPlan({ sqlite: harness.sqlite, dataDir: harness.config.DATA_DIR, timeline: () => tl }, project);

    expect(preview.basis).toBe("timeline");
    expect(preview.scenes).toHaveLength(1);
    expect(preview.notes.some((n) => n.includes("timeline đã thay đổi"))).toBe(true);
  });

  it("preserves locked shots when regenerating or loading plan", async () => {
    const harness = createPipelineHarness();
    harnesses.push(harness);
    harness.orchestrator.getPipeline(harness.projectId);
    const sceneId = randomUUID();
    const dir = join(harness.config.DATA_DIR, "projects", harness.projectId, "render");
    mkdirSync(dir, { recursive: true });

    // Saved plan has a locked shot
    const lockedShot: Shot = {
      id: "locked-shot", kind: "still", startSec: 0, endSec: 2, reason: "custom-edit",
      locked: true,
      source: { kind: "still", candidateId: "custom", path: "visuals/custom.jpg", motion: "static" },
    };
    const saved = ComposePlanSchema.parse({
      version: 1, engine: "compose", preset: "calm", aspect: "16:9",
      scenes: [{ sceneId, durationSec: 2, durationFrames: 60, fps: 30, warnings: [], shots: [lockedShot] }],
      stats: computeStats({ scenes: [{ sceneId, durationSec: 2, durationFrames: 60, fps: 30, warnings: [], shots: [lockedShot] }] }, [], []),
    });
    writeFileSync(join(dir, "compose-plan.json"), JSON.stringify(saved));

    // Timeline has new visual candidate
    const tl: Timeline = TimelineSchema.parse({
      formatVersion: 1, target: { width: 1920, height: 1080, fps: 30 }, totalDurationSec: 2,
      scenes: [{
        sceneId, order: 0, label: "1", startSec: 0, endSec: 2, durationSec: 2, durationFrames: 60,
        voice: null, fadeInSec: 0, fadeOutSec: 0,
        visuals: [{ kind: "IMAGE", candidateId: "new-c", path: "visuals/new.jpg", startSec: 0, endSec: 2, motion, licenseKind: null }],
      }],
      music: null, subtitles: null, warnings: [], licenseSummary: {},
    });
    harness.sqlite.prepare("UPDATE project_stages SET state='DONE' WHERE project_id=? AND stage='TIMELINE'").run(harness.projectId);

    const project = harness.repository.getProject(harness.projectId)!;
    const preview = await loadPreviewPlan({ sqlite: harness.sqlite, dataDir: harness.config.DATA_DIR, timeline: () => tl }, project);

    // Locked shot is preserved
    expect(preview.scenes[0]!.plan.shots[0]!.locked).toBe(true);
    expect(preview.scenes[0]!.plan.shots[0]!.source).toMatchObject({ kind: "still", path: "visuals/custom.jpg" });
  });

  it("detects stale plan when an image visual is cleared to a placeholder", async () => {
    const harness = createPipelineHarness();
    harnesses.push(harness);
    harness.orchestrator.getPipeline(harness.projectId);
    const sceneId = randomUUID();
    const dir = join(harness.config.DATA_DIR, "projects", harness.projectId, "render");
    mkdirSync(dir, { recursive: true });

    // Old plan had a still shot with visuals/old.jpg
    const oldPlan: ScenePlan = {
      sceneId, durationSec: 2, durationFrames: 60, fps: 30, warnings: [],
      shots: [{
        id: "old-shot", kind: "still", startSec: 0, endSec: 2, reason: "previous render",
        source: { kind: "still", candidateId: "old", path: "visuals/old.jpg", motion: "static" },
      }],
    };
    const saved = ComposePlanSchema.parse({
      version: 1, engine: "compose", preset: "calm", aspect: "16:9",
      scenes: [oldPlan], stats: computeStats({ scenes: [oldPlan] }, [], []),
    });
    writeFileSync(join(dir, "compose-plan.json"), JSON.stringify(saved));

    // Timeline has cleared image: visual kind is PLACEHOLDER with null path
    const tl: Timeline = TimelineSchema.parse({
      formatVersion: 1, target: { width: 1920, height: 1080, fps: 30 }, totalDurationSec: 2,
      scenes: [{
        sceneId, order: 0, label: "Cleared image scene", startSec: 0, endSec: 2, durationSec: 2, durationFrames: 60,
        voice: null, fadeInSec: 0, fadeOutSec: 0,
        visuals: [{
          kind: "PLACEHOLDER", candidateId: null, path: null, startSec: 0, endSec: 2,
          motion: { type: "kenburns", from: { zoom: 1, x: 0.5, y: 0.5 }, to: { zoom: 1, x: 0.5, y: 0.5 } },
          licenseKind: null,
        }],
      }],
      music: null, subtitles: null, warnings: [], licenseSummary: {},
    });
    harness.sqlite.prepare("UPDATE project_stages SET state='DONE' WHERE project_id=? AND stage='TIMELINE'").run(harness.projectId);

    const project = harness.repository.getProject(harness.projectId)!;
    const preview = await loadPreviewPlan({ sqlite: harness.sqlite, dataDir: harness.config.DATA_DIR, timeline: () => tl }, project);

    expect(preview.basis).toBe("timeline");
    const shot = preview.scenes[0]!.plan.shots[0]!;
    // Must NOT reuse visuals/old.jpg
    expect(shot.source.kind === "still" ? (shot.source as { path: string | null }).path : null).not.toBe("visuals/old.jpg");
    expect(preview.notes.some((n) => n.includes("timeline đã thay đổi"))).toBe(true);
  });
});

describe("the plan RENDER writes is the plan preview reuses (TASK-139 fix3, writer to reader)", () => {
  const sceneA = randomUUID();
  const ts = "2026-11-18T00:00:00.000Z";
  const timeline = (): Timeline => TimelineSchema.parse({
    formatVersion: 1, target: { width: 1920, height: 1080, fps: 30 }, totalDurationSec: 2,
    scenes: [{
      sceneId: sceneA, order: 0, label: "S0", startSec: 0, endSec: 2, durationSec: 2, durationFrames: 60,
      voice: null, fadeInSec: 0, fadeOutSec: 0,
      visuals: [{
        kind: "IMAGE", candidateId: "cand-a", path: "visuals/a.jpg", startSec: 0, endSec: 2,
        motion: { type: "kenburns", from: { zoom: 1, x: 0.5, y: 0.5 }, to: { zoom: 1, x: 0.5, y: 0.5 } }, licenseKind: null,
      }],
    }],
    music: null, subtitles: null, warnings: [], licenseSummary: {},
  });
  function seed(harness: Harness) {
    harness.sqlite.prepare(`INSERT INTO scenes (id, project_id, "order", kind, label, narration, visual_notes, visual_description, visual_queries, music_mood, energy, est_duration_sec, start_sec, transition_note, origin, input_hash, created_at, updated_at)
      VALUES (?, ?, 0, 'BODY', 'S0', 'Xin chào các bạn', '', '', ?, '', '', 2, 0, '', 'AGENT', 'h', ?, ?)`)
      .run(sceneA, harness.projectId, JSON.stringify({ primary: "city street", alternatives: [] }), ts, ts);
    harness.sqlite.prepare(`INSERT INTO voice_tracks (id, project_id, scene_id, provider, voice, rate, origin, audio_path, duration_sec, cues, words, timing_source, input_hash, narration_hash, created_at, updated_at)
      VALUES (?, ?, ?, 'test', 'v', '1', 'AGENT', 'audio/a.mp3', 2, '[]', ?, 'estimated', 'h', '', ?, ?)`)
      .run(randomUUID(), harness.projectId, sceneA, JSON.stringify([{ startSec: 0, endSec: 1, text: "Xin" }]), ts, ts);
  }
  /** Runs the real writer (what RENDER calls), with the rule director only: no LLM, no footage search. */
  async function renderPlan(harness: Harness) {
    harness.orchestrator.getPipeline(harness.projectId);
    harness.sqlite.prepare("UPDATE project_stages SET state='DONE' WHERE project_id=? AND stage='TIMELINE'").run(harness.projectId);
    seed(harness);
    const project = harness.repository.getProject(harness.projectId)!;
    const renderDir = join(harness.config.DATA_DIR, "projects", harness.projectId, "render");
    const tl = timeline();
    const result = await prepareComposePlan({ sqlite: harness.sqlite, config: harness.config, project, timeline: tl, resolvePath: (p) => p, renderDir });
    return { renderDir, tl, result };
  }
  /** Reloads the project after any mutation, as the preview route does. */
  async function load(harness: Harness, tl: Timeline) {
    const project = harness.repository.getProject(harness.projectId)!;
    return loadPreviewPlan({ sqlite: harness.sqlite, dataDir: harness.config.DATA_DIR, timeline: () => tl }, project);
  }

  it("preview reuses the plan prepareComposePlan wrote: sidecar exists, no rebuild note", async () => {
    const harness = createPipelineHarness();
    harnesses.push(harness);
    const { renderDir, tl, result } = await renderPlan(harness);
    expect(result.plan).not.toBeNull();
    expect(existsSync(join(renderDir, PLAN_INPUTS_FILE))).toBe(true);
    const preview = await load(harness, tl);
    expect(preview.notes.some((n) => n.includes("timeline đã thay đổi"))).toBe(false);
    expect(preview.scenes).toHaveLength(1);
  });

  it("preview after a saved shot edit returns the edited shot and no rebuild note (TASK-150 A)", async () => {
    const harness = createPipelineHarness();
    harnesses.push(harness);
    const { renderDir, tl, result } = await renderPlan(harness);
    expect(result.plan).not.toBeNull();
    const shotId = result.plan!.scenes[0]!.shots[0]!.id;
    const edit = editSavedComposeShot(renderDir, shotId, { locked: true } as never);
    expect("error" in edit).toBe(false);
    expect(existsSync(join(renderDir, PLAN_INPUTS_FILE))).toBe(true);
    const preview = await load(harness, tl);
    expect(preview.notes.some((n) => n.includes("timeline đã thay đổi"))).toBe(false);
    expect(preview.scenes[0]!.plan.shots.find((s) => s.id === shotId)?.locked).toBe(true);
  });

  const dbCases: { name: string; mutate: (harness: Harness) => void; rebuild: boolean }[] = [
    { name: "narration đổi", mutate: (h) => h.sqlite.prepare("UPDATE scenes SET narration=? WHERE id=?").run("Câu hoàn toàn khác", sceneA), rebuild: true },
    { name: "voice words đổi", mutate: (h) => h.sqlite.prepare("UPDATE voice_tracks SET words=? WHERE scene_id=?").run(JSON.stringify([{ startSec: 0, endSec: 1.5, text: "Khác" }]), sceneA), rebuild: true },
    { name: "ngôn ngữ trong settings đổi", mutate: (h) => h.sqlite.prepare("UPDATE projects SET settings=json_set(settings,'$.language','vi') WHERE id=?").run(h.projectId), rebuild: true },
    { name: "thiết lập chạy (knowledgeRev) đổi: không rebuild", mutate: (h) => h.sqlite.prepare("UPDATE projects SET settings=json_set(settings,'$.knowledgeRev','0123456789ab') WHERE id=?").run(h.projectId), rebuild: false },
  ];
  for (const c of dbCases) {
    it(`${c.rebuild ? "dựng lại" : "tái dùng"} khi ${c.name}`, async () => {
      const harness = createPipelineHarness();
      harnesses.push(harness);
      const { tl } = await renderPlan(harness);
      c.mutate(harness);
      const preview = await load(harness, tl);
      expect(preview.notes.some((n) => n.includes("timeline đã thay đổi"))).toBe(c.rebuild);
    });
  }
});

describe("saved compose plan is reused only when its inputs match (TASK-139 fix3)", () => {
  const kenburns = { type: "kenburns" as const, from: { zoom: 1, x: 0.5, y: 0.5 }, to: { zoom: 1, x: 0.5, y: 0.5 } };
  const zoomed = { type: "kenburns" as const, from: { zoom: 1, x: 0.5, y: 0.5 }, to: { zoom: 1.2, x: 0.5, y: 0.5 } };
  const MARKER = "marker-from-saved-plan";
  const sceneA = randomUUID();
  const sceneB = randomUUID();
  const sceneC = randomUUID();

  function sceneOf(sceneId: string, order: number, startSec: number, visuals: unknown[], durationSec = 2) {
    return {
      sceneId, order, label: `S${order}`, startSec, endSec: startSec + durationSec, durationSec, durationFrames: durationSec * 30,
      voice: null, fadeInSec: 0, fadeOutSec: 0, visuals,
    };
  }
  function image(path: string, candidateId: string, motion: unknown = kenburns) {
    return { kind: "IMAGE", candidateId, path, startSec: 0, endSec: 2, motion, licenseKind: null };
  }
  function graphic(text: string, sceneId: string | null = sceneA) {
    return {
      id: "g1", templateId: MOTION_TEMPLATE_IDS[0], sceneId, startSec: 0, durationSec: 1, layer: "overlay", source: "user", variables: { text },
    };
  }
  function timelineOf(scenes: unknown[], extra: Record<string, unknown> = {}): Timeline {
    return TimelineSchema.parse({
      formatVersion: 1, target: { width: 1920, height: 1080, fps: 30 }, totalDurationSec: scenes.length * 2,
      scenes, music: null, subtitles: null, warnings: [], licenseSummary: {}, ...extra,
    });
  }
  const baseScenes = () => [
    sceneOf(sceneA, 0, 0, [image("visuals/a.jpg", "cand-a")]),
    sceneOf(sceneB, 1, 2, [image("visuals/b.jpg", "cand-b")]),
  ];
  const baseTimeline = () => timelineOf(baseScenes());

  /** A plan whose shots a rebuild cannot produce: every shot carries MARKER as its reason. */
  function markedPlan(sceneIds: string[]) {
    const scenes = sceneIds.map((sceneId) => ({
      sceneId, durationSec: 2, durationFrames: 60, fps: 30, warnings: [],
      shots: [{
        id: `${sceneId}-marker`, kind: "still", startSec: 0, endSec: 2, reason: MARKER,
        source: { kind: "still", candidateId: "cand-marker", path: "visuals/marker.jpg", motion: "static" },
      }],
    }));
    return ComposePlanSchema.parse({
      version: 1, engine: "compose", preset: "calm", aspect: "16:9", scenes,
      stats: computeStats({ scenes }, scenes.map(() => []), scenes.map(() => null)),
    });
  }

  /** Saves the marked plan and a sidecar computed by the real function from `savedFrom`, as RENDER does. */
  function setup(harness: Harness, savedFrom: Timeline) {
    harness.orchestrator.getPipeline(harness.projectId);
    harness.sqlite.prepare("UPDATE project_stages SET state='DONE' WHERE project_id=? AND stage='TIMELINE'").run(harness.projectId);
    const project = harness.repository.getProject(harness.projectId)!;
    const dir = join(harness.config.DATA_DIR, "projects", harness.projectId, "render");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "compose-plan.json"), JSON.stringify(markedPlan(savedFrom.scenes.map((scene) => scene.sceneId))));
    writePlanInputs(dir, composeInputFingerprint(harness.sqlite, project, savedFrom));
    return { project, dir };
  }

  async function load(harness: Harness, project: Project, tl: Timeline) {
    return loadPreviewPlan({ sqlite: harness.sqlite, dataDir: harness.config.DATA_DIR, timeline: () => tl }, project);
  }

  it("reuses the saved plan when every input still matches", async () => {
    const harness = createPipelineHarness();
    harnesses.push(harness);
    const tl = baseTimeline();
    const { project } = setup(harness, tl);
    const preview = await load(harness, project, tl);
    expect(preview.scenes.map((scene) => scene.plan.shots[0]!.reason)).toEqual([MARKER, MARKER]);
    expect(preview.notes.some((n) => n.includes("timeline đã thay đổi"))).toBe(false);
  });

  const cases: { name: string; savedFrom?: () => Timeline; current?: () => Timeline; damage?: (dir: string) => void }[] = [
    {
      name: "ảnh được thay",
      current: () => timelineOf([sceneOf(sceneA, 0, 0, [image("visuals/new.jpg", "cand-new")]), sceneOf(sceneB, 1, 2, [image("visuals/b.jpg", "cand-b")])]),
    },
    {
      name: "ảnh bị xóa khỏi timeline",
      current: () => timelineOf([
        sceneOf(sceneA, 0, 0, [{ kind: "PLACEHOLDER", candidateId: null, path: null, startSec: 0, endSec: 2, motion: kenburns, licenseKind: null }]),
        sceneOf(sceneB, 1, 2, [image("visuals/b.jpg", "cand-b")]),
      ]),
    },
    {
      name: "chuyển động đổi",
      current: () => timelineOf([sceneOf(sceneA, 0, 0, [image("visuals/a.jpg", "cand-a", zoomed)]), sceneOf(sceneB, 1, 2, [image("visuals/b.jpg", "cand-b")])]),
    },
    {
      name: "FPS đổi",
      current: () => timelineOf(baseScenes(), { target: { width: 1920, height: 1080, fps: 24 } }),
    },
    {
      name: "thêm visual thứ hai trong cùng cảnh",
      current: () => timelineOf([sceneOf(sceneA, 0, 0, [image("visuals/a.jpg", "cand-a"), image("visuals/a2.jpg", "cand-a2")]), sceneOf(sceneB, 1, 2, [image("visuals/b.jpg", "cand-b")])]),
    },
    {
      name: "thêm graphic có chữ",
      current: () => timelineOf(baseScenes(), { graphics: [graphic("Mới")] }),
    },
    {
      name: "đổi chữ graphic",
      savedFrom: () => timelineOf(baseScenes(), { graphics: [graphic("Cũ")] }),
      current: () => timelineOf(baseScenes(), { graphics: [graphic("Mới")] }),
    },
    {
      name: "đổi thứ tự cảnh",
      current: () => timelineOf([sceneOf(sceneB, 0, 0, [image("visuals/b.jpg", "cand-b")]), sceneOf(sceneA, 1, 2, [image("visuals/a.jpg", "cand-a")])]),
    },
    {
      name: "thêm cảnh",
      current: () => timelineOf([...baseScenes(), sceneOf(sceneC, 2, 4, [image("visuals/c.jpg", "cand-c")])]),
    },
    {
      name: "xóa cảnh",
      current: () => timelineOf([sceneOf(sceneA, 0, 0, [image("visuals/a.jpg", "cand-a")])]),
    },
    {
      name: "compose-plan.json hỏng JSON",
      damage: (dir) => writeFileSync(join(dir, "compose-plan.json"), "{ bad-json"),
    },
    {
      name: "compose-plan.json sai schema",
      damage: (dir) => writeFileSync(join(dir, "compose-plan.json"), JSON.stringify({ version: 1 })),
    },
    {
      name: "thiếu sidecar fingerprint",
      damage: (dir) => unlinkSync(join(dir, PLAN_INPUTS_FILE)),
    },
    {
      name: "sidecar sai fingerprint",
      damage: (dir) => writePlanInputs(dir, "0".repeat(64)),
    },
  ];

  for (const c of cases) {
    it(`dựng lại theo timeline hiện tại khi ${c.name}`, async () => {
      const harness = createPipelineHarness();
      harnesses.push(harness);
      const saved = c.savedFrom ? c.savedFrom() : baseTimeline();
      const { project, dir } = setup(harness, saved);
      if (c.damage) c.damage(dir);
      const current = c.current ? c.current() : baseTimeline();
      const statesBefore = harness.sqlite.prepare("SELECT * FROM project_stages WHERE project_id = ?").all(harness.projectId);
      const planBefore = readFileSync(join(dir, "compose-plan.json"), "utf8");

      const preview = await load(harness, project, current);

      expect(preview.basis).toBe("timeline");
      expect(preview.notes.some((n) => n.includes("timeline đã thay đổi"))).toBe(true);
      expect(preview.scenes.map((scene) => scene.sceneId)).toEqual(current.scenes.map((scene) => scene.sceneId));
      for (const scene of preview.scenes) expect(scene.plan.shots.some((shot) => shot.reason === MARKER)).toBe(false);
      expect(harness.sqlite.prepare("SELECT * FROM project_stages WHERE project_id = ?").all(harness.projectId)).toEqual(statesBefore);
      expect(readFileSync(join(dir, "compose-plan.json"), "utf8")).toBe(planBefore);
    });
  }
});
