import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerTimelineRoutes } from "../src/api/timeline.js";
import { StageError } from "../src/pipeline/stageExecutor.js";
import { TimelineService } from "../src/services/timelineService.js";
import { TimelineExecutor } from "../src/stages/timeline/timelineExecutor.js";
import { projectDir } from "../src/storage/paths.js";
import { createPipelineHarness } from "./pipelineFixtures.js";

type Harness = ReturnType<typeof createPipelineHarness>;
const harnesses: Harness[] = [];

afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.close();
});

function makeHarness(settings: Record<string, unknown> = {}): Harness {
  const harness = createPipelineHarness();
  harnesses.push(harness);
  const current = JSON.parse((harness.sqlite.prepare("SELECT settings FROM projects WHERE id = ?").get(harness.projectId) as { settings: string }).settings);
  harness.sqlite.prepare("UPDATE projects SET settings = ? WHERE id = ?").run(JSON.stringify({ ...current, ...settings }), harness.projectId);
  mkdirSync(join(dir(harness), "visuals"), { recursive: true });
  mkdirSync(join(dir(harness), "music"), { recursive: true });
  return harness;
}

const dir = (harness: Harness) => projectDir(harness.config.DATA_DIR, harness.projectId);
const now = () => new Date().toISOString();

function addScene(harness: Harness, order: number, narration: string, extra: { noVisual?: boolean; est?: number } = {}): string {
  const id = randomUUID();
  harness.sqlite.prepare(
    `INSERT INTO scenes (id, project_id, "order", kind, section_id, label, narration, visual_notes, no_visual, visual_queries,
      music_mood, energy, est_duration_sec, duration_override_sec, start_sec, transition_note, origin, edited,
      input_hash, created_at, updated_at)
     VALUES (?, ?, ?, 'section', NULL, ?, ?, '', ?, ?, '', 'medium', ?, NULL, 0, '', 'AGENT', 0, 'test', ?, ?)`,
  ).run(id, harness.projectId, order, `Scene ${order + 1}`, narration, extra.noVisual ? 1 : 0,
    JSON.stringify({ primary: "", alternatives: [] }), extra.est ?? 4, now(), now());
  return id;
}

function addVoice(harness: Harness, sceneId: string, durationSec: number): void {
  const path = join(dir(harness), `voice-${sceneId}.mp3`);
  writeFileSync(path, "audio");
  harness.sqlite.prepare(
    `INSERT INTO voice_tracks (id, project_id, scene_id, provider, voice, rate, origin, audio_path, duration_sec,
      cues, input_hash, narration_hash, created_at, updated_at)
     VALUES (?, ?, ?, 'mock', 'v', '+0%', 'AGENT', ?, ?, '[]', 'h', 'n', ?, ?)`,
  ).run(randomUUID(), harness.projectId, sceneId, path, durationSec, now(), now());
}

function addVisual(harness: Harness, sceneId: string, status: string, licenseKind = "CC0"): string {
  const id = randomUUID();
  const file = `visuals/${id}.jpg`;
  writeFileSync(join(dir(harness), file), "img");
  harness.sqlite.prepare(
    `INSERT INTO visual_candidates (id, project_id, scene_id, origin, provider, provider_item_id, query, title, description,
      tags, preview_url, image_url, source_url, source_site, width, height, aspect_ratio, file_type, watermark,
      relevance_score, score_breakdown, license, rank, local_path, sha256, actual_width, actual_height, created_at, search_hash)
     VALUES (?, ?, ?, 'SEARCH', 'mock', ?, 'q', 't', 'd', '[]', 'p', 'i', 's', 'site', 1920, 1080, 1.78, 'jpg', 'NONE',
      1, '{}', ?, 0, ?, 'sha', 1920, 1080, ?, 'h')`,
  ).run(id, harness.projectId, sceneId, id, JSON.stringify({ kind: licenseKind }), file, now());
  harness.sqlite.prepare(
    `INSERT INTO visual_selections (id, project_id, scene_id, slot, candidate_id, status, selected_by, motion, reviewed_at, created_at, updated_at)
     VALUES (?, ?, ?, 0, ?, ?, 'AGENT', NULL, NULL, ?, ?)`,
  ).run(randomUUID(), harness.projectId, sceneId, id, status, now(), now());
  return id;
}

