import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import Fastify from "fastify";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Project, SubtitleCue } from "@vg/shared";
import { PipelineEventBus } from "../src/jobs/eventBus.js";
import { JobRepository } from "../src/jobs/jobRepository.js";
import { buildApp } from "../src/app.js";
import { testActor } from "./testActor.js";
import { parseConfig, type AppConfig } from "../src/lib/config.js";
import { SubtitleExecutor } from "../src/stages/subtitle/subtitleExecutor.js";
import { projectDir } from "../src/storage/paths.js";

const root = mkdtempSync(join(tmpdir(), "vg-subtitle-api-"));
let dataDir: string;
let config: AppConfig;
let app: ReturnType<typeof buildApp>;
let project: Project;
let sceneId: string;
let sqlite: Database.Database;
let repository: JobRepository;

async function createProject() {
  const response = await app.inject({
    method: "POST",
    url: "/api/projects",
    payload: { topic: "Subtitle API fixture", settings: { budget: { mode: "ECO" }, subtitles: { enabled: true, maxCharsPerLine: 24 } } },
  });
  expect(response.statusCode).toBe(201);
  project = response.json<Project>();
}

function addSceneAndVoiceTrack() {
  sceneId = randomUUID();
  const now = new Date().toISOString();
  sqlite.prepare(
    `INSERT INTO scenes (id, project_id, "order", kind, section_id, label, narration, visual_notes, visual_queries,
      music_mood, energy, est_duration_sec, duration_override_sec, start_sec, transition_note, origin, edited,
      input_hash, created_at, updated_at)
     VALUES (?, ?, 0, 'section', NULL, 'API scene', 'Hello from the subtitle API.', '', ?, '', 'medium', 4, NULL, 0, '', 'AGENT', 0, 'fixture', ?, ?)`,
  ).run(sceneId, project.id, JSON.stringify({ primary: "", alternatives: [], queryVariant: false }), now, now);
  sqlite.prepare(
    `INSERT INTO voice_tracks (id, project_id, scene_id, provider, voice, rate, origin, audio_path, duration_sec,
      cues, input_hash, narration_hash, created_at, updated_at)
     VALUES (?, ?, ?, 'mock', 'test-voice', '+0%', 'AGENT', 'mock.wav', 4, ?, 'voice-hash', 'narration-hash', ?, ?)`,
  ).run(randomUUID(), project.id, sceneId, JSON.stringify([{ startSec: 0, endSec: 4, text: "Hello from the subtitle API." }]), now, now);
}

function addSubtitleTrack(cues: SubtitleCue[] = [{ index: 0, sceneId, startSec: 0, endSec: 4, text: "Original subtitle line." }]) {
  const targetDir = join(projectDir(config.DATA_DIR, project.id), "subtitles");
  mkdirSync(targetDir, { recursive: true });
  const srtPath = join(targetDir, "subtitles.srt");
  const assPath = join(targetDir, "subtitles.ass");
  writeFileSync(srtPath, "1\n00:00:00,000 --> 00:00:04,000\nOriginal subtitle line.\n", "utf8");
  writeFileSync(assPath, "[Events]\n", "utf8");
  const now = new Date().toISOString();
  sqlite.prepare(
    `INSERT INTO subtitle_tracks (id, project_id, cues, srt_path, ass_path, input_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'same-hash', ?, ?)`,
  ).run(randomUUID(), project.id, JSON.stringify(cues), srtPath, assPath, now, now);
  return { srtPath, assPath };
}

beforeEach(async () => {
  dataDir = join(root, `run-${randomUUID()}`);
  config = parseConfig({
    DATA_DIR: dataDir,
    DATABASE_PATH: join(dataDir, "app.db"),
    WORKER_ENABLED: "false",
    LOG_LEVEL: "silent",
    TTS_PROVIDER: "mock",
  });
  app = buildApp({ testActor,  config });
  await createProject();
  sqlite = new Database(config.DATABASE_PATH);
  repository = new JobRepository(sqlite, new PipelineEventBus());
  addSceneAndVoiceTrack();
});

