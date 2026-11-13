import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { STAGE_ORDER, type NotificationEvent, type Project } from "@vg/shared";
import { buildApp } from "../src/app.js";
import { testActor } from "./testActor.js";
import { parseConfig, type AppConfig } from "../src/lib/config.js";
import { JobRepository } from "../src/jobs/jobRepository.js";
import { PipelineEventBus } from "../src/jobs/eventBus.js";
import { VisualService } from "../src/services/visualService.js";
import { AutoReportService } from "../src/services/autoReportService.js";
import { MusicService } from "../src/services/musicService.js";
import { AudioStore } from "../src/services/audioStore.js";
import { ImageStore } from "../src/services/imageStore.js";
import { HostDownloadRateLimiter } from "../src/providers/images/rateLimiter.js";
import { createMusicProviders } from "../src/providers/music/registry.js";
import { probeDurationSec } from "../src/media/ffmpeg.js";
import { projectDir } from "../src/storage/paths.js";
import { GuidelineService } from "../src/guidelines/service.js";
import { createPipelineHarness, drainUntilGate } from "./pipelineFixtures.js";
import { AppError } from "../src/lib/errors.js";
import { PipelineOrchestrator } from "../src/pipeline/orchestrator.js";

const pngFixture = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "images", "tiny.png"));

const root = mkdtempSync(join(tmpdir(), "vg-auto-report-"));
let dataDir: string;
let config: AppConfig;
let app: ReturnType<typeof buildApp>;
let project: Project;
let sqlite: Database.Database;
const harnesses: ReturnType<typeof createPipelineHarness>[] = [];

beforeEach(async () => {
  dataDir = join(root, `run-${randomUUID()}`);
  config = parseConfig({
    DATA_DIR: dataDir,
    DATABASE_PATH: join(dataDir, "app.db"),
    WORKER_ENABLED: "false",
    LOG_LEVEL: "silent",
    IMAGE_PROVIDERS: "mock",
    LLM_DEFAULT_PROVIDER: "mock",
    LLM_ENABLE_MOCK: "true",
  });
  app = buildApp({ testActor,  config });
  const created = await app.inject({
    method: "POST",
    url: "/api/projects",
    payload: {
      topic: "AUTO report fixture",
      mode: "AUTO",
      settings: { budget: { mode: "ECO" }, music: { enabled: true, volume: 0.15 } },
    },
  });
  expect(created.statusCode).toBe(201);
  project = created.json<Project>();
  sqlite = new Database(config.DATABASE_PATH);
});

