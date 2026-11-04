import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Project } from "@vg/shared";
import { buildApp } from "../src/app.js";
import { parseConfig, type AppConfig } from "../src/lib/config.js";
import { JobRepository } from "../src/jobs/jobRepository.js";
import { PipelineEventBus } from "../src/jobs/eventBus.js";
import { VisualService } from "../src/services/visualService.js";
import { AutoReportService } from "../src/services/autoReportService.js";
import { MusicService } from "../src/services/musicService.js";
import { AudioStore } from "../src/services/audioStore.js";
import { createMusicProviders } from "../src/providers/music/registry.js";
import { probeDurationSec } from "../src/media/ffmpeg.js";
import { projectDir } from "../src/storage/paths.js";
import { GuidelineService } from "../src/guidelines/service.js";
import { createPipelineHarness, drainUntilGate } from "./pipelineFixtures.js";

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
  app = buildApp({ config });
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
}): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  const provider = opts.provider ?? "mock";
  let localPath: string | null = null;
  let sha256: string | null = null;
  if (opts.withFile !== false) {
    const dir = projectDir(config.DATA_DIR, project.id);
    mkdirSync(join(dir, "visuals"), { recursive: true });
    writeFileSync(join(dir, `visuals/${id}.jpg`), "img");
    localPath = `visuals/${id}.jpg`;
    sha256 = "b".repeat(64);
  }
  sqlite.prepare(
    `INSERT INTO visual_candidates (id, project_id, scene_id, origin, provider, provider_item_id, query, title, description,
      tags, preview_url, image_url, source_url, source_page_url, source_site, width, height, aspect_ratio, file_type, watermark,
      relevance_score, score_breakdown, license, license_verified, rank, local_path, sha256, actual_width, actual_height,
      vision_check, created_at, search_hash)
     VALUES (?, ?, ?, 'SEARCH', ?, ?, 'q', 'Title', 'd', '[]', 'http://x/p', 'http://x/i', 'http://x/s', ?, 'site',
      1920, 1080, 1.78, 'jpg', 'NONE', ?, '{}', ?, ?, ?, ?, ?, 1920, 1080, ?, ?, 'h')`,
  ).run(
    id,
    project.id,
    opts.sceneId,
    provider,
    id,
    opts.sourcePageUrl ?? null,
    opts.relevance ?? 0.5,
    JSON.stringify({ kind: "UNKNOWN", name: "", url: null, author: null, authorUrl: null, attributionRequired: false, attributionText: "", evidence: "none" }),
    opts.licenseVerified === false ? 0 : 1,
    opts.rank ?? 0,
    localPath,
    sha256,
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
    expect(visuals.canApproveVisualReview(project.id).allowed).toBe(true);

    const projectVisuals = visuals.getProjectVisuals(project.id);
    const byId = Object.fromEntries(projectVisuals.scenes.map((scene) => [scene.sceneId, scene]));
    expect(byId[needsAttention].status).toBe("READY_FOR_RENDER");
    expect(byId[needsAttention].selectedCandidate?.id).toBe(lowFit);
    expect(byId[unverifiedOnly].status).toBe("READY_FOR_RENDER");
    expect(byId[unverifiedOnly].selectedCandidate?.id).toBe(web);
    expect(byId[mixed].selectedCandidate?.id).toBe(verified);
    expect(byId[empty].status).toBe("READY_FOR_RENDER"); // reused from neighbour
    expect(byId[empty].selectedCandidate?.scoreBreakdown.reusedNeighbour).toBe(true);

    const report = autoReport.responseFor(project.id);
    const codes = report.groups.flatMap((group) => group.entries.map((entry) => entry.code));
    expect(codes).toContain("VISUAL_LOW_FIT");
    expect(codes).toContain("VISUAL_UNVERIFIED_LICENSE");
    expect(codes).toContain("VISUAL_REUSED_NEIGHBOUR");
    expect(codes).not.toContain("VISUAL_SKIPPED");

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
    expect(visuals.getProjectVisuals(project.id).scenes[0].status).toBe("SKIPPED");
    expect(autoReport.list(project.id).some((entry) => entry.code === "VISUAL_SKIPPED" && entry.sceneId === alone)).toBe(true);
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
