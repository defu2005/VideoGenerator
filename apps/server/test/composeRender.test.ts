import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComposePlanSchema, EditSettingsSchema, resolveEditEngine, TimelineSchema, type ComposePlan, type Timeline } from "@vg/shared";
import { AppError } from "../src/lib/errors.js";
import { registerRenderRoutes } from "../src/api/render.js";
import { ASSISTANT_TOOLS } from "../src/assistant/tools.js";
import { createLlmDirector } from "../src/compose/director/index.js";
import { cachedFootageSearch, directorModeFor, downloadChosenFootage, editComposeShot, FOOTAGE_SEARCH_TTL_MS, pickDirector } from "../src/services/composeBridge.js";
import { RenderService, type MediaTools } from "../src/services/renderService.js";
import { projectDir } from "../src/storage/paths.js";
import { createPipelineHarness } from "./pipelineFixtures.js";

const harnesses: Array<ReturnType<typeof createPipelineHarness>> = [];
afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.close();
});

const SCENE_A = "11111111-1111-4111-8111-111111111111";
const SCENE_B = "22222222-2222-4222-8222-222222222222";
const motion = { type: "kenburns" as const, from: { zoom: 1, x: 0.5, y: 0.5 }, to: { zoom: 1.12, x: 0.5, y: 0.5 } };

function setup() {
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
    music: null,
    subtitles: { srtPath: join(dir, "timeline", "subtitles.srt"), assPath: join(dir, "timeline", "subtitles.ass"), cueCount: 1 },
    warnings: [],
    licenseSummary: { CC0: 1 },
  });
  writeFileSync(join(dir, "visuals/a.png"), "png");
  writeFileSync(join(dir, "voice/a.wav"), "wav");
  writeFileSync(join(dir, "timeline/subtitles.ass"), "[Script Info]\nScriptType: v4.00+\n");
  writeFileSync(join(dir, "timeline/subtitles.srt"), "1\n00:00:00,100 --> 00:00:01,000\nXin chào\n");
  const timelines = { get: () => ({ timeline, inputHash: "timeline-hash-1", updatedAt: "now" }) };
  return { harness, dir, timeline, timelines };
}

function plan(): ComposePlan {
  const license = {
    provider: "pexels" as const,
    clipId: "clip-1",
    author: "Ada Footage",
    licenseName: "Pexels License",
    pageUrl: "https://www.pexels.com/video/1",
  };
  return ComposePlanSchema.parse({
    version: 1,
    engine: "compose",
    preset: "story",
    aspect: "16:9",
    scenes: [
      {
        sceneId: SCENE_A, durationSec: 1.5, durationFrames: 45, fps: 30, warnings: [],
        shots: [{
          id: "a", kind: "still", startSec: 0, endSec: 1.5, reason: "baseline",
          source: { kind: "still", candidateId: "c1", path: "visuals/a.png", motion: "static" },
        }],
      },
      {
        sceneId: SCENE_B, durationSec: 1.5, durationFrames: 45, fps: 30, warnings: [],
        shots: [{
          id: "b", kind: "footage", startSec: 0, endSec: 1.5, reason: "baseline",
          source: { kind: "footage", clipId: "clip-1", path: "footage/a.mp4", inSec: 0, license },
        }],
      },
    ],
    stats: {
      shotsPerMin: 40, meanShotSec: 1.5, stdevShotSec: 0, kindEntropyBits: 1, maxSameKindRun: 1,
      wordGapCutPct: 1, beatCutPct: null,
      kindShare: { still: 0.5, footage: 0.5, kinetic_text: 0, chart: 0 },
    },
  });
}

function tools(): MediaTools {
  return {
    ffmpeg: vi.fn(async (args, options) => {
      const out = args[args.length - 1] ?? "";
      if (out !== "-") {
        const path = options?.cwd && !out.includes(":") && !out.startsWith("/") && !out.startsWith("\\")
          ? join(options.cwd, out)
          : out;
        writeFileSync(path, "x");
      }
      const stderr = args.some((arg) => arg.includes("freezedetect")) ? "freeze_start: 0.4\n" : "";
      options?.onStdout?.("out_time_us=1500000\n");
      return { stdout: "", stderr };
    }),
    probe: vi.fn(async () => ({ durationSec: 3, width: 160, height: 90, hasVideo: true, hasAudio: true })),
  };
}