afterEach(async () => {
  for (const harness of harnesses.splice(0)) harness.close();
  sqlite.close();
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

function insertScene(order: number, label: string): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  sqlite.prepare(
    `INSERT INTO scenes (id, project_id, "order", kind, section_id, label, narration, visual_notes, visual_description, no_visual, visual_queries,
      music_mood, energy, est_duration_sec, duration_override_sec, start_sec, transition_note, origin, edited,
      input_hash, created_at, updated_at)
     VALUES (?, ?, ?, 'section', NULL, ?, ?, '', '', 0, ?, '', 'medium', 4, NULL, 0, '', 'AGENT', 0, 'fixture', ?, ?)`,
  ).run(
    id,
    project.id,
    order,
    label,
    `Narration ${label}`,
    JSON.stringify({ primary: label, alternatives: [], queryVariant: false }),
    now,
    now,
  );
  return id;
}

function insertCandidate(opts: {
  sceneId: string;
  provider?: string;
  licenseVerified?: boolean;
  sourcePageUrl?: string;
  withFile?: boolean;
  visionFit?: number;
  relevance?: number;
  rank?: number;
  imageUrl?: string;
}): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  const provider = opts.provider ?? "mock";
  const imageUrl = opts.imageUrl ?? `http://x/${id}/i`;
  let localPath: string | null = null;
  let sha256: string | null = null;
  let actualW: number | null = 1920;
  let actualH: number | null = 1080;
  if (opts.withFile !== false) {
    const dir = projectDir(config.DATA_DIR, project.id);
    mkdirSync(join(dir, "visuals"), { recursive: true });
    writeFileSync(join(dir, `visuals/${id}.jpg`), "img");
    localPath = `visuals/${id}.jpg`;
    sha256 = "b".repeat(64);
  } else {
    actualW = null;
    actualH = null;
  }
  sqlite.prepare(
    `INSERT INTO visual_candidates (id, project_id, scene_id, origin, provider, provider_item_id, query, title, description,
      tags, preview_url, image_url, source_url, source_page_url, source_site, width, height, aspect_ratio, file_type, watermark,
      relevance_score, score_breakdown, license, license_verified, rank, local_path, sha256, actual_width, actual_height,
      vision_check, created_at, search_hash)
     VALUES (?, ?, ?, 'SEARCH', ?, ?, 'q', 'Title', 'd', '[]', ?, ?, ?, ?, 'site',
      1920, 1080, 1.78, 'jpg', 'NONE', ?, '{}', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'h')`,
  ).run(
    id,
    project.id,
    opts.sceneId,
    provider,
    id,
    imageUrl,
    imageUrl,
    imageUrl,
    opts.sourcePageUrl ?? null,
    opts.relevance ?? 0.5,
    JSON.stringify({ kind: "UNKNOWN", name: "", url: null, author: null, authorUrl: null, attributionRequired: false, attributionText: "", evidence: "none" }),
    opts.licenseVerified === false ? 0 : 1,
    opts.rank ?? 0,
    localPath,
    sha256,
    actualW,
    actualH,
    opts.visionFit == null ? null : JSON.stringify({
      fit: opts.visionFit,
      depicts: "subject",
      issues: [],
      cropOk: true,
      model: "mock",
      checkedAt: now.endsWith("Z") ? now.replace("Z", "+00:00") : now,
    }),
    now,
  );
  return id;
}

function setNeedsAttention(sceneId: string, reason = "fit thấp"): void {
  const now = new Date().toISOString();
  sqlite.prepare(
    `INSERT INTO visual_search_state (scene_id, project_id, search_hash, vision_meta, updated_at)
     VALUES (?, ?, 'h', ?, ?)
     ON CONFLICT(scene_id) DO UPDATE SET vision_meta = excluded.vision_meta, updated_at = excluded.updated_at`,
  ).run(sceneId, project.id, JSON.stringify({ needsAttention: true, reason }), now);
}

function selectCandidate(sceneId: string, candidateId: string, status = "DISCOVERED"): void {
  const now = new Date().toISOString();
  sqlite.prepare(
    `INSERT INTO visual_selections (id, project_id, scene_id, slot, candidate_id, status, selected_by, motion, reviewed_at, created_at, updated_at)
     VALUES (?, ?, ?, 0, ?, ?, 'AGENT', NULL, NULL, ?, ?)`,
  ).run(randomUUID(), project.id, sceneId, candidateId, status, now, now);
}

