import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import Fastify from "fastify";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project, ProjectMusic } from "@vg/shared";
import { PipelineEventBus } from "../src/jobs/eventBus.js";
import { JobRepository } from "../src/jobs/jobRepository.js";
import { buildApp } from "../src/app.js";
import { parseConfig, type AppConfig } from "../src/lib/config.js";
import { OpenverseMusicProvider, openverseQueryFallbacks } from "../src/providers/music/openverse.js";
import { LocalMusicProvider } from "../src/providers/music/local.js";
import { MockMusicProvider } from "../src/providers/music/registry.js";
import type { MusicSearchProvider } from "../src/providers/music/types.js";
import { AudioStore, sniffAudio } from "../src/services/audioStore.js";
import { MusicService } from "../src/services/musicService.js";
import { MusicSearchExecutor } from "../src/stages/music/musicSearchExecutor.js";
import { LlmProviderRegistry } from "../src/providers/llm/registry.js";
import { parseRangeHeader } from "../src/api/music.js";

const root = mkdtempSync(join(tmpdir(), "vg-music-"));
const MP3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(509, 1)]);
let dataDir: string;
let config: AppConfig;
let app: ReturnType<typeof buildApp>;
let sqlite: Database.Database;
let repository: JobRepository;

async function createProject(mode: "ASSISTED" | "AUTO" = "ASSISTED", musicEnabled = true): Promise<Project> {
  const response = await app.inject({
    method: "POST",
    url: "/api/projects",
    payload: { topic: "Music fixture", mode, settings: { budget: { mode: "ECO" }, music: { enabled: musicEnabled, volume: 0.2 } } },
  });
  expect(response.statusCode).toBe(201);
  const project = response.json<Project>();
  const now = new Date().toISOString();
  sqlite.prepare(
    `INSERT INTO scenes (id, project_id, "order", kind, section_id, label, narration, visual_notes, visual_queries,
      music_mood, energy, est_duration_sec, duration_override_sec, start_sec, transition_note, origin, edited,
      input_hash, created_at, updated_at)
     VALUES (?, ?, 0, 'section', NULL, 'Scene', 'Hello.', '', ?, 'calm piano', 'low', 60, NULL, 0, '', 'AGENT', 0, 'fixture', ?, ?)`,
  ).run(randomUUID(), project.id, JSON.stringify({ primary: "", alternatives: [], queryVariant: false }), now, now);
  return project;
}

function fakeFetch() {
  return vi.fn(async () => new Response(MP3, { status: 200, headers: { "content-type": "audio/mpeg" } }));
}

function service(providers: MusicSearchProvider[], fetchImpl = fakeFetch()) {
  return new MusicService(
    sqlite,
    config,
    providers,
    new AudioStore(config.DATA_DIR, "test-agent", { fetchImpl: fetchImpl as unknown as typeof fetch, resolveHost: async () => ["93.184.216.34"] }),
    async () => 120,
  );
}

function executor(music: MusicService) {
  return new MusicSearchExecutor(music, sqlite, new LlmProviderRegistry(config), config);
}

function context(project: Project) {
  return {
    project,
    job: repository.createJob({ projectId: project.id, stage: "MUSIC_SEARCH", maxAttempts: 1, previousState: "PENDING" }),
    signal: new AbortController().signal,
    reportProgress: () => undefined,
    recordUsage: () => undefined,
    logger: Fastify({ logger: { level: "silent" } }).log,
  };
}

