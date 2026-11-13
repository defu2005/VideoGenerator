import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job, Project } from "@vg/shared";
import { buildApp } from "../src/app.js";
import { testActor } from "./testActor.js";
import { parseConfig, type AppConfig } from "../src/lib/config.js";
import { PipelineEventBus } from "../src/jobs/eventBus.js";
import { JobRepository } from "../src/jobs/jobRepository.js";
import { VisualService } from "../src/services/visualService.js";
import { LlmProviderRegistry } from "../src/providers/llm/registry.js";
import type { ImageSearchProvider, NormalizedImageResult } from "../src/providers/images/types.js";
import { ImageProviderError } from "../src/providers/images/http.js";
import { TokenBucketRateLimiter } from "../src/providers/images/rateLimiter.js";
import { BraveImageProvider } from "../src/providers/images/brave.js";
import { saveImageSourcesSettings } from "../src/settings/imageSources.js";
import { STOCK_IMAGE_PROVIDERS } from "@vg/shared";
import type { StageContext } from "../src/pipeline/stageExecutor.js";

const root = mkdtempSync(join(tmpdir(), "vg-visual-gate-"));
let dataDir: string;
let config: AppConfig;
let app: ReturnType<typeof buildApp>;
let sqlite: Database.Database;
let project: Project;
let sceneId: string;

function limiter() {
  return new TokenBucketRateLimiter({ mock: 60_000, wikimedia: 60_000, met: 60_000, brave: 60_000 }, () => 0, async () => undefined);
}

function image(partial: Partial<NormalizedImageResult> & { providerItemId: string; title: string }): NormalizedImageResult {
  return {
    provider: "wikimedia",
    description: partial.title,
    tags: partial.title.split(" "),
    previewUrl: `https://images.test/${partial.providerItemId}.jpg`,
    imageUrl: `https://images.test/${partial.providerItemId}-full.jpg`,
    sourceUrl: `https://source.test/${partial.providerItemId}`,
    sourceSite: "Test",
    width: 1600,
    height: 900,
    fileType: "jpg",
    watermark: "NONE",
    license: {
      kind: "CC0", name: "CC0", url: null, author: "Tester", authorUrl: null,
      attributionRequired: false, attributionText: "", evidence: "api",
    },
    licenseVerified: true,
    ...partial,
  };
}

function stageContext(): StageContext {
  const timestamp = new Date().toISOString();
  const job: Job = {
    id: randomUUID(), projectId: project.id, stage: "VISUAL_SEARCH", scope: null, status: "RUNNING",
    progress: 0, message: null, attempt: 1, maxAttempts: 1, error: null, usage: null,
    createdAt: timestamp, startedAt: timestamp, finishedAt: null, runAfter: timestamp,
  };
  return {
    project, job, signal: new AbortController().signal, reportProgress: () => undefined,
    recordUsage: () => undefined, logger: app.log,
  };
}

async function boot(topic: string, providers: string) {
  dataDir = join(root, `run-${randomUUID()}`);
  config = parseConfig({
    DATA_DIR: dataDir,
    DATABASE_PATH: join(dataDir, "app.db"),
    WORKER_ENABLED: "false",
    LOG_LEVEL: "silent",
    IMAGE_PROVIDERS: providers,
    LLM_ENABLE_MOCK: "true",
    LLM_DEFAULT_PROVIDER: "mock",
  });
  app = buildApp({ testActor,  config });
  const created = await app.inject({
    method: "POST",
    url: "/api/projects",
    payload: { topic, settings: { budget: { mode: "ECO" }, language: "en" } },
  });
  project = created.json<Project>();
  sqlite = new Database(config.DATABASE_PATH);
  saveImageSourcesSettings(sqlite, {
    enabled: Object.fromEntries(STOCK_IMAGE_PROVIDERS.map((id) => [id, true])) as Record<(typeof STOCK_IMAGE_PROVIDERS)[number], boolean>,
  });
  sceneId = randomUUID();
  const now = new Date().toISOString();
  sqlite.prepare(
    `INSERT INTO scenes (id, project_id, "order", kind, section_id, label, narration, visual_notes, visual_queries,
      music_mood, energy, est_duration_sec, duration_override_sec, start_sec, transition_note, origin, edited,
      input_hash, created_at, updated_at)
     VALUES (?, ?, 0, 'section', NULL, 'Scene', ?, '', ?, '', 'medium', 4, NULL, 0, '', 'AGENT', 0, 'fixture', ?, ?)`,
  ).run(sceneId, project.id, "Guts raises the Dragon Slayer.", JSON.stringify({
    primary: "human spirit", alternatives: ["peaceful dawn"], queryVariant: false,
  }), now, now);
}