describe("AUTO report and autoResolve", () => {
  it("autoResolve handles NEEDS_ATTENTION, unverified-only, mixed, and empty scenes", async () => {
    const needsAttention = insertScene(0, "needs");
    const unverifiedOnly = insertScene(1, "unverified");
    const mixed = insertScene(2, "mixed");
    const empty = insertScene(3, "empty");

    const lowFit = insertCandidate({ sceneId: needsAttention, visionFit: 4, relevance: 0.9, withFile: true });
    insertCandidate({ sceneId: needsAttention, visionFit: 2, relevance: 0.95, withFile: true });
    selectCandidate(needsAttention, lowFit);
    setNeedsAttention(needsAttention);

    const web = insertCandidate({
      sceneId: unverifiedOnly,
      provider: "brave",
      licenseVerified: false,
      sourcePageUrl: "https://example.org/page",
      withFile: true,
    });
    selectCandidate(unverifiedOnly, web);

    const verified = insertCandidate({ sceneId: mixed, provider: "wikimedia", licenseVerified: true, relevance: 0.4, withFile: true });
    insertCandidate({
      sceneId: mixed,
      provider: "brave",
      licenseVerified: false,
      relevance: 0.99,
      sourcePageUrl: "https://example.org/ignored",
      withFile: true,
    });
    selectCandidate(mixed, verified, "APPROVED");

    // empty: no candidates

    const events = new PipelineEventBus();
    const repository = new JobRepository(sqlite, events);
    repository.updateStage(project.id, "VISUAL_SEARCH", {
      state: "DONE", progress: 100, message: null, jobId: null, error: null,
    });
    const autoReport = new AutoReportService(sqlite);
    const visuals = new VisualService(sqlite, repository, config, undefined, { autoReport });

    expect(visuals.canApproveVisualReview(project.id).allowed).toBe(false);
    await visuals.autoResolve(project.id);
    expect(visuals.canApproveVisualReview(project.id).allowed).toBe(false);

    const projectVisuals = visuals.getProjectVisuals(project.id);
    const byId = Object.fromEntries(projectVisuals.scenes.map((scene) => [scene.sceneId, scene]));
    expect(byId[needsAttention].status).toBe("NEEDS_ATTENTION");
    expect(byId[needsAttention].attentionReason).toBe("vision_reject");
    expect(byId[unverifiedOnly].status).not.toBe("READY_FOR_RENDER");
    expect(byId[mixed].status).toBe("READY_FOR_RENDER");
    expect(byId[mixed].selectedCandidate?.id).toBe(verified);
    expect(byId[empty].status).toBe("NEEDS_ATTENTION");
    expect(byId[empty].attentionReason).toBe("no_candidate");

    const report = autoReport.responseFor(project.id);
    const codes = report.groups.flatMap((group) => group.entries.map((entry) => entry.code));
    expect(codes).toContain("VISUAL_NEEDS_USER");
    expect(codes.filter((code) => code === "VISUAL_NEEDS_USER")).toHaveLength(1);
    expect(codes).not.toContain("VISUAL_LOW_FIT");
    expect(codes).not.toContain("VISUAL_TITLE_CARD");
    expect(codes).not.toContain("VISUAL_REUSED_NEIGHBOUR");

    const api = await app.inject({ method: "GET", url: `/api/projects/${project.id}/auto-report` });
    expect(api.statusCode).toBe(200);
    expect(api.json().warnCount).toBeGreaterThan(0);
    expect(api.json().groups.some((group: { stage: string }) => group.stage === "VISUAL_REVIEW")).toBe(true);
  });

  it("skips a scene with no candidates and no neighbour image", async () => {
    const alone = insertScene(0, "alone");
    const events = new PipelineEventBus();
    const repository = new JobRepository(sqlite, events);
    repository.updateStage(project.id, "VISUAL_SEARCH", {
      state: "DONE", progress: 100, message: null, jobId: null, error: null,
    });
    const autoReport = new AutoReportService(sqlite);
    const visuals = new VisualService(sqlite, repository, config, undefined, { autoReport });
    await visuals.autoResolve(project.id);
    expect(visuals.getProjectVisuals(project.id).scenes[0].status).toBe("NEEDS_ATTENTION");
    expect(visuals.getProjectVisuals(project.id).scenes[0].attentionReason).toBe("no_candidate");
    expect(autoReport.list(project.id).some((entry) => entry.code === "VISUAL_NEEDS_USER")).toBe(true);
    expect(autoReport.list(project.id).some((entry) => entry.code === "VISUAL_TITLE_CARD" && entry.sceneId === alone)).toBe(false);
  });

  it("autoResolve skips a 403 download and approves the next candidate", async () => {
    const sceneId = insertScene(0, "dl-fallback");
    const failUrl = "https://images.example.test/fail.jpg";
    const okUrl = "https://images.example.test/ok.jpg";
    const first = insertCandidate({
      sceneId, relevance: 0.99, rank: 0, withFile: false, imageUrl: failUrl,
    });
    const second = insertCandidate({
      sceneId, relevance: 0.5, rank: 1, withFile: false, imageUrl: okUrl,
    });
    selectCandidate(sceneId, first);

    const fetchImpl = async (input: string | URL) => {
      const url = String(input);
      if (url === failUrl) return new Response(null, { status: 403 });
      if (url === okUrl) return new Response(pngFixture, { status: 200, headers: { "content-type": "image/png" } });
      return new Response(null, { status: 404 });
    };
    const imageStore = new ImageStore(config.DATA_DIR, "test-agent", {
      fetchImpl: fetchImpl as typeof fetch,
      resolveHost: async () => ["203.0.113.10"],
      hostRateLimiter: new HostDownloadRateLimiter(0, Date.now, async () => undefined),
    });
    const repository = new JobRepository(sqlite, new PipelineEventBus());
    repository.updateStage(project.id, "VISUAL_SEARCH", {
      state: "DONE", progress: 100, message: null, jobId: null, error: null,
    });
    const autoReport = new AutoReportService(sqlite);
    const visuals = new VisualService(sqlite, repository, config, undefined, { autoReport, imageStore });

    await expect(visuals.autoResolve(project.id)).resolves.toBeUndefined();
    const scene = visuals.getProjectVisuals(project.id).scenes[0];
    expect(scene.status).toBe("READY_FOR_RENDER");
    expect(scene.selectedCandidate?.id).toBe(second);
    expect(sqlite.prepare("SELECT download_error FROM visual_candidates WHERE id = ?")
      .get(first)).toMatchObject({ download_error: expect.stringContaining("403") });
    const downloadEntry = autoReport.list(project.id).find((entry) => entry.code === "VISUAL_DOWNLOAD_FAILED");
    expect(downloadEntry).toBeTruthy();
    expect(downloadEntry?.data).toMatchObject({
      failed: expect.arrayContaining([
        expect.objectContaining({ candidateId: first, status: 403, host: "images.example.test" }),
      ]),
    });
  });

  it("autoResolve reuses a neighbour when every candidate download fails", async () => {
    const neighbour = insertScene(0, "neighbour-ok");
    const target = insertScene(1, "all-fail");
    const good = insertCandidate({ sceneId: neighbour, withFile: true });
    selectCandidate(neighbour, good, "APPROVED");
    const failUrl = "https://images.example.test/blocked.jpg";
    insertCandidate({ sceneId: target, withFile: false, imageUrl: failUrl, relevance: 0.9 });
    insertCandidate({ sceneId: target, withFile: false, imageUrl: failUrl, relevance: 0.8, rank: 1 });

    const imageStore = new ImageStore(config.DATA_DIR, "test-agent", {
      fetchImpl: (async () => new Response(null, { status: 403 })) as typeof fetch,
      resolveHost: async () => ["203.0.113.10"],
      hostRateLimiter: new HostDownloadRateLimiter(0, Date.now, async () => undefined),
    });
    const repository = new JobRepository(sqlite, new PipelineEventBus());
    repository.updateStage(project.id, "VISUAL_SEARCH", {
      state: "DONE", progress: 100, message: null, jobId: null, error: null,
    });
    const autoReport = new AutoReportService(sqlite);
    const visuals = new VisualService(sqlite, repository, config, undefined, { autoReport, imageStore });

    await expect(visuals.autoResolve(project.id)).resolves.toBeUndefined();
    const byLabel = Object.fromEntries(
      visuals.getProjectVisuals(project.id).scenes.map((scene) => [scene.sceneId, scene]),
    );
    expect(byLabel[target].status).toBe("NEEDS_ATTENTION");
    expect(byLabel[neighbour].status).toBe("READY_FOR_RENDER");
    expect(autoReport.list(project.id).some((entry) => entry.code === "VISUAL_DOWNLOAD_FAILED")).toBe(true);
    expect(autoReport.list(project.id).some((entry) => entry.code === "VISUAL_NEEDS_USER")).toBe(true);
    expect(autoReport.list(project.id).some((entry) => entry.code === "VISUAL_TITLE_CARD")).toBe(false);
    expect(autoReport.list(project.id).some((entry) => entry.code === "VISUAL_REUSED_NEIGHBOUR")).toBe(false);
  });

  it("AUTO waits once for images, then continues after the user uploads", async () => {
    const sceneId = insertScene(0, "ask-user");
    const repository = new JobRepository(sqlite, new PipelineEventBus());
    repository.updateStage(project.id, "VISUAL_SEARCH", {
      state: "DONE", progress: 100, message: null, jobId: null, error: null,
    });
    const autoReport = new AutoReportService(sqlite);
    const visuals = new VisualService(sqlite, repository, config, undefined, { autoReport });
    await visuals.autoResolve(project.id);
    expect(visuals.getProjectVisuals(project.id).scenes[0].status).toBe("NEEDS_ATTENTION");
    expect(autoReport.list(project.id).filter((entry) => entry.code === "VISUAL_NEEDS_USER")).toHaveLength(1);

    repository.ensureStages(project.id);
    for (const stage of STAGE_ORDER) {
      if (stage === "VISUAL_REVIEW") break;
      repository.updateStage(project.id, stage, {
        state: "DONE", progress: 100, message: null, jobId: null, error: null,
      });
    }
    const notes: NotificationEvent[] = [];
    const orchestrator = new PipelineOrchestrator(
      repository,
      config,
      app.log,
      () => new Date("2026-11-11T00:00:00.000Z"),
      (current, gate) => gate === "VISUAL_REVIEW"
        ? visuals.canApproveVisualReview(current.id)
        : { allowed: true },
    );
    orchestrator.setNotificationService({
      notify: async (event: NotificationEvent) => { notes.push(event); },
    } as never);
    orchestrator.runAll(project.id);
    const waiting = orchestrator.getPipeline(project.id).stages.find((stage) => stage.stage === "VISUAL_REVIEW");
    expect(waiting?.state).toBe("WAITING_USER");
    expect(notes.filter((event) => event.kind === "waiting_approval")).toHaveLength(1);
    expect(notes[0]).toMatchObject({ kind: "waiting_approval", gate: "VISUAL_REVIEW" });

    visuals.addUpload(project.id, sceneId, pngFixture, "scene.png", "image/png");
    expect(visuals.canApproveVisualReview(project.id).allowed).toBe(true);
    orchestrator.approveGate(project.id, "VISUAL_REVIEW");
    expect(orchestrator.getPipeline(project.id).stages.find((stage) => stage.stage === "VOICE")?.state).toBe("QUEUED");
  });

  it("ASSISTED manual approve still returns 422 when download fails", async () => {
    const sceneId = insertScene(0, "manual-fail");
    const failUrl = "https://images.example.test/manual-fail.jpg";
    const candidateId = insertCandidate({ sceneId, withFile: false, imageUrl: failUrl });
    selectCandidate(sceneId, candidateId);
    const imageStore = new ImageStore(config.DATA_DIR, "test-agent", {
      fetchImpl: (async () => new Response(null, { status: 403 })) as typeof fetch,
      resolveHost: async () => ["203.0.113.10"],
      hostRateLimiter: new HostDownloadRateLimiter(0, Date.now, async () => undefined),
    });
    const repository = new JobRepository(sqlite, new PipelineEventBus());
    const visuals = new VisualService(sqlite, repository, config, undefined, { imageStore });
    await expect(visuals.approveScene(project.id, sceneId)).rejects.toMatchObject({
      statusCode: 422,
      code: "IMAGE_DOWNLOAD_FAILED",
    } satisfies Partial<AppError>);
  });

  it("logs MUSIC_AUTO_PICKED and MUSIC_NONE", async () => {
    const autoReport = new AutoReportService(sqlite);
    const music = new MusicService(
      sqlite,
      config,
      createMusicProviders(config),
      new AudioStore(config.DATA_DIR, config.IMAGE_SEARCH_USER_AGENT),
      probeDurationSec,
    );
    // No candidates → NONE path via selectNone
    music.selectNone(project, "AGENT");
    autoReport.clearStage(project.id, "MUSIC_REVIEW");
    autoReport.add(project.id, {
      stage: "MUSIC_REVIEW",
      code: "MUSIC_NONE",
      severity: "WARN",
      message: "Không dùng nhạc — không có bản ứng viên phù hợp.",
    });
    expect(music.canApproveMusicReview(project).allowed).toBe(true);
    expect(autoReport.list(project.id).map((entry) => entry.code)).toContain("MUSIC_NONE");

    const now = new Date().toISOString();
    const candidateId = randomUUID();
    sqlite.prepare(
      `INSERT INTO music_candidates (id, project_id, provider, provider_item_id, title, artist, source_url, audio_url, duration_sec,
        genres, tags, license, relevance_score, score_breakdown, rank, local_path, input_hash, created_at)
       VALUES (?, ?, 'mock', ?, 'Calm', NULL, NULL, NULL, 120, '[]', '[]', ?, 1, '{}', 0, NULL, '', ?)`,
    ).run(
      candidateId,
      project.id,
      candidateId,
      JSON.stringify({ kind: "CC0", name: "CC0", url: null, author: null, authorUrl: null, attributionRequired: false, attributionText: "", evidence: "api" }),
      now,
    );
    autoReport.clearStage(project.id, "MUSIC_REVIEW");
    autoReport.add(project.id, {
      stage: "MUSIC_REVIEW",
      code: "MUSIC_AUTO_PICKED",
      severity: "INFO",
      message: "AUTO đã chọn bản nhạc xếp hạng cao nhất.",
      data: { candidateId },
    });
    expect(autoReport.list(project.id).map((entry) => entry.code)).toEqual(["MUSIC_AUTO_PICKED"]);
  });

  it("records MUST_FINDING_OPEN via AutoReportService and does not block AUTO canApprove path", () => {
    const autoReport = new AutoReportService(sqlite);
    new GuidelineService(sqlite).replaceFindings(project.id, "SCRIPT", "CODE", [{
      ruleId: "youtube.no_misleading",
      severity: "MUST",
      sceneId: null,
      text: "Cần nguồn",
      quote: null,
      suggestion: null,
    }]);
    autoReport.clearStage(project.id, "SCRIPT");
    for (const finding of new GuidelineService(sqlite).listFindings(project.id)) {
      if (finding.status !== "OPEN" || finding.severity !== "MUST") continue;
      autoReport.add(project.id, {
        stage: "SCRIPT",
        sceneId: finding.sceneId,
        code: "MUST_FINDING_OPEN",
        severity: "WARN",
        message: `MUST còn mở (${finding.ruleId}): ${finding.text}`,
        data: { ruleId: finding.ruleId },
      });
    }
    expect(autoReport.responseFor(project.id).groups[0].entries[0].code).toBe("MUST_FINDING_OPEN");
  });

  it("ASSISTED still waits at VISUAL_REVIEW while AUTO passes when canApprove allows", async () => {
    const assisted = createPipelineHarness({ mode: "ASSISTED" });
    harnesses.push(assisted);
    assisted.orchestrator.runAll(assisted.projectId);
    await drainUntilGate(assisted);
    expect(assisted.orchestrator.getPipeline(assisted.projectId).stages.find((stage) => stage.stage === "VISUAL_REVIEW")?.state)
      .toBe("WAITING_USER");

    const automatic = createPipelineHarness({ mode: "AUTO", autoBlock: () => null });
    harnesses.push(automatic);
    automatic.orchestrator.runAll(automatic.projectId);
    await drainUntilGate(automatic);
    expect(automatic.orchestrator.getPipeline(automatic.projectId).stages.find((stage) => stage.stage === "VISUAL_REVIEW")?.state)
      .toBe("DONE");
  });
});
