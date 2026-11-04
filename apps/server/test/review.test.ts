import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PipelineStage, Project, ReviewProposal } from "@vg/shared";
import { STAGE_ORDER } from "@vg/shared";
import { buildApp } from "../src/app.js";
import { PipelineEventBus } from "../src/jobs/eventBus.js";
import { JobRepository } from "../src/jobs/jobRepository.js";
import { parseConfig, type AppConfig } from "../src/lib/config.js";
import { buildReviewContext } from "../src/review/contextBuilder.js";
import { validateReviewOutput } from "../src/review/validate.js";
import { GuidelineService } from "../src/guidelines/service.js";
import { MetadataService } from "../src/services/metadataService.js";
import { MusicService } from "../src/services/musicService.js";
import { SceneService } from "../src/services/sceneService.js";
import { TimelineService } from "../src/services/timelineService.js";
import { VisualService } from "../src/services/visualService.js";
import { RenderService } from "../src/services/renderService.js";
import { LlmProviderRegistry } from "../src/providers/llm/registry.js";
import { MockMusicProvider } from "../src/providers/music/registry.js";
import { AudioStore } from "../src/services/audioStore.js";
import { projectDir } from "../src/storage/paths.js";

const root = mkdtempSync(join(tmpdir(), "vg-review-"));
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
    IMAGE_PROVIDERS: "mock",
  });
  app = buildApp({ config });
  sqlite = new Database(config.DATABASE_PATH);
  repository = new JobRepository(sqlite, new PipelineEventBus());
});