beforeEach(() => undefined);
afterEach(async () => {
  vi.restoreAllMocks();
  sqlite?.close();
  await app?.close();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("visual relevance gate", () => {
  it("does not mark an off-topic Berserk fixture ready", async () => {
    await boot("Berserk manga", "wikimedia");
    const titles = ["Golden Hawks marching band", "thunderstorm", "satellite", "Gut on Chip"];
    let cursor = 0;
    const provider: ImageSearchProvider = {
      id: "wikimedia",
      enabled: () => true,
      search: async () => {
        const title = titles[cursor % titles.length]!;
        cursor += 1;
        return [image({ provider: "wikimedia", providerItemId: `bad-${cursor}`, title })];
      },
    };
    const visuals = new VisualService(sqlite, new JobRepository(sqlite, new PipelineEventBus()), config, app.log, {
      providers: [provider], limiter: limiter(),
    });
    const result = await visuals.executeStage(stageContext(), new LlmProviderRegistry(config));
    expect(result.message).toContain("W ");
    const scenes = visuals.getProjectVisuals(project.id).scenes;
    expect(scenes.every((scene) => scene.status !== "READY_FOR_RENDER")).toBe(true);
    expect(scenes.every((scene) => scene.lowRelevance || scene.selectedCandidate === null || scene.attentionReason)).toBe(true);
  });

  it("calls Brave in the first pass for a fictional topic and keeps negative terms", async () => {
    await boot("Berserk manga", "wikimedia");
    project = {
      ...project,
      settings: { ...project.settings, budget: { ...project.settings.budget, mode: "BALANCED" } },
    };
    sqlite.prepare("UPDATE projects SET topic = ?, settings = ? WHERE id = ?").run(
      project.topic, JSON.stringify(project.settings), project.id,
    );
    vi.stubGlobal("fetch", vi.fn(async () => new Response("offline", { status: 500 })));
    config = parseConfig({
      DATA_DIR: dataDir,
      DATABASE_PATH: join(dataDir, "app.db"),
      WORKER_ENABLED: "false",
      LOG_LEVEL: "silent",
      IMAGE_PROVIDERS: "wikimedia",
      BRAVE_SEARCH_API_KEY: "test-brave",
      LLM_ENABLE_MOCK: "true",
      LLM_DEFAULT_PROVIDER: "mock",
    });
    const queries: string[] = [];
    vi.spyOn(BraveImageProvider.prototype, "search").mockImplementation(async (input) => {
      queries.push(input.query);
      return [image({
        provider: "brave",
        providerItemId: "guts",
        title: "Berserk manga Guts human spirit",
        sourceUrl: "https://example.com/guts",
        sourcePageUrl: "https://example.com/guts-page",
        licenseVerified: true,
      })];
    });
    const provider: ImageSearchProvider = {
      id: "wikimedia",
      enabled: () => true,
      search: async () => [image({ providerItemId: "band", title: "Golden Hawks marching band" })],
    };
    const visuals = new VisualService(sqlite, new JobRepository(sqlite, new PipelineEventBus()), config, app.log, {
      providers: [provider], limiter: limiter(),
    });
    await visuals.executeStage(stageContext(), new LlmProviderRegistry(config));
    expect(queries.length).toBeGreaterThan(0);
    expect(queries[0]).toContain("Berserk");
    expect(queries[0]).toContain("-cosplay");
    expect(queries[0]).toContain("-statue");
    const selected = visuals.getProjectVisuals(project.id).scenes[0];
    expect(selected?.selectedCandidate?.providerItemId).toBe("guts");
  });

  it("blocks a provider after the first HTTP 410 and still searches the others", async () => {
    await boot("River documentary", "wikimedia,met");
    const met = { calls: 0 };
    const wiki = { calls: 0 };
    const providers: ImageSearchProvider[] = [
      {
        id: "met",
        enabled: () => true,
        search: async () => {
          met.calls += 1;
          throw new ImageProviderError("gone", 410, false);
        },
      },
      {
        id: "wikimedia",
        enabled: () => true,
        search: async ({ query }) => {
          wiki.calls += 1;
          return [image({ providerItemId: "river", title: query })];
        },
      },
    ];
    const visuals = new VisualService(sqlite, new JobRepository(sqlite, new PipelineEventBus()), config, app.log, {
      providers, limiter: limiter(),
    });
    const result = await visuals.executeStage(stageContext(), new LlmProviderRegistry(config));
    expect(met.calls).toBe(1);
    expect(wiki.calls).toBeGreaterThan(0);
    expect(result.message).toContain("met: unavailable (HTTP 410)");
  });

  it("replaces an agent-approved image when a later search passes the gate", async () => {
    await boot("River documentary", "wikimedia");
    let phase = 1;
    const provider: ImageSearchProvider = {
      id: "wikimedia",
      enabled: () => true,
      search: async ({ query }) => [image({
        providerItemId: phase === 1 ? "agent-pick" : "better-canyon",
        title: phase === 1 ? `${query} first` : `${query} canyon water`,
      })],
    };
    const visuals = new VisualService(sqlite, new JobRepository(sqlite, new PipelineEventBus()), config, app.log, {
      providers: [provider], limiter: limiter(),
    });
    const registry = new LlmProviderRegistry(config);
    await visuals.executeStage(stageContext(), registry);
    const before = visuals.getProjectVisuals(project.id).scenes[0];
    expect(before?.selection?.selectedBy).toBe("AGENT");
    expect(before?.selectedCandidate?.providerItemId).toBe("agent-pick");
    sqlite.prepare("UPDATE visual_selections SET status = 'APPROVED', selected_by = 'AGENT' WHERE scene_id = ?").run(sceneId);
    sqlite.prepare("UPDATE scenes SET visual_queries = ? WHERE id = ?").run(
      JSON.stringify({ primary: "canyon water", alternatives: [], queryVariant: false }),
      sceneId,
    );
    phase = 2;
    await visuals.executeStage(stageContext(), registry);
    const after = visuals.getProjectVisuals(project.id).scenes[0];
    expect(after?.selectedCandidate?.providerItemId).toBe("better-canyon");
    expect(after?.selection?.selectedBy).toBe("AGENT");
    expect(after?.visionMeta?.selectionHistory?.[0]).toMatchObject({
      fromCandidateId: before?.selection?.candidateId,
    });
  });

  it("does not replace an image the user chose", async () => {
    await boot("River documentary", "wikimedia");
    let round = 0;
    const provider: ImageSearchProvider = {
      id: "wikimedia",
      enabled: () => true,
      search: async ({ query }) => {
        round += 1;
        return [image({ providerItemId: `pick-${round}`, title: query })];
      },
    };
    const visuals = new VisualService(sqlite, new JobRepository(sqlite, new PipelineEventBus()), config, app.log, {
      providers: [provider], limiter: limiter(),
    });
    const registry = new LlmProviderRegistry(config);
    await visuals.executeStage(stageContext(), registry);
    const first = visuals.getSceneVisuals(project.id, sceneId).candidates[0];
    visuals.selectCandidate(project.id, sceneId, first.id);
    sqlite.prepare("UPDATE scenes SET visual_queries = ? WHERE id = ?").run(
      JSON.stringify({ primary: "different canyon", alternatives: [], queryVariant: false }),
      sceneId,
    );
    await visuals.executeStage(stageContext(), registry);
    const after = visuals.getProjectVisuals(project.id).scenes[0];
    expect(after?.selection?.selectedBy).toBe("USER");
    expect(after?.selection?.candidateId).toBe(first.id);
  });

  it("leaves a high-risk source for the user", async () => {
    await boot("River documentary", "wikimedia");
    const provider: ImageSearchProvider = {
      id: "wikimedia",
      enabled: () => true,
      search: async ({ query }) => [image({
        providerItemId: "reddit",
        title: query,
        sourceUrl: "https://www.reddit.com/r/pics/river.jpg",
        sourcePageUrl: "https://www.reddit.com/r/pics/comments/river",
        sourceSite: "reddit.com",
      })],
    };
    const visuals = new VisualService(sqlite, new JobRepository(sqlite, new PipelineEventBus()), config, app.log, {
      providers: [provider], limiter: limiter(),
    });
    await visuals.executeStage(stageContext(), new LlmProviderRegistry(config));
    const scene = visuals.getProjectVisuals(project.id).scenes[0];
    expect(scene?.status).not.toBe("READY_FOR_RENDER");
    expect(scene?.selectedCandidate).toBeNull();
  });

  it("replaces an agent pick with a better stored image and keeps a user lock", async () => {
    await boot("Berserk manga", "wikimedia");
    const provider: ImageSearchProvider = {
      id: "wikimedia",
      enabled: () => true,
      search: async () => [image({
        providerItemId: "first",
        title: "Berserk manga human spirit",
        width: 800,
        height: 600,
      })],
    };
    const visuals = new VisualService(sqlite, new JobRepository(sqlite, new PipelineEventBus()), config, app.log, {
      providers: [provider], limiter: limiter(),
    });
    const registry = new LlmProviderRegistry(config);
    await visuals.executeStage(stageContext(), registry);
    const before = visuals.getSceneVisuals(project.id, sceneId);
    expect(before.selection?.selectedBy).toBe("AGENT");
    const row = sqlite.prepare("SELECT * FROM visual_candidates WHERE id = ?").get(before.selection!.candidateId) as Record<string, unknown>;
    const columns = Object.keys(row);
    const betterId = randomUUID();
    const copy: Record<string, unknown> = {
      ...row,
      id: betterId,
      provider_item_id: "better",
      title: "Berserk manga human spirit portrait",
      width: 4000,
      height: 3000,
      rank: 0,
    };
    sqlite.prepare(`INSERT INTO visual_candidates (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`)
      .run(...columns.map((column) => copy[column]));
    await visuals.executeStage(stageContext(), registry);
    const replaced = visuals.getSceneVisuals(project.id, sceneId);
    expect(replaced.candidates.find((item) => item.id === replaced.selection?.candidateId)?.providerItemId).toBe("better");

    visuals.selectCandidate(project.id, sceneId, replaced.selection!.candidateId);
    const lockedId = visuals.getSceneVisuals(project.id, sceneId).selection!.candidateId;
    const lockedRow = sqlite.prepare("SELECT * FROM visual_candidates WHERE id = ?").get(lockedId) as Record<string, unknown>;
    const newerId = randomUUID();
    const newer = { ...lockedRow, id: newerId, provider_item_id: "newer", width: 5000, height: 4000, rank: 0 };
    sqlite.prepare(`INSERT INTO visual_candidates (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`)
      .run(...columns.map((column) => newer[column]));
    await visuals.executeStage(stageContext(), registry);
    expect(visuals.getSceneVisuals(project.id, sceneId).selection).toMatchObject({
      candidateId: lockedId,
      selectedBy: "USER",
    });
  });

  it("keeps a MAX agent scene without a vision result out of ready", async () => {
    await boot("River documentary", "wikimedia");
    const settings = { ...project.settings, budget: { mode: "MAX" as const } };
    sqlite.prepare("UPDATE projects SET settings = ? WHERE id = ?").run(JSON.stringify(settings), project.id);
    const candidateId = randomUUID();
    const selectionId = randomUUID();
    const now = new Date().toISOString();
    const license = JSON.stringify({
      kind: "CC0", name: "CC0", url: null, author: "Tester", authorUrl: null,
      attributionRequired: false, attributionText: "", evidence: "api",
    });
    sqlite.prepare(`INSERT INTO visual_candidates (
      id, project_id, scene_id, origin, provider, provider_item_id, query, title, description, tags,
      preview_url, image_url, source_url, source_site, width, height, aspect_ratio, file_type, watermark,
      relevance_score, score_breakdown, license, rank, local_path, sha256, actual_width, actual_height, created_at, search_hash
    ) VALUES (?, ?, ?, 'SEARCH', 'wikimedia', 'river', 'river', 'River sunrise', '', '[]',
      'https://images.test/river.jpg', 'https://images.test/river.jpg', 'https://source.test/river', 'Test',
      1600, 900, 1.77, 'jpg', 'NONE', 1, ?, ?, 0, 'visuals/river.jpg', ?, 1600, 900, ?, 'hash')`).run(
      candidateId,
      project.id,
      sceneId,
      JSON.stringify({ keyword: 1, total: 1, lowRelevance: false }),
      license,
      "a".repeat(64),
      now,
    );
    sqlite.prepare(`INSERT INTO visual_selections (
      id, project_id, scene_id, slot, candidate_id, status, selected_by, created_at, updated_at
    ) VALUES (?, ?, ?, 0, ?, 'APPROVED', 'AGENT', ?, ?)`).run(selectionId, project.id, sceneId, candidateId, now, now);
    const visuals = new VisualService(sqlite, new JobRepository(sqlite, new PipelineEventBus()), config, app.log, {
      limiter: limiter(),
    });
    const missing = visuals.getProjectVisuals(project.id).scenes[0];
    expect(missing?.status).toBe("NEEDS_ATTENTION");
    expect(missing?.needsUser).toBe(true);
    expect(missing?.attentionReason).toBe("vision_missing");

    sqlite.prepare("UPDATE visual_selections SET selected_by = 'USER' WHERE id = ?").run(selectionId);
    const locked = visuals.getProjectVisuals(project.id).scenes[0];
    expect(locked?.status).toBe("READY_FOR_RENDER");
    expect(locked?.needsUser).toBe(false);

    sqlite.prepare("UPDATE visual_selections SET selected_by = 'AGENT' WHERE id = ?").run(selectionId);
    sqlite.prepare("UPDATE projects SET settings = ? WHERE id = ?").run(JSON.stringify({
      ...settings,
      budget: { mode: "ECO" },
    }), project.id);
    sqlite.prepare("UPDATE visual_candidates SET score_breakdown = ? WHERE id = ?").run(
      JSON.stringify({ keyword: 1, total: 1, lowRelevance: false, invalidSource: true }),
      candidateId,
    );
    const invalid = visuals.getProjectVisuals(project.id).scenes[0];
    expect(invalid?.attentionReason).toBe("invalid_source");
    expect(invalid?.status).not.toBe("READY_FOR_RENDER");
  });
});