function addMusic(harness: Harness, status: "APPROVED" | "NONE", durationSec = 5): void {
  const id = randomUUID();
  writeFileSync(join(dir(harness), "music/a.mp3"), "mp3");
  harness.sqlite.prepare(
    `INSERT INTO music_candidates (id, project_id, provider, provider_item_id, title, duration_sec, license, local_path, created_at)
     VALUES (?, ?, 'mock', ?, 'Calm', ?, ?, 'music/a.mp3', ?)`,
  ).run(id, harness.projectId, id, durationSec, JSON.stringify({ kind: "CC_BY_NC" }), now());
  harness.sqlite.prepare(
    `INSERT INTO music_selections (project_id, candidate_id, status, selected_by, volume, updated_at)
     VALUES (?, ?, ?, 'USER', 0.2, ?)`,
  ).run(harness.projectId, status === "APPROVED" ? id : null, status, now());
}

function addSubtitles(harness: Harness, cues: Array<{ sceneId: string; startSec: number; endSec: number; text: string }>): void {
  harness.sqlite.prepare(
    `INSERT INTO subtitle_tracks (id, project_id, cues, srt_path, ass_path, input_hash, created_at, updated_at)
     VALUES (?, ?, ?, 'x.srt', 'x.ass', 'h', ?, ?)`,
  ).run(randomUUID(), harness.projectId, JSON.stringify(cues), now(), now());
}

function run(harness: Harness) {
  const service = new TimelineService(harness.sqlite, harness.config);
  const executor = new TimelineExecutor(service);
  const job = harness.repository.createJob({ projectId: harness.projectId, stage: "TIMELINE", maxAttempts: 1, previousState: "PENDING" });
  const context = {
    project: harness.repository.getProject(harness.projectId)!,
    job,
    signal: new AbortController().signal,
    reportProgress: vi.fn(),
    recordUsage: vi.fn(),
    logger: Fastify({ logger: { level: "silent" } }).log,
  };
  return { service, result: executor.run(context) };
}