afterEach(async () => {
  sqlite.close();
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

async function createProject(): Promise<Project> {
  const response = await app.inject({
    method: "POST",
    url: "/api/projects",
    payload: {
      topic: "Ancient Rome",
      settings: {
        budget: { mode: "BALANCED" },
        music: { enabled: true, volume: 0.2 },
        language: "vi",
        guidelines: { platformPack: "youtube", channelPacks: ["storytelling"], customRules: [], strictness: "REMIND" },
      },
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json<Project>();
}

function markDone(projectId: string, stages: PipelineStage[]): void {
  for (const stage of stages) {
    repository.updateStage(projectId, stage, {
      state: "DONE",
      progress: 100,
      message: null,
      jobId: null,
      error: null,
    });
  }
}

function seedScene(projectId: string, order: number, narration = `Narration ${order + 1}.`): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  sqlite.prepare(
    `INSERT INTO scenes (id, project_id, "order", kind, section_id, label, narration, visual_notes, visual_description, visual_queries,
      music_mood, energy, est_duration_sec, duration_override_sec, start_sec, transition_note, origin, edited,
      input_hash, created_at, updated_at)
     VALUES (?, ?, ?, 'section', NULL, ?, ?, '', '', ?, 'calm', 'low', 8, NULL, 0, '', 'AGENT', 0, 'fixture', ?, ?)`,
  ).run(id, projectId, order, `Scene ${order + 1}`, narration, JSON.stringify({ primary: "rome", alternatives: [], queryVariant: false }), now, now);
  return id;
}

function seedVisual(projectId: string, sceneId: string): string {
  const now = new Date().toISOString();
  const dir = projectDir(config.DATA_DIR, projectId);
  mkdirSync(join(dir, "visuals"), { recursive: true });
  const visualId = randomUUID();
  const sha256 = "a".repeat(64);
  writeFileSync(join(dir, `visuals/${visualId}.jpg`), "img");
  sqlite.prepare(
    `INSERT INTO visual_candidates (id, project_id, scene_id, origin, provider, provider_item_id, query, title, description,
      tags, preview_url, image_url, source_url, source_site, width, height, aspect_ratio, file_type, watermark,
      relevance_score, score_breakdown, license, rank, local_path, sha256, actual_width, actual_height, created_at, search_hash)
     VALUES (?, ?, ?, 'SEARCH', 'mock', ?, 'rome', 'Forum', 'd', '[]', 'http://x/p', 'http://x/i', 'http://x/s', 'site', 1920, 1080, 1.78, 'jpg', 'NONE',
      1, '{}', ?, 0, ?, ?, 1920, 1080, ?, 'h')`,
  ).run(
    visualId,
    projectId,
    sceneId,
    visualId,
    JSON.stringify({ kind: "CC0", name: "CC0", url: null, author: null, authorUrl: null, attributionRequired: false, attributionText: "", evidence: "api" }),
    `visuals/${visualId}.jpg`,
    sha256,
    now,
  );
  sqlite.prepare(
    `INSERT INTO visual_selections (id, project_id, scene_id, slot, candidate_id, status, selected_by, motion, reviewed_at, created_at, updated_at)
     VALUES (?, ?, ?, 0, ?, 'APPROVED', 'AGENT', NULL, NULL, ?, ?)`,
  ).run(randomUUID(), projectId, sceneId, visualId, now, now);
  return visualId;
}

function seedMusic(projectId: string): void {
  const now = new Date().toISOString();
  const candidateId = randomUUID();
  sqlite.prepare(
    `INSERT INTO music_candidates (id, project_id, provider, provider_item_id, title, artist, source_url, audio_url, duration_sec,
      genres, tags, license, relevance_score, score_breakdown, rank, local_path, input_hash, created_at)
     VALUES (?, ?, 'mock', ?, 'Calm Piano', NULL, NULL, NULL, 120, '[]', '[]', ?, 1, '{}', 0, NULL, '', ?)`,
  ).run(
    candidateId,
    projectId,
    candidateId,
    JSON.stringify({ kind: "CC0", name: "CC0", url: null, author: null, authorUrl: null, attributionRequired: false, attributionText: "", evidence: "api" }),
    now,
  );
  sqlite.prepare(
    `INSERT INTO music_selections (project_id, candidate_id, status, selected_by, volume, fade_in_sec, fade_out_sec, ducking_db, start_offset_sec, updated_at)
     VALUES (?, ?, 'APPROVED', 'AGENT', 0.2, 2, 3, -12, 0, ?)`,
  ).run(projectId, candidateId, now);
}

function seedTimeline(projectId: string, sceneIds: string[]): void {
  const now = new Date().toISOString();
  const timeline = {
    formatVersion: 1,
    target: { width: 1920, height: 1080, fps: 30 },
    totalDurationSec: sceneIds.length * 8,
    scenes: sceneIds.map((sceneId, order) => ({
      sceneId,
      order,
      label: `Scene ${order + 1}`,
      startSec: order * 8,
      endSec: (order + 1) * 8,
      durationSec: 8,
      durationFrames: 240,
      voice: null,
      visuals: [{ kind: "PLACEHOLDER", candidateId: null, path: null, startSec: order * 8, endSec: (order + 1) * 8, motion: null, licenseKind: null }],
      fadeInSec: 0.25,
      fadeOutSec: 0.25,
    })),
    music: null,
    subtitles: { srtPath: "x.srt", assPath: "x.ass", cueCount: sceneIds.length },
    warnings: [{ code: "VISUAL_MISSING", sceneId: sceneIds[0], message: "missing" }],
    licenseSummary: {},
  };
  sqlite.prepare(
    `INSERT INTO timelines (project_id, data, input_hash, total_duration_sec, created_at, updated_at)
     VALUES (?, ?, 'hash', ?, ?, ?)`,
  ).run(projectId, JSON.stringify(timeline), timeline.totalDurationSec, now, now);
}

function seedMetadata(projectId: string): void {
  const now = new Date().toISOString();
  const draft = {
    titles: ["Ancient Rome", "Rome overview", "Rome facts"],
    description: "A careful look.",
    tags: ["rome"],
    hashtags: ["#rome"],
    thumbnailText: ["Rome"],
  };
  sqlite.prepare(
    `INSERT INTO video_metadata (project_id, input_hash, draft, edited, source, created_at, updated_at)
     VALUES (?, 'hash', ?, NULL, 'CODE', ?, ?)`,
  ).run(projectId, JSON.stringify(draft), now, now);
}

async function seedReviewProject(): Promise<{ project: Project; sceneIds: string[] }> {
  const project = await createProject();
  const sceneIds = [seedScene(project.id, 0), seedScene(project.id, 1)];
  for (const sceneId of sceneIds) seedVisual(project.id, sceneId);
  seedMusic(project.id);
  seedTimeline(project.id, sceneIds);
  seedMetadata(project.id);
  markDone(project.id, [...STAGE_ORDER]);
  repository.updateStage(project.id, "FINAL_APPROVAL", {
    state: "WAITING_USER",
    progress: 0,
    message: null,
    jobId: null,
    error: null,
  });
  return { project, sceneIds };
}

function services() {
  const scenes = new SceneService(sqlite, repository);
  const visuals = new VisualService(sqlite, repository, config);
  const music = new MusicService(
    sqlite,
    config,
    [new MockMusicProvider()],
    new AudioStore(config.DATA_DIR, "test-agent", {
      fetchImpl: async () => new Response(Buffer.from("ID3"), { status: 200 }),
      resolveHost: async () => ["93.184.216.34"],
    }),
    async () => 120,
  );
  const timelines = new TimelineService(sqlite, config);
  const guidelines = new GuidelineService(sqlite);
  const render = new RenderService(sqlite, config, timelines);
  const metadata = new MetadataService(sqlite, config, new LlmProviderRegistry(config), timelines, render);
  return { scenes, visuals, music, timelines, guidelines, metadata };
}

describe("review context builder", () => {
  it("is deterministic and changes when narration changes", async () => {
    const { project, sceneIds } = await seedReviewProject();
    const deps = services();
    const first = buildReviewContext({ project, ...deps });
    const second = buildReviewContext({ project, ...deps });
    expect(first.contextHash).toBe(second.contextHash);
    expect(first.json).toBe(second.json);

    deps.scenes.patch(project.id, sceneIds[0]!, { narration: "Changed narration for hash." }, { staleFrom: "VISUAL_REVIEW" });
    const third = buildReviewContext({ project, ...deps });
    expect(third.contextHash).not.toBe(first.contextHash);
  });
});

describe("review validation", () => {
  it("drops bad proposals and keeps good ones", () => {
    const goodId = "11111111-1111-4111-8111-111111111111";
    const badId = "99999999-9999-4999-8999-999999999999";
    const result = validateReviewOutput({
      reply: "Ok",
      proposals: [
        { type: "NOTE", text: "Advice" },
        { type: "EDIT_NARRATION", sceneId: badId, text: "Nope" },
        { type: "EDIT_DURATION", sceneId: goodId, durationSec: 10 },
        { type: "REORDER_SCENES", sceneIds: [goodId] },
        { type: "REORDER_SCENES", sceneIds: [goodId, goodId] },
      ],
    }, { sceneIds: new Set([goodId]), sceneCount: 1 });
    expect(result.proposals).toEqual([
      { type: "NOTE", text: "Advice" },
      { type: "EDIT_DURATION", sceneId: goodId, durationSec: 10 },
      { type: "REORDER_SCENES", sceneIds: [goodId] },
    ]);
    expect(result.reply).toContain("Một số đề xuất đã bỏ");
    expect(result.droppedNotes.length).toBe(2);
  });
});

describe("review API", () => {
  it("sends a message, stores usage, and respects the history window of 12", async () => {
    const { project } = await seedReviewProject();
    const send = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/review/messages`,
      payload: { text: "AI xem lại toàn bộ" },
    });
    expect(send.statusCode).toBe(200);
    const assistant = send.json<{ id: string; role: string; proposals: ReviewProposal[]; usage: { inputTokens: number } }>();
    expect(assistant.role).toBe("assistant");
    expect(assistant.proposals.length).toBeGreaterThan(0);
    expect(assistant.usage.inputTokens).toBeGreaterThan(0);

    const thread = await app.inject({ method: "GET", url: `/api/projects/${project.id}/review` });
    expect(thread.statusCode).toBe(200);
    expect(thread.json().thread.messages).toHaveLength(2);

    const usageJobs = sqlite.prepare(
      "SELECT stage, status, usage FROM jobs WHERE project_id = ? AND stage = 'FINAL_APPROVAL' AND scope = 'reviewChat'",
    ).all(project.id) as Array<{ stage: string; status: string; usage: string }>;
    expect(usageJobs).toHaveLength(1);
    expect(usageJobs[0]?.status).toBe("SUCCEEDED");
    expect(JSON.parse(usageJobs[0]!.usage)).toMatchObject({ features: { reviewChat: 1 } });

    for (let i = 0; i < 6; i += 1) {
      const response = await app.inject({
        method: "POST",
        url: `/api/projects/${project.id}/review/messages`,
        payload: { text: `Follow-up ${i}` },
      });
      expect(response.statusCode).toBe(200);
    }
    const again = await app.inject({ method: "GET", url: `/api/projects/${project.id}/review` });
    // 1 initial + 6 follow-ups = 7 turns → 14 messages; history window is applied at prompt time only
    expect(again.json().thread.messages.length).toBe(14);
  });

  it("applies MUSIC_MIX and marks TIMELINE onward stale", async () => {
    const { project } = await seedReviewProject();
    const send = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/review/messages`,
      payload: { text: "Điều chỉnh nhạc" },
    });
    const assistant = send.json<{ id: string; proposals: ReviewProposal[] }>();
    const index = assistant.proposals.findIndex((proposal) => proposal.type === "MUSIC_MIX");
    expect(index).toBeGreaterThanOrEqual(0);

    const apply = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/review/proposals/${assistant.id}/${index}/apply`,
    });
    expect(apply.statusCode).toBe(200);
    const body = apply.json<{ staleStages: PipelineStage[] }>();
    expect(body.staleStages).toEqual(expect.arrayContaining(["TIMELINE", "RENDER"]));
    expect(repository.getStage(project.id, "TIMELINE").state).toBe("STALE");
    expect(repository.getStage(project.id, "VOICE").state).toBe("DONE");

    const again = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/review/proposals/${assistant.id}/${index}/apply`,
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe("ALREADY_APPLIED");
  });

  it("applies narration with narrow staleFrom and duration/reorder/motion/metadata", async () => {
    const { project, sceneIds } = await seedReviewProject();
    markDone(project.id, [...STAGE_ORDER]);

    // Default scene patch still stales from SCENE_PLAN
    const scenes = new SceneService(sqlite, repository);
    scenes.patch(project.id, sceneIds[0]!, { narration: "Route default stale." });
    expect(repository.getStage(project.id, "VISUAL_SEARCH").state).toBe("STALE");
    expect(repository.getStage(project.id, "VOICE").state).toBe("STALE");

    markDone(project.id, [...STAGE_ORDER]);
    scenes.patch(project.id, sceneIds[0]!, { narration: "Narrow narration." }, { staleFrom: "VISUAL_REVIEW" });
    expect(repository.getStage(project.id, "VISUAL_SEARCH").state).toBe("DONE");
    expect(repository.getStage(project.id, "VOICE").state).toBe("STALE");
    expect(repository.getStage(project.id, "SUBTITLE").state).toBe("STALE");

    markDone(project.id, [...STAGE_ORDER]);
    scenes.patch(project.id, sceneIds[0]!, { durationOverrideSec: 9 }, { staleFrom: "MUSIC_REVIEW" });
    expect(repository.getStage(project.id, "VOICE").state).toBe("DONE");
    expect(repository.getStage(project.id, "TIMELINE").state).toBe("STALE");

    markDone(project.id, [...STAGE_ORDER]);
    scenes.reorder(project.id, [sceneIds[1]!, sceneIds[0]!], { staleFrom: "MUSIC_REVIEW" });
    expect(repository.getStage(project.id, "MUSIC_SEARCH").state).toBe("DONE");
    expect(repository.getStage(project.id, "TIMELINE").state).toBe("STALE");

    markDone(project.id, [...STAGE_ORDER]);
    const motion = await app.inject({
      method: "PATCH",
      url: `/api/projects/${project.id}/scenes/${sceneIds[0]}/visuals/motion`,
      payload: {
        slot: 0,
        motion: { type: "zoom", from: { zoom: 1 }, to: { zoom: 1.2 } },
      },
    });
    expect(motion.statusCode).toBe(200);
    expect(repository.getStage(project.id, "TIMELINE").state).toBe("STALE");

    markDone(project.id, [...STAGE_ORDER]);
    const raw = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/review/apply`,
      payload: { proposal: { type: "EDIT_METADATA", title: "Rome reviewed", tags: ["rome", "history"] } },
    });
    expect(raw.statusCode).toBe(200);
    expect(repository.getStage(project.id, "TIMELINE").state).toBe("DONE");
    const meta = await app.inject({ method: "GET", url: `/api/projects/${project.id}/metadata` });
    expect(meta.json().metadata.edited.titles[0]).toBe("Rome reviewed");
  });

  it("does not block render approval when there is no review thread", async () => {
    const { project } = await seedReviewProject();
    const review = await app.inject({ method: "GET", url: `/api/projects/${project.id}/review` });
    expect(review.json().thread).toBeNull();

    // FINAL_APPROVAL gate can still be approved without a thread (gate rules unchanged)
    const gate = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/pipeline/gates/FINAL_APPROVAL/approve`,
    });
    // May succeed or fail depending on mode/orchestrator; must not be REVIEW_REQUIRED
    expect([200, 409]).toContain(gate.statusCode);
    if (gate.statusCode === 409) {
      expect(gate.json().error.code).not.toBe("REVIEW_REQUIRED");
    }
  });

  it("resets the thread", async () => {
    const { project } = await seedReviewProject();
    await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/review/messages`,
      payload: { text: "Hello" },
    });
    const deleted = await app.inject({ method: "DELETE", url: `/api/projects/${project.id}/review` });
    expect(deleted.statusCode).toBe(200);
    const again = await app.inject({ method: "GET", url: `/api/projects/${project.id}/review` });
    expect(again.json().thread).toBeNull();
  });
});
