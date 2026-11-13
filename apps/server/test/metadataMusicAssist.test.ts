import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import Fastify from "fastify";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@vg/shared";
import { buildApp } from "../src/app.js";
import { testActor } from "./testActor.js";
import { PipelineEventBus } from "../src/jobs/eventBus.js";
import { JobRepository } from "../src/jobs/jobRepository.js";
import { parseConfig, type AppConfig } from "../src/lib/config.js";
import { LlmProviderRegistry } from "../src/providers/llm/registry.js";
import { MockMusicProvider } from "../src/providers/music/registry.js";
import { AudioStore } from "../src/services/audioStore.js";
import { MetadataService } from "../src/services/metadataService.js";
import { MusicService } from "../src/services/musicService.js";
import { RenderService } from "../src/services/renderService.js";
import { TimelineService } from "../src/services/timelineService.js";
import { MusicSearchExecutor } from "../src/stages/music/musicSearchExecutor.js";
import { projectDir } from "../src/storage/paths.js";

const root = mkdtempSync(join(tmpdir(), "vg-meta-"));
let dataDir: string;
let config: AppConfig;
let app: ReturnType<typeof buildApp>;
let sqlite: Database.Database;
let repository: JobRepository;

beforeEach(() => {
  dataDir = join(root, `run-${randomUUID()}`);
  config = parseConfig({
    DATA_DIR: dataDir,
    DATABASE_PATH: join(dataDir, "app.db"),
    WORKER_ENABLED: "false",
    LOG_LEVEL: "silent",
    TTS_PROVIDER: "mock",
    MUSIC_PROVIDERS: "mock",
    LLM_DEFAULT_PROVIDER: "mock",
    LLM_ENABLE_MOCK: "true",
    LLM_CACHE_ENABLED: "true",
  });
  app = buildApp({ testActor,  config });
  sqlite = new Database(config.DATABASE_PATH);
  repository = new JobRepository(sqlite, new PipelineEventBus());
});