beforeEach(() => {
  dataDir = join(root, `run-${randomUUID()}`);
  config = parseConfig({
    DATA_DIR: dataDir,
    DATABASE_PATH: join(dataDir, "app.db"),
    WORKER_ENABLED: "false",
    LOG_LEVEL: "silent",
    TTS_PROVIDER: "mock",
    MUSIC_PROVIDERS: "mock",
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

describe("music providers", () => {
  it("parses Openverse audio results (duration ms → s, license, mature filter)", async () => {
    const fetchImpl = vi.fn(async (url: URL | string) => {
      expect(String(url)).toContain("category=music");
      return new Response(JSON.stringify({
        results: [
          {
            id: "a1", title: "Quiet Piano", url: "https://cdn.example.org/a1.mp3", filetype: "mp32", duration: 185000,
            genres: ["ambient"], tags: [{ name: "piano" }, { name: "calm" }], license: "by", license_version: "3.0",
            license_url: "https://creativecommons.org/licenses/by/3.0/", creator: "Ann", foreign_landing_url: "https://www.jamendo.com/track/1",
          },
          { id: "a2", title: "Adult", url: "https://cdn.example.org/a2.mp3", mature: true, license: "cc0" },
          { id: "a3", title: "No file", license: "cc0" },
        ],
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const provider = new OpenverseMusicProvider({ userAgent: "test", timeoutMs: 1000, fetchImpl: fetchImpl as unknown as typeof fetch });
    const results = await provider.search({ query: "calm piano", limit: 10 });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ providerItemId: "a1", durationSec: 185, artist: "Ann", tags: ["piano", "calm"], licenseKind: "CC_BY" });
  });

  it("retries Openverse with shorter queries when every word cannot match", async () => {
    expect(openverseQueryFallbacks("dramatic investigative cinematic")).toEqual(["dramatic investigative cinematic", "dramatic cinematic", "dramatic"]);
    expect(openverseQueryFallbacks("calm")).toEqual(["calm"]);
    const seen: string[] = [];
    const fetchImpl = vi.fn(async (url: URL | string) => {
      const q = new URL(String(url)).searchParams.get("q") ?? "";
      seen.push(q);
      const results = q === "dramatic cinematic" ? [{ id: "b1", title: "Drama", url: "https://cdn.example.org/b1.mp3", filetype: "mp3", duration: 60000, license: "cc0" }] : [];
      return new Response(JSON.stringify({ results }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const provider = new OpenverseMusicProvider({ userAgent: "test", timeoutMs: 1000, fetchImpl: fetchImpl as unknown as typeof fetch });
    const results = await provider.search({ query: "dramatic investigative cinematic", limit: 10 });
    expect(seen).toEqual(["dramatic investigative cinematic", "dramatic cinematic"]);
    expect(results.map((result) => result.providerItemId)).toEqual(["b1"]);
  });

  it("lists the local library with library.json metadata and probed durations", async () => {
    const library = join(dataDir, "library");
    mkdirSync(library, { recursive: true });
    writeFileSync(join(library, "sunny_ukulele.mp3"), MP3);
    writeFileSync(join(library, "notes.txt"), "not audio");
    writeFileSync(join(library, "library.json"), JSON.stringify([{ file: "sunny_ukulele.mp3", title: "Sunny", license: "cc0", mood: "happy" }]));
    const probe = vi.fn(async () => 95.44);
    const results = await new LocalMusicProvider(library, probe).search({ query: "happy", limit: 5 });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ title: "Sunny", durationSec: 95.4, licenseKind: "CC0", audioUrl: null });
    expect(results[0].tags).toEqual(expect.arrayContaining(["happy", "sunny", "ukulele"]));
    await new LocalMusicProvider(join(dataDir, "missing"), probe).search({ query: "x", limit: 5 }).then((r) => expect(r).toEqual([]));
  });

  it("sniffs audio containers and rejects HTML", () => {
    expect(sniffAudio(MP3)?.ext).toBe("mp3");
    expect(sniffAudio(Buffer.from("OggS\0\0\0\0\0\0\0\0"))?.ext).toBe("ogg");
    expect(sniffAudio(Buffer.from("<!doctype html><html>"))).toBeUndefined();
  });

  it("parses byte ranges", () => {
    expect(parseRangeHeader("bytes=0-9", 100)).toEqual({ start: 0, end: 9 });
    expect(parseRangeHeader("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRangeHeader("bytes=50-", 100)).toEqual({ start: 50, end: 99 });
    expect(parseRangeHeader("bytes=200-", 100)).toBeNull();
  });
});

describe("MUSIC_SEARCH executor", () => {
  it("ranks, preselects for review, and reuses the search when nothing changed", async () => {
    const project = await createProject();
    const mock = new MockMusicProvider();
    const spy = vi.spyOn(mock, "search");
    const music = service([mock]);
    const musicExecutor = executor(music);
    const first = await musicExecutor.run(context(project));
    const state = music.getProjectMusic(project);
    expect(state.candidates.length).toBeGreaterThan(0);
    expect(state.candidates[0].title).toBe("Calm piano");
    expect(state.selection).toMatchObject({ status: "REVIEW_REQUIRED", selectedBy: "AGENT", candidateId: state.candidates[0].id, volume: 0.2, duckingDb: -12 });
    expect(music.canApproveMusicReview(project).allowed).toBe(false);

    const second = await musicExecutor.run(context(project));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(second.message).toContain("dùng lại");
    expect(second.outputHash).toBe(first.outputHash);
  });

  it("tolerates one provider failing, and fails retryably when all fail", async () => {
    const project = await createProject();
    const broken: MusicSearchProvider = { id: "openverse", search: async () => { throw new Error("boom"); } };
    const result = await executor(service([broken, new MockMusicProvider()])).run(context(project));
    expect(result.message).toContain("lỗi: openverse");
    const other = await createProject();
    await expect(executor(service([broken])).run(context(other))).rejects.toMatchObject({ code: "MUSIC_SEARCH_FAILED", retryable: true });
  });

  it("keeps the user's pick on a new search", async () => {
    const project = await createProject();
    const music = service([new MockMusicProvider()]);
    await music.search(project);
    const pick = music.getProjectMusic(project).candidates.find((candidate) => candidate.title === "Epic drums")!;
    await music.select(project, pick.id, "USER");
    music.updateSettings(project, { query: "epic drums" });
    await executor(music).run(context(project));
    const state = music.getProjectMusic(project);
    expect(state.selection).toMatchObject({ status: "APPROVED", selectedBy: "USER", candidateId: pick.id });
    expect(state.selectedCandidate?.localPath).toMatch(/^music\/[a-f0-9]{64}\.mp3$/);
    expect(music.canApproveMusicReview(project).allowed).toBe(true);
  });

  it("downloads and approves the top track in AUTO mode", async () => {
    const project = await createProject("AUTO");
    const fetchImpl = fakeFetch();
    const music = service([new MockMusicProvider()], fetchImpl);
    const result = await executor(music).run(context(project));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.message).toContain("tự chọn");
    expect(music.getProjectMusic(project).selection).toMatchObject({ status: "APPROVED", selectedBy: "AGENT" });
    expect(music.canApproveMusicReview(project).allowed).toBe(true);
  });

  it("selects no music when music is disabled", async () => {
    const project = await createProject("ASSISTED", false);
    const provider = new MockMusicProvider();
    const spy = vi.spyOn(provider, "search");
    await executor(service([provider])).run(context(project));
    expect(spy).not.toHaveBeenCalled();
    expect(service([provider]).getProjectMusic(project).selection?.status).toBe("NONE");
  });
});

describe("music API", () => {
  it("searches, uploads, streams ranges, sets none and settings, and marks the timeline stale", async () => {
    const project = await createProject();
    const searched = await app.inject({ method: "POST", url: `/api/projects/${project.id}/music/search`, payload: { query: "calm piano" } });
    expect(searched.statusCode).toBe(200);
    expect(searched.json<ProjectMusic>()).toMatchObject({ query: "calm piano" });
    expect(searched.json<ProjectMusic>().candidates).toHaveLength(3);

    repository.updateStage(project.id, "TIMELINE", { state: "DONE", progress: 100, message: null, jobId: null, error: null });
    const uploaded = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/music/upload`,
      headers: { "content-type": "audio/mpeg", "x-file-name": encodeURIComponent("Nhạc của tôi.mp3") },
      payload: MP3,
    });
    expect(uploaded.statusCode).toBe(200);
    const afterUpload = uploaded.json<ProjectMusic>();
    expect(afterUpload.selection).toMatchObject({ status: "APPROVED", selectedBy: "USER" });
    expect(afterUpload.selectedCandidate).toMatchObject({ provider: "upload", title: "Nhạc của tôi" });
    expect(repository.getStage(project.id, "TIMELINE").state).toBe("STALE");

    const audioUrl = `/api/projects/${project.id}/music/${afterUpload.selectedCandidate!.id}/audio`;
    const ranged = await app.inject({ method: "GET", url: audioUrl, headers: { range: "bytes=0-2" } });
    expect(ranged.statusCode).toBe(206);
    expect(ranged.headers["content-range"]).toBe(`bytes 0-2/${MP3.length}`);
    expect(ranged.rawPayload.toString("ascii")).toBe("ID3");
    const remote = afterUpload.candidates.find((candidate) => candidate.provider === "mock")!;
    expect((await app.inject({ method: "GET", url: `/api/projects/${project.id}/music/${remote.id}/audio` })).statusCode).toBe(404);

    const html = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/music/upload`,
      headers: { "content-type": "audio/mpeg" },
      payload: Buffer.from("<!doctype html><html><body>nope</body></html>"),
    });
    expect(html.statusCode).toBe(415);

    const patched = await app.inject({ method: "PATCH", url: `/api/projects/${project.id}/music/settings`, payload: { volume: 0.4, fadeOutSec: 5, duckingDb: -18 } });
    expect(patched.json<ProjectMusic>().selection).toMatchObject({ volume: 0.4, fadeOutSec: 5, duckingDb: -18 });
    expect((await app.inject({ method: "PATCH", url: `/api/projects/${project.id}/music/settings`, payload: { volume: 3 } })).statusCode).toBe(400);

    const none = await app.inject({ method: "POST", url: `/api/projects/${project.id}/music/none` });
    expect(none.json<ProjectMusic>().selection).toMatchObject({ status: "NONE", candidateId: null });

    const reselect = await app.inject({ method: "POST", url: `/api/projects/${project.id}/music/select`, payload: { candidateId: afterUpload.selectedCandidate!.id } });
    expect(reselect.json<ProjectMusic>().selection?.status).toBe("APPROVED");
  });

  it("blocks MUSIC_REVIEW approval until a track or 'no music' is chosen", async () => {
    const project = await createProject();
    repository.ensureStages(project.id);
    repository.updateStage(project.id, "MUSIC_REVIEW", { state: "WAITING_USER", progress: 0, message: null, jobId: null, error: null });
    const blocked = await app.inject({ method: "POST", url: `/api/projects/${project.id}/pipeline/gates/MUSIC_REVIEW/approve` });
    expect(blocked.statusCode).toBe(409);
    await app.inject({ method: "POST", url: `/api/projects/${project.id}/music/none` });
    const approved = await app.inject({ method: "POST", url: `/api/projects/${project.id}/pipeline/gates/MUSIC_REVIEW/approve` });
    expect(approved.statusCode).toBeLessThan(300);
  });
});