afterEach(async () => {
  sqlite.close();
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("subtitle API", () => {
  it("gets cues, patches text, rewrites SRT, and marks timeline stale", async () => {
    const files = addSubtitleTrack();
    repository.getStages(project.id);
    sqlite.prepare("UPDATE project_stages SET state = 'DONE' WHERE project_id = ? AND stage = 'TIMELINE'").run(project.id);

    const fetched = await app.inject({ method: "GET", url: `/api/projects/${project.id}/subtitles` });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json().cues).toMatchObject([{ text: "Original subtitle line.", sceneId }]);

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/projects/${project.id}/subtitles/cues/0`,
      payload: { text: "Edited subtitle line that is longer than twenty-four chars." },
    });

    expect(patched.statusCode).toBe(200);
    expect(patched.json().cues[0]).toMatchObject({ text: "Edited subtitle line that is longer than twenty-four chars.", edited: true });
    expect(readFileSync(files.srtPath, "utf8")).toContain("Edited subtitle line");
    expect(sqlite.prepare("SELECT state FROM project_stages WHERE project_id = ? AND stage = 'TIMELINE'").get(project.id)).toEqual({ state: "STALE" });
  });

  it("returns 404 when patching an unknown cue index", async () => {
    addSubtitleTrack();

    const response = await app.inject({
      method: "PATCH",
      url: `/api/projects/${project.id}/subtitles/cues/1`,
      payload: { text: "Unknown cue" },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("SUBTITLE_CUE_NOT_FOUND");
  });

  it("downloads SRT with an attachment header", async () => {
    addSubtitleTrack();

    const response = await app.inject({ method: "GET", url: `/api/projects/${project.id}/subtitles/file.srt` });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-disposition"]).toContain("attachment");
    expect(response.headers["content-disposition"]).toContain("subtitles.srt");
  });

  it("downloads ASS with an attachment header", async () => {
    addSubtitleTrack();

    const response = await app.inject({ method: "GET", url: `/api/projects/${project.id}/subtitles/file.ass` });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-disposition"]).toContain("attachment");
    expect(response.headers["content-disposition"]).toContain("subtitles.ass");
  });

  it("returns SUBTITLE_FILE_NOT_FOUND when a subtitle file is missing", async () => {
    const files = addSubtitleTrack();
    rmSync(files.srtPath);

    const response = await app.inject({ method: "GET", url: `/api/projects/${project.id}/subtitles/file.srt` });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("SUBTITLE_FILE_NOT_FOUND");
  });

  it("keeps edits on an unchanged hash and resets them when narration changes", async () => {
    const executor = new SubtitleExecutor(sqlite, config);
    const job = repository.createJob({ projectId: project.id, stage: "SUBTITLE", maxAttempts: 1, previousState: "PENDING" });
    const context = {
      project,
      job,
      signal: new AbortController().signal,
      reportProgress: () => undefined,
      recordUsage: () => undefined,
      logger: Fastify({ logger: { level: "silent" } }).log,
    };
    await executor.run(context);
    const edit = await app.inject({
      method: "PATCH",
      url: `/api/projects/${project.id}/subtitles/cues/0`,
      payload: { text: "User edited subtitle." },
    });
    expect(edit.statusCode).toBe(200);
    const sameHashJob = repository.createJob({ projectId: project.id, stage: "SUBTITLE", maxAttempts: 1, previousState: "PENDING" });
    await executor.run({ ...context, job: sameHashJob });
    expect(JSON.parse((sqlite.prepare("SELECT cues FROM subtitle_tracks WHERE project_id = ?").get(project.id) as { cues: string }).cues)[0])
      .toMatchObject({ text: "User edited subtitle.", edited: true });

    sqlite.prepare("UPDATE scenes SET narration = ? WHERE id = ?").run("Narration has changed.", sceneId);
    sqlite.prepare("UPDATE voice_tracks SET cues = ? WHERE scene_id = ?").run(
      JSON.stringify([{ startSec: 0, endSec: 4, text: "Narration has changed." }]),
      sceneId,
    );
    const changedJob = repository.createJob({ projectId: project.id, stage: "SUBTITLE", maxAttempts: 1, previousState: "PENDING" });
    await executor.run({ ...context, job: changedJob, project: repository.getProject(project.id)! });
    const regenerated = JSON.parse((sqlite.prepare("SELECT cues FROM subtitle_tracks WHERE project_id = ?").get(project.id) as { cues: string }).cues) as SubtitleCue[];
    expect(regenerated.some((cue) => cue.edited)).toBe(false);
    expect(regenerated.map((cue) => cue.text).join(" ")).toContain("Narration has changed.");
  });

  it("marks subtitle stage stale after voice is regenerated", async () => {
    addSubtitleTrack();
    repository.getStages(project.id);
    sqlite.prepare("UPDATE project_stages SET state = 'DONE' WHERE project_id = ?").run(project.id);

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/scenes/${sceneId}/voice/regenerate`,
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect(sqlite.prepare("SELECT state FROM project_stages WHERE project_id = ? AND stage = 'SUBTITLE'").get(project.id)).toEqual({ state: "STALE" });
  });
});