afterEach(async () => {
  sqlite.close();
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

async function createProject(budgetMode: "ECO" | "BALANCED" = "BALANCED"): Promise<Project> {
  const response = await app.inject({
    method: "POST",
    url: "/api/projects",
    payload: {
      topic: "Ancient Rome",
      settings: {
        budget: { mode: budgetMode },
        music: { enabled: true, volume: 0.2 },
        guidelines: { platformPack: "youtube", channelPacks: ["storytelling"], customRules: ["Prefer calm instrumental music"], strictness: "REMIND" },
      },
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json<Project>();
}

function seedScript(projectId: string): void {
  const now = new Date().toISOString();
  const script = {
    title: "Ancient Rome: A Careful Look",
    hook: "What do we know about Rome?",
    sections: [
      { id: "a", heading: "Origins", narration: "Rome began as a small settlement near the Tiber.", visualQueries: { primary: "rome", alternatives: [] }, visualNotes: "", musicMood: "calm", energy: "low", estDurationSec: 40 },
      { id: "b", heading: "Republic", narration: "The republic balanced power across offices.", visualQueries: { primary: "senate", alternatives: [] }, visualNotes: "", musicMood: "reflective", energy: "medium", estDurationSec: 40 },
      { id: "c", heading: "Empire", narration: "The empire expanded across the Mediterranean.", visualQueries: { primary: "empire", alternatives: [] }, visualNotes: "", musicMood: "epic", energy: "high", estDurationSec: 40 },
    ],
    outro: "Check the sources.",
    music: { mood: "calm reflective", energy: "low", keywords: ["piano", "ambient"] },
  };
  sqlite.prepare(`INSERT INTO scripts (project_id, data, origin, edited, version, input_hash, provider, model, updated_at)
    VALUES (?, ?, 'AGENT', 0, 1, 'script-hash', 'mock', 'mock-v1', ?)`).run(projectId, JSON.stringify(script), now);
}

function seedScene(projectId: string, order: number, mood: string, duration = 40): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  sqlite.prepare(
    `INSERT INTO scenes (id, project_id, "order", kind, section_id, label, narration, visual_notes, visual_queries,
      music_mood, energy, est_duration_sec, duration_override_sec, start_sec, transition_note, origin, edited,
      input_hash, created_at, updated_at)
     VALUES (?, ?, ?, 'section', NULL, ?, 'Narration.', '', ?, ?, 'low', ?, NULL, 0, '', 'AGENT', 0, 'fixture', ?, ?)`,
  ).run(id, projectId, order, `Scene ${order + 1}`, JSON.stringify({ primary: "", alternatives: [], queryVariant: false }), mood, duration, now, now);
  return id;
}

function musicService() {
  return new MusicService(
    sqlite,
    config,
    [new MockMusicProvider()],
    new AudioStore(config.DATA_DIR, "test-agent", { fetchImpl: async () => new Response(Buffer.from("ID3"), { status: 200 }), resolveHost: async () => ["93.184.216.34"] }),
    async () => 120,
  );
}

function musicContext(project: Project) {
  return {
    project,
    job: repository.createJob({ projectId: project.id, stage: "MUSIC_SEARCH", maxAttempts: 1, previousState: "PENDING" }),
    signal: new AbortController().signal,
    reportProgress: () => undefined,
    recordUsage: vi.fn(),
    logger: Fastify({ logger: { level: "silent" } }).log,
  };
}

function seedTimelineReady(project: Project): void {
  seedScript(project.id);
  const dir = projectDir(config.DATA_DIR, project.id);
  mkdirSync(join(dir, "visuals"), { recursive: true });
  mkdirSync(join(dir, "music"), { recursive: true });
  const now = new Date().toISOString();
  const scenes = [
    seedScene(project.id, 0, "calm", 40),
    seedScene(project.id, 1, "reflective", 40),
    seedScene(project.id, 2, "warm", 40),
  ];
  for (const sceneId of scenes) {
    const voicePath = join(dir, `voice-${sceneId}.mp3`);
    writeFileSync(voicePath, "audio");
    sqlite.prepare(
      `INSERT INTO voice_tracks (id, project_id, scene_id, provider, voice, rate, origin, audio_path, duration_sec,
        cues, input_hash, narration_hash, created_at, updated_at)
       VALUES (?, ?, ?, 'mock', 'v', '+0%', 'AGENT', ?, 40, '[]', 'h', 'n', ?, ?)`,
    ).run(randomUUID(), project.id, sceneId, voicePath, now, now);

    const visualId = randomUUID();
    writeFileSync(join(dir, `visuals/${visualId}.jpg`), "img");
    sqlite.prepare(
      `INSERT INTO visual_candidates (id, project_id, scene_id, origin, provider, provider_item_id, query, title, description,
        tags, preview_url, image_url, source_url, source_site, width, height, aspect_ratio, file_type, watermark,
        relevance_score, score_breakdown, license, rank, local_path, sha256, actual_width, actual_height, created_at, search_hash)
       VALUES (?, ?, ?, 'SEARCH', 'mock', ?, 'q', 't', 'd', '[]', 'p', 'i', 's', 'site', 1920, 1080, 1.78, 'jpg', 'NONE',
        1, '{}', ?, 0, ?, 'sha', 1920, 1080, ?, 'h')`,
    ).run(visualId, project.id, sceneId, visualId, JSON.stringify({ kind: "CC0", name: "CC0", attributionRequired: false }), `visuals/${visualId}.jpg`, now);
    sqlite.prepare(
      `INSERT INTO visual_selections (id, project_id, scene_id, slot, candidate_id, status, selected_by, motion, reviewed_at, created_at, updated_at)
       VALUES (?, ?, ?, 0, ?, 'APPROVED', 'AGENT', NULL, NULL, ?, ?)`,
    ).run(randomUUID(), project.id, sceneId, visualId, now, now);
  }
  sqlite.prepare(
    `INSERT INTO music_selections (project_id, candidate_id, status, selected_by, volume, updated_at)
     VALUES (?, NULL, 'NONE', 'USER', 0.2, ?)`,
  ).run(project.id, now);
  const cues = scenes.map((sceneId, index) => ({
    sceneId,
    startSec: 0,
    endSec: 3,
    text: `Cue ${index + 1}`,
  }));
  sqlite.prepare(
    `INSERT INTO subtitle_tracks (id, project_id, cues, srt_path, ass_path, input_hash, created_at, updated_at)
     VALUES (?, ?, ?, 'x.srt', 'x.ass', 'h', ?, ?)`,
  ).run(randomUUID(), project.id, JSON.stringify(cues), now, now);
}

describe("music assist", () => {
  it("calls the LLM once, uses assist queries, caches on rerun, and stores assist", async () => {
    const project = await createProject("BALANCED");
    seedScript(project.id);
    seedScene(project.id, 0, "calm");
    const music = musicService();
    const spy = vi.spyOn(MockMusicProvider.prototype, "search");
    const executor = new MusicSearchExecutor(music, sqlite, new LlmProviderRegistry(config), config);
    const ctx = musicContext(project);
    const first = await executor.run(ctx);
    expect(first.message).toMatch(/AI gợi ý/);
    expect(ctx.recordUsage).toHaveBeenCalledWith(expect.objectContaining({
      features: expect.objectContaining({ musicAssist: 1 }),
    }));
    expect(spy.mock.calls.some((call) => String(call[0]?.query ?? "").includes("calm piano") || String(call[0]?.query ?? "").includes("documentary"))).toBe(true);
    const state = music.getProjectMusic(project);
    expect(state.assist).toMatchObject({
      mood: "calm reflective",
      energy: "low",
      queries: expect.arrayContaining([expect.any(String)]),
    });
    expect(state.selection?.assist?.why).toMatch(/Ancient Rome|reflective/i);

    const secondCtx = musicContext(project);
    await executor.run(secondCtx);
    expect(secondCtx.recordUsage).toHaveBeenCalledWith(expect.objectContaining({
      calls: [expect.objectContaining({ task: "musicAssist", cached: true })],
    }));
    const cacheRows = sqlite.prepare("SELECT COUNT(*) AS count FROM llm_cache").get() as { count: number };
    expect(cacheRows.count).toBeGreaterThan(0);
  });

  it("uses the code query when assist is off or the user set an override", async () => {
    const project = await createProject("ECO");
    seedScript(project.id);
    seedScene(project.id, 0, "calm");
    const music = musicService();
    const executor = new MusicSearchExecutor(music, sqlite, new LlmProviderRegistry(config), config);
    const ctx = musicContext(project);
    await executor.run(ctx);
    expect(ctx.recordUsage).toHaveBeenCalledWith(expect.objectContaining({ features: { musicAssist: 0 } }));
    expect(music.getProjectMusic(project).assist ?? null).toBeNull();

    const overridden = await createProject("BALANCED");
    seedScript(overridden.id);
    seedScene(overridden.id, 0, "calm");
    const music2 = musicService();
    music2.updateSettings(overridden, { query: "custom piano" });
    const ctx2 = musicContext(overridden);
    const result = await new MusicSearchExecutor(music2, sqlite, new LlmProviderRegistry(config), config).run(ctx2);
    expect(result.message).toContain("custom piano");
    expect(ctx2.recordUsage).toHaveBeenCalledWith(expect.objectContaining({ features: { musicAssist: 0 } }));
  });

  it("includes music guideline rules in the assist prompt", async () => {
    const { musicAssistPrompt } = await import("../src/stages/music/musicAssistPrompt.js");
    const { GuidelineService } = await import("../src/guidelines/service.js");
    const project = await createProject("BALANCED");
    const guidance = new GuidelineService(sqlite).guidanceFor(project, ["music"]);
    expect(guidance).toMatch(/Prefer calm instrumental music/);
    const prompt = musicAssistPrompt({
      project,
      scriptTitle: "Title",
      hook: "Hook",
      narrationSample: "Narration",
      sceneMoods: ["calm"],
      music: { mood: "calm", keywords: ["piano"] },
      guidance,
    });
    expect(prompt.prompt).toContain("Prefer calm instrumental music");
  });
});

describe("video metadata", () => {
  function services() {
    const timelines = new TimelineService(sqlite, config);
    const render = new RenderService(sqlite, config, timelines);
    const metadata = new MetadataService(sqlite, config, new LlmProviderRegistry(config), timelines, render);
    return { timelines, metadata };
  }

  it("generates LLM metadata after timeline and keeps edits unless overwriteEdits", async () => {
    const project = await createProject("BALANCED");
    seedTimelineReady(project);
    const { timelines, metadata } = services();
    timelines.build(project);

    const first = await metadata.generate(project, { recordUsage: vi.fn() });
    expect(first.source).toBe("LLM");
    expect(first.metadata.draft.titles.length).toBeGreaterThan(0);

    const edited = {
      ...first.metadata.draft,
      titles: ["My edited title", "Alt", "Alt 2"],
      description: "Edited description",
    };
    metadata.saveEdits(project, edited);
    const kept = await metadata.generate(project, { recordUsage: vi.fn() });
    expect(kept.metadata.edited?.titles[0]).toBe("My edited title");
    expect(kept.reused).toBe(true);

    const overwritten = await metadata.generate(project, { overwriteEdits: true, recordUsage: vi.fn() });
    expect(overwritten.metadata.edited).toBeNull();
    expect(overwritten.source).toBe("LLM");
  });

  it("uses a code draft when metadata is off", async () => {
    const project = await createProject("ECO");
    seedTimelineReady(project);
    const { timelines, metadata } = services();
    timelines.build(project);
    const usage = vi.fn();
    const result = await metadata.generate(project, { recordUsage: usage });
    expect(result.source).toBe("CODE");
    expect(result.metadata.draft.titles[0]).toContain("Ancient Rome");
    expect(usage).toHaveBeenCalledWith(expect.objectContaining({ features: { metadata: 0 } }));
  });

  it("marks metadata stale when the timeline hash changes", async () => {
    const project = await createProject("BALANCED");
    seedTimelineReady(project);
    const { timelines, metadata } = services();
    timelines.build(project);
    await metadata.generate(project);
    expect(metadata.get(project.id).stale).toBe(false);

    sqlite.prepare("UPDATE timelines SET input_hash = ? WHERE project_id = ?").run("changed-hash", project.id);
    expect(metadata.get(project.id).stale).toBe(true);
  });

  it("exposes get/put/generate routes and includes guideline rules in the prompt", async () => {
    const project = await createProject("BALANCED");
    seedTimelineReady(project);
    const timelines = new TimelineService(sqlite, config);
    timelines.build(project);

    const empty = await app.inject({ method: "GET", url: `/api/projects/${project.id}/metadata` });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toMatchObject({ metadata: null, stale: true });

    const { metadataPrompt } = await import("../src/stages/timeline/metadataPrompt.js");
    const { GuidelineService } = await import("../src/guidelines/service.js");
    const guidance = new GuidelineService(sqlite).guidanceFor(project, ["metadata"]);
    expect(guidance).toMatch(/Prefer calm instrumental music/);
    expect(metadataPrompt({
      project,
      scriptTitle: "Title",
      hook: "Hook",
      sectionHeadings: ["A", "B", "C"],
      narrationSummary: "Summary",
      guidance,
    }).prompt).toContain("Prefer calm instrumental music");

    const created = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/metadata/generate`,
      payload: {},
    });
    expect(created.statusCode).toBe(200);
    expect(created.json().metadata.source).toBe("LLM");

    const draft = created.json().metadata.draft;
    const saved = await app.inject({
      method: "PUT",
      url: `/api/projects/${project.id}/metadata`,
      payload: { ...draft, titles: ["Saved title", "Two", "Three"] },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().metadata.edited.titles[0]).toBe("Saved title");

    const got = await app.inject({ method: "GET", url: `/api/projects/${project.id}/metadata` });
    expect(got.json().metadata.edited.titles[0]).toBe("Saved title");
  });
});