describe("TimelineExecutor", () => {
  it("builds one clock from voice, visuals, music and retimed subtitles", async () => {
    const harness = makeHarness();
    const first = addScene(harness, 0, "Hello there.");
    const silent = addScene(harness, 1, "", { est: 3 });
    const third = addScene(harness, 2, "Goodbye now.");
    addVoice(harness, first, 2);
    addVoice(harness, third, 3);
    addVisual(harness, first, "APPROVED");
    addVisual(harness, silent, "APPROVED");
    addVisual(harness, third, "REVIEW_REQUIRED");
    addMusic(harness, "APPROVED", 5);
    addSubtitles(harness, [
      { sceneId: first, startSec: 0, endSec: 2, text: "Hello there." },
      { sceneId: third, startSec: 0.5, endSec: 3, text: "Goodbye now." },
    ]);

    const { service, result } = run(harness);
    const output = await result;
    const { timeline } = service.get(harness.projectId);

    expect(output.message).toContain("3 cảnh");
    expect(timeline!.scenes.map((scene) => scene.startSec)).toEqual([0, 2.4, 5.4]);
    expect(timeline!.totalDurationSec).toBe(8.8);
    expect(timeline!.scenes[2].visuals[0].kind).toBe("PLACEHOLDER");
    expect(timeline!.music).toMatchObject({ loop: true, path: "music/a.mp3", volume: 0.2 });
    expect(timeline!.warnings.map((warning) => warning.code)).toEqual(["VISUAL_NOT_APPROVED", "LICENSE_NON_COMMERCIAL"]);

    // The third cue starts after the silent scene: 5.4 scene start + 0.1 lead + 0.5 cue.
    const srt = readFileSync(timeline!.subtitles!.srtPath, "utf8");
    expect(srt).toContain("00:00:00,100 --> 00:00:02,100");
    expect(srt).toContain("00:00:06,000 --> 00:00:08,500");
    expect(timeline!.subtitles!.srtPath).toContain(join("timeline", "subtitles"));

    const duration = harness.sqlite.prepare("SELECT duration_sec FROM projects WHERE id = ?").get(harness.projectId) as { duration_sec: number };
    expect(duration.duration_sec).toBe(9);
    expect(service.canApproveFinal(harness.projectId)).toEqual({ allowed: true });

    const again = await run(harness).result;
    expect(again.message).toContain("Dùng lại timeline");
    expect(again.outputHash).toBe(output.outputHash);
  });

  it("skips music silently when the user chose no music, and subtitles when off", async () => {
    const harness = makeHarness({ subtitles: { enabled: false, maxCharsPerLine: 42 } });
    const scene = addScene(harness, 0, "Only scene.");
    addVoice(harness, scene, 2);
    addVisual(harness, scene, "CUSTOM");
    addMusic(harness, "NONE");

    const { service, result } = run(harness);
    await result;
    const { timeline } = service.get(harness.projectId);
    expect(timeline!.music).toBeNull();
    expect(timeline!.subtitles).toBeNull();
    expect(timeline!.warnings).toEqual([]);
  });

  it("fails clearly when voice or subtitles are missing", async () => {
    const noVoice = makeHarness();
    addScene(noVoice, 0, "Needs a voice.");
    await expect(run(noVoice).result).rejects.toMatchObject({ code: "VOICE_TRACK_MISSING" });

    const noSubs = makeHarness();
    const scene = addScene(noSubs, 0, "Needs subtitles.");
    addVoice(noSubs, scene, 2);
    await expect(run(noSubs).result).rejects.toBeInstanceOf(StageError);
    await expect(run(noSubs).result).rejects.toMatchObject({ code: "SUBTITLE_TRACK_MISSING" });

    const empty = makeHarness();
    await expect(run(empty).result).rejects.toMatchObject({ code: "TIMELINE_NO_SCENES" });
    expect(new TimelineService(empty.sqlite, empty.config).canApproveFinal(empty.projectId).allowed).toBe(false);
  });

  it("still builds when originality recheck throws", () => {
    const harness = makeHarness({ subtitles: { enabled: false, maxCharsPerLine: 42 }, music: { enabled: false, volume: 0.1 } });
    const scene = addScene(harness, 0, "Only scene.");
    addVoice(harness, scene, 2);
    harness.sqlite.exec("DROP TABLE source_manifests");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const built = new TimelineService(harness.sqlite, harness.config).build(harness.repository.getProject(harness.projectId)!);
      expect(built.reused).toBe(false);
      expect(built.timeline.scenes).toHaveLength(1);
      const logged = warn.mock.calls.map((call) => String(call[0])).join("\n");
      expect(logged).toContain(harness.projectId);
      expect(logged).toContain("source_manifests");
    } finally {
      warn.mockRestore();
    }
  });

  it("serves the timeline over the API", async () => {
    const harness = makeHarness({ subtitles: { enabled: false, maxCharsPerLine: 42 }, music: { enabled: false, volume: 0.1 } });
    const scene = addScene(harness, 0, "Api scene.");
    addVoice(harness, scene, 1);
    const { service, result } = run(harness);
    await result;

    const app = Fastify();
    registerTimelineRoutes(app, service, { getProject: async (id) => harness.repository.getProject(id) ?? undefined });
    const ok = await app.inject({ method: "GET", url: `/api/projects/${harness.projectId}/timeline` });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().timeline.scenes).toHaveLength(1);
    expect(ok.json().timeline.warnings.map((warning: { code: string }) => warning.code)).toEqual(["VISUAL_MISSING"]);
    const missing = await app.inject({ method: "GET", url: `/api/projects/${randomUUID()}/timeline` });
    expect(missing.statusCode).not.toBe(200);
    await app.close();
  });
});