function withCompose(harness: ReturnType<typeof createPipelineHarness>) {
  const current = harness.repository.getProject(harness.projectId)!;
  harness.sqlite.prepare("UPDATE projects SET settings = ? WHERE id = ?").run(
    JSON.stringify({ ...current.settings, edit: { engine: "compose" } }),
    harness.projectId,
  );
  return harness.repository.getProject(harness.projectId)!;
}

describe("compose render", () => {
  it("treats a missing engine as compose and keeps the baseline director", () => {
    expect(EditSettingsSchema.parse({}).engine).toBeUndefined();
    expect(resolveEditEngine(undefined)).toBe("compose");
    expect(resolveEditEngine("legacy")).toBe("legacy");
    expect(EditSettingsSchema.parse({ engine: "compose", directorMode: "quality" })).toMatchObject({
      engine: "compose",
      directorMode: "quality",
    });
    expect(pickDirector("quality").id).toBe("baseline");
    expect(pickDirector("eco").id).toBe("baseline");
    const rule = { id: "rule", directScenes: async () => [] };
    let calls = 0;
    const llm = { id: "rule+llm", directScenes: async () => { calls += 1; return []; } };
    expect(pickDirector("eco", { ruleDirector: rule, llmDirector: llm }).id).toBe("rule");
    expect(pickDirector("quality", { ruleDirector: rule, llmDirector: llm }).id).toBe("rule+llm");
    expect(calls).toBe(0);
  });

  it("downloads only the footage clips the plan uses, once each", async () => {
    const composed = plan();
    const footageShot = composed.scenes[1]!.shots[0]!;
    if (footageShot.source.kind !== "footage") throw new Error("fixture");
    footageShot.source.path = null;
    composed.scenes[0]!.shots[0] = { ...footageShot, id: "a2", startSec: 0, endSec: 1.5 };
    const hit = { provider: "pexels", clipId: "clip-1" } as never;
    const unused = { provider: "pexels", clipId: "clip-2" } as never;
    const ensure = vi.fn(async () => ({ path: "footage/pexels-clip-1-90.mp4" }));
    const warnings = await downloadChosenFootage(composed, new Map([["pexels:clip-1", hit], ["pexels:clip-2", unused]]), ensure);
    expect(warnings).toEqual([]);
    expect(ensure).toHaveBeenCalledTimes(1);
    expect(ensure).toHaveBeenCalledWith(hit);
    for (const scene of composed.scenes) {
      expect(scene.shots[0]!.source).toMatchObject({ kind: "footage", path: "footage/pexels-clip-1-90.mp4" });
    }
    const missing = plan();
    if (missing.scenes[1]!.shots[0]!.source.kind === "footage") missing.scenes[1]!.shots[0]!.source.path = null;
    expect(await downloadChosenFootage(missing, new Map(), ensure)).toHaveLength(1);
  });

  it("caches footage search results for 24 hours and skips empty results", async () => {
    const { harness } = setup();
    const hit = { provider: "pixabay", clipId: "1", author: "A", licenseName: "Pixabay Content License" } as never;
    let clock = 1_000;
    const search = vi.fn(async () => [hit]);
    const dataDir = harness.config.DATA_DIR;
    expect(await cachedFootageSearch(dataDir, "landscape:city", search, () => clock)).toEqual([hit]);
    clock += FOOTAGE_SEARCH_TTL_MS - 1;
    expect(await cachedFootageSearch(dataDir, "landscape:city", search, () => clock)).toEqual([hit]);
    expect(search).toHaveBeenCalledTimes(1);
    clock += 2;
    await cachedFootageSearch(dataDir, "landscape:city", search, () => clock);
    expect(search).toHaveBeenCalledTimes(2);
    const empty = vi.fn(async () => []);
    await cachedFootageSearch(dataDir, "landscape:none", empty, () => clock);
    await cachedFootageSearch(dataDir, "landscape:none", empty, () => clock);
    expect(empty).toHaveBeenCalledTimes(2);
  });

  it("writes a compose plan, a different clip hash and footage credits", async () => {
    const { harness, dir, timeline, timelines } = setup();
    const project = withCompose(harness);
    const composed = plan();
    const service = new RenderService(harness.sqlite, harness.config, timelines, tools(), () => new Date(), undefined, undefined, {
      plan: async () => ({ plan: composed, warnings: [] }),
      renderScene: async (_plan, _sceneId, _target, _ctx, outPath) => {
        writeFileSync(outPath, "clip");
      },
    });
    const resolve = (path: string) => join(dir, path);
    const legacyHash = service.clipHash(timeline.scenes[0]!, timeline, resolve);
    const composeHash = service.clipHash(timeline.scenes[0]!, timeline, resolve, composed.scenes[0]);
    expect(composeHash).not.toBe(legacyHash);
    const { render } = await service.render(project, new AbortController().signal, () => undefined);
    expect(render.status).toBe("DONE");
    expect(render.report.compose?.stats.shotsPerMin).toBe(40);
    expect(render.report.compose?.licences[0]?.author).toBe("Ada Footage");
    expect(render.report.freezeSegments).toBe(1);
    expect(existsSync(join(dir, "render", "compose-plan.json"))).toBe(true);
    const credits = readFileSync(join(dir, "render", "versions", render.id, "credits.txt"), "utf8");
    expect(credits).toContain("Ada Footage");
    expect(credits).toContain("Pexels License");
  });

  it("keeps the render when one scene falls back to the still clip", async () => {
    const { harness, timelines } = setup();
    const project = withCompose(harness);
    const service = new RenderService(harness.sqlite, harness.config, timelines, tools(), () => new Date(), undefined, undefined, {
      plan: async () => ({ plan: plan(), warnings: [] }),
      renderScene: async (_plan, sceneId, _target, _ctx, outPath) => {
        if (sceneId === SCENE_B) throw new Error("hỏng cảnh");
        writeFileSync(outPath, "clip");
      },
    });
    const { render } = await service.render(project, new AbortController().signal, () => undefined);
    expect(render.status).toBe("DONE");
    expect(render.report.issues.some((issue) => issue.code === "COMPOSE_FALLBACK" && issue.message.includes("hỏng cảnh"))).toBe(true);
  });

  it("serves the compose plan and the read-only tool", async () => {
    const { harness, dir, timelines } = setup();
    const project = withCompose(harness);
    const service = new RenderService(harness.sqlite, harness.config, timelines, tools());
    const app = Fastify();
    app.setErrorHandler((error, _request, reply) => {
      if (error instanceof AppError) return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
      return reply.code(500).send({ error: { message: "lỗi" } });
    });
    registerRenderRoutes(app, service, { getProject: async (id) => harness.repository.getProject(id) });
    const missing = await app.inject({ method: "GET", url: `/api/projects/${harness.projectId}/compose-plan` });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.message).toBe("Chưa có kế hoạch cảnh quay.");
    mkdirSync(join(dir, "render"), { recursive: true });
    writeFileSync(join(dir, "render", "compose-plan.json"), JSON.stringify({
      ...plan(),
      scenes: Array.from({ length: 14 }, (_, index) => ({ ...plan().scenes[0], sceneId: `scene-${index}` })),
    }));
    const found = await app.inject({ method: "GET", url: `/api/projects/${harness.projectId}/compose-plan` });
    expect(found.statusCode).toBe(200);
    expect(found.json().scenes).toHaveLength(12);
    expect(found.json().stats.shotsPerMin).toBe(40);
    const preview = await ASSISTANT_TOOLS.compose_plan_preview?.execute(
      { projectId: project.id },
      { projects: harness.repository, config: harness.config } as never,
    );
    expect((preview as { scenes: unknown[] }).scenes).toHaveLength(12);
    await app.close();
  });

  it("uses the rule director for ECO and calls the quality director once", async () => {
    let calls = 0;
    const rule = { id: "rule", directScenes: async () => [] };
    const quality = pickDirector("quality", {
      ruleDirector: rule,
      llmDirector: createLlmDirector(async () => { calls += 1; return "[]"; }),
    });
    await quality.directScenes([{
      scene: { sceneId: "s", index: 0, count: 1, text: "Xin chào bạn.", durationSec: 2 },
      words: [
        { i: 0, text: "Xin", startSec: 0, endSec: 0.4, sentenceEnd: false, punct: false },
        { i: 1, text: "chào", startSec: 0.4, endSec: 0.8, sentenceEnd: false, punct: false },
        { i: 2, text: "bạn.", startSec: 0.8, endSec: 1.2, sentenceEnd: true, punct: true },
      ],
      recipeId: "explainer",
      aspect: "16:9",
      stills: [{ candidateId: "a", path: "a.png" }],
      footage: [],
    }]);
    expect(quality.id).toBe("rule+llm");
    expect(calls).toBe(1);
    const eco = pickDirector(directorModeFor({ settings: { budget: { mode: "ECO" }, edit: { directorMode: "quality" } } } as never), {
      ruleDirector: rule,
      llmDirector: createLlmDirector(async () => { calls += 1; return "[]"; }),
    });
    expect(eco.id).toBe("rule");
    expect(calls).toBe(1);
  });

  it("swaps, rerolls and locks a shot, and rejects a kind the span cannot hold", async () => {
    const { harness, dir, timelines } = setup();
    const project = withCompose(harness);
    const license = { provider: "pixabay" as const, clipId: "1", author: "An", licenseName: "Pixabay License", pageUrl: "https://pixabay.com/videos/1" };
    const body = ComposePlanSchema.parse({
      ...plan(),
      scenes: [{
        sceneId: SCENE_A, durationSec: 3, durationFrames: 90, fps: 30, warnings: [],
        shots: [
          { id: "still-1", kind: "still", startSec: 0, endSec: 1.5, reason: "R5-still", source: { kind: "still", candidateId: "c1", path: "visuals/a.png", motion: "static" } },
          { id: "clip-1", kind: "footage", startSec: 1.5, endSec: 3, reason: "R4-footage", source: { kind: "footage", clipId: "1", path: "a.mp4", inSec: 0.5, license } },
        ],
      }],
      footageNotes: [
        { sceneId: SCENE_A, clipId: "pixabay:1", relevance: 1, fit: 0.9, kept: true, author: "An", licenseName: "Pixabay License", pageUrl: "https://pixabay.com/videos/1" },
        { sceneId: SCENE_A, clipId: "pixabay:2", relevance: 0.8, fit: 0.7, kept: false, author: "Bình", licenseName: "Pixabay License", pageUrl: "https://pixabay.com/videos/2" },
      ],
    });
    mkdirSync(join(dir, "render"), { recursive: true });
    writeFileSync(join(dir, "render", "compose-plan.json"), JSON.stringify(body));
    const service = new RenderService(harness.sqlite, harness.config, timelines, tools());
    const app = Fastify();
    app.setErrorHandler((error, _request, reply) => {
      if (error instanceof AppError) return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
      return reply.code(500).send({ error: { message: "lỗi" } });
    });
    registerRenderRoutes(app, service, { getProject: async (id) => harness.repository.getProject(id) }, harness.sqlite);
    const swapped = editComposeShot(body, "clip-1", { kind: "still" });
    expect("plan" in swapped && swapped.plan.scenes[0]!.shots[1]).toMatchObject({ kind: "still", source: { path: "visuals/a.png" } });
    const rolled = editComposeShot(body, "clip-1", { reroll: true });
    expect("plan" in rolled && rolled.plan.scenes[0]!.shots[1]).toMatchObject({ source: { clipId: "2" } });
    const locked = await app.inject({ method: "PATCH", url: `/api/projects/${project.id}/compose-plan/shots/clip-1`, payload: { locked: true } });
    expect(locked.statusCode).toBe(200);
    const saved = JSON.parse(readFileSync(join(dir, "render", "compose-plan.json"), "utf8")) as ComposePlan;
    expect(saved.scenes[0]!.shots[1]!.locked).toBe(true);
    const touch = harness.sqlite.prepare("SELECT object_key FROM operator_user_touches WHERE object_key = ?").get(`project:${project.id}`) as { object_key: string } | undefined;
    expect(touch?.object_key).toBe(`project:${project.id}`);
    const invalid = await app.inject({ method: "PATCH", url: `/api/projects/${project.id}/compose-plan/shots/clip-1`, payload: { kind: "map" } });
    expect(invalid.statusCode).toBe(400);
    await app.close();
  });
});
