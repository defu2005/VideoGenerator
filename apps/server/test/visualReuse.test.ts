import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import type { Project } from "@vg/shared";
import { buildApp } from "../src/app.js";
import { testActor } from "./testActor.js";
import { parseConfig, type AppConfig } from "../src/lib/config.js";
import { PipelineEventBus } from "../src/jobs/eventBus.js";
import { JobRepository } from "../src/jobs/jobRepository.js";
import { ImageStore, type StoredImage } from "../src/services/imageStore.js";
import { solidPng } from "./pngFixture.js";
import { LlmProviderRegistry } from "../src/providers/llm/registry.js";
import { TokenBucketRateLimiter } from "../src/providers/images/rateLimiter.js";
import { BraveImageProvider } from "../src/providers/images/brave.js";
import type { ImageSearchProvider, NormalizedImageResult } from "../src/providers/images/types.js";
import { VisualService } from "../src/services/visualService.js";
import { planSceneReuse, VISION_BATCH_SIZE } from "../src/services/visualReuse.js";
import type { StageContext } from "../src/pipeline/stageExecutor.js";
import type { LlmRequest, LlmResponse } from "../src/providers/llm/types.js";

describe("planSceneReuse (TASK-126)", () => {
  const base = {
    hashMatches: true,
    visionRequired: true,
    protectedSelection: false,
    hasValidSelection: false,
    topCandidatesVisionChecked: [false, false, false],
  };

  it("hash match + vision required + no vision on the top K → needsVerify", () => {
    expect(planSceneReuse(base)).toEqual({ reuseCandidates: true, needsVerify: true, skip: false });
  });

  it("hash match + valid selection → skip", () => {
    expect(planSceneReuse({ ...base, hasValidSelection: true })).toEqual({
      reuseCandidates: true, needsVerify: false, skip: true,
    });
  });

  it("vision not required → skip", () => {
    expect(planSceneReuse({ ...base, visionRequired: false })).toMatchObject({ needsVerify: false, skip: true });
  });

  it("protected selection → skip", () => {
    expect(planSceneReuse({ ...base, protectedSelection: true })).toMatchObject({ needsVerify: false, skip: true });
  });

  it("a vision result inside the top K → skip; one outside the top K does not count", () => {
    expect(planSceneReuse({ ...base, topCandidatesVisionChecked: [false, true] })).toMatchObject({ skip: true });
    const outside = [...Array(VISION_BATCH_SIZE).fill(false), true];
    expect(planSceneReuse({ ...base, topCandidatesVisionChecked: outside })).toMatchObject({ needsVerify: true });
  });

  it("hash mismatch → nothing reused, nothing skipped", () => {
    expect(planSceneReuse({ ...base, hashMatches: false })).toEqual({
      reuseCandidates: false, needsVerify: false, skip: false,
    });
  });
});

const root = mkdtempSync(join(tmpdir(), "vg-visual-reuse-"));
let dataDir: string;
let config: AppConfig;
let app: ReturnType<typeof buildApp>;
let sqlite: Database.Database;
let project: Project;
let sceneId: string;
let llm: LlmProviderRegistry;
let searchCalls: number;

function noWaitLimiter() {
  return new TokenBucketRateLimiter({ mock: 60_000, brave: 60_000 }, () => 0, async () => undefined);
}

class OfflineImageStore extends ImageStore {
  override async download(projectId: string, _url: string): Promise<StoredImage> {
    return this.storeBuffer(projectId, solidPng(320, 320));
  }
}

function result(provider: "mock" | "brave", id: string, licenseVerified?: boolean): NormalizedImageResult {
  return {
    provider,
    providerItemId: id,
    title: `river sunrise ${id}`,
    description: "documentary river sunrise",
    tags: ["river", "sunrise"],
    previewUrl: `https://img.example/${id}.jpg`,
    imageUrl: `https://img.example/${id}.jpg`,
    sourceUrl: `https://example.com/${id}`,
    sourceSite: "example.com",
    width: 1600,
    height: 900,
    fileType: "jpg",
    watermark: "NONE" as const,
    license: {
      kind: "CC0" as const, name: "CC0", url: null, author: null, authorUrl: null,
      attributionRequired: false, attributionText: "", evidence: "api" as const,
    },
    ...(licenseVerified === undefined ? {} : { licenseVerified }),
  } as NormalizedImageResult;
}

function provider(prefix: string): ImageSearchProvider {
  return {
    id: "mock",
    enabled: () => true,
    search: async () => {
      searchCalls += 1;
      return [0, 1, 2, 3, 4, 5].map((index) => result("mock", `${prefix}-${index}`));
    },
  };
}

function service(providerPrefix: string, overrides: Partial<AppConfig> = {}) {
  const effective = { ...config, ...overrides };
  return new VisualService(sqlite, new JobRepository(sqlite, new PipelineEventBus()), effective, app.log, {
    providers: [provider(providerPrefix)],
    limiter: noWaitLimiter(),
    imageStore: new OfflineImageStore(dataDir, effective.IMAGE_SEARCH_USER_AGENT),
  });
}

function stageContext(): StageContext {
  return {
    project,
    signal: new AbortController().signal,
    logger: app.log,
    reportProgress: () => undefined,
    recordUsage: () => undefined,
  } as StageContext;
}

function spyVision(handler?: (labels: string[]) => LlmResponse | null) {
  const mock = llm.get("mock")!;
  const original = mock.generate.bind(mock);
  return vi.spyOn(mock, "generate").mockImplementation(async (req: LlmRequest, signal: AbortSignal) => {
    if (req.schemaName === "VisionCheck" && handler) {
      const override = handler(req.images?.map((image) => image.label) ?? []);
      if (override) return override;
    }
    return original(req, signal);
  });
}

function visionCalls(spy: ReturnType<typeof spyVision>) {
  return spy.mock.calls.filter((call) => call[0].schemaName === "VisionCheck").length;
}

beforeEach(async () => {
  dataDir = join(root, `run-${randomUUID()}`);
  config = parseConfig({
    DATA_DIR: dataDir,
    DATABASE_PATH: join(dataDir, "app.db"),
    WORKER_ENABLED: "false",
    LOG_LEVEL: "silent",
    IMAGE_PROVIDERS: "mock",
    LLM_ENABLE_MOCK: "true",
    LLM_DEFAULT_PROVIDER: "mock",
  });
  app = buildApp({ testActor, config });
  const created = await app.inject({
    method: "POST",
    url: "/api/projects",
    payload: { topic: "Visual reuse fixture", mode: "AUTO", settings: { budget: { mode: "MAX" } } },
  });
  project = created.json<Project>();
  sqlite = new Database(config.DATABASE_PATH);
  sceneId = randomUUID();
  const now = new Date().toISOString();
  sqlite.prepare(
    `INSERT INTO scenes (id, project_id, "order", kind, section_id, label, narration, visual_notes, visual_description, visual_queries,
      music_mood, energy, est_duration_sec, duration_override_sec, start_sec, transition_note, origin, edited,
      input_hash, created_at, updated_at)
     VALUES (?, ?, 0, 'section', NULL, 'Scene 1', 'A river at sunrise.', 'river sunrise', 'documentary river sunrise', ?,
      '', 'medium', 4, NULL, 0, '', 'AGENT', 0, 'fixture', ?, ?)`,
  ).run(sceneId, project.id, JSON.stringify({ primary: "river sunrise", alternatives: [], queryVariant: false }), now, now);
  for (const stage of ["RESEARCH", "SCRIPT", "SCENE_PLAN"]) {
    sqlite.prepare("UPDATE project_stages SET state = 'DONE' WHERE project_id = ? AND stage = ?").run(project.id, stage);
  }
  llm = new LlmProviderRegistry(config);
  searchCalls = 0;
});

afterEach(async () => {
  vi.restoreAllMocks();
  await app.close();
  sqlite.close();
});

describe("TASK-126 VISUAL_SEARCH never skips vision", () => {
  it("verifies stored candidates with vision_check NULL and an unchanged hash, without a provider search", async () => {
    const visuals = service("highfit-a");
    const first = await visuals.executeStage(stageContext(), llm);
    expect(first.message).toMatch(/vision checked \d+ \(web 0\)/);
    expect(visuals.getProjectVisuals(project.id).scenes[0]?.selection).toBeTruthy();
    const hashBefore = sqlite.prepare("SELECT search_hash FROM visual_search_state WHERE scene_id = ?").get(sceneId);
    expect(hashBefore).toBeTruthy();

    // Berserk situation: candidates stored, hash unchanged, but no candidate was ever vision-checked.
    sqlite.prepare(
      "UPDATE visual_candidates SET vision_check = NULL, score_breakdown = json_remove(score_breakdown, '$.visionFit') WHERE scene_id = ?",
    ).run(sceneId);
    sqlite.prepare("DELETE FROM visual_selections WHERE scene_id = ?").run(sceneId);
    expect(visuals.getProjectVisuals(project.id).scenes[0]?.selection ?? null).toBeNull();
    // The LLM response cache would answer an identical vision prompt, so clear it to count real provider calls.
    sqlite.prepare("DELETE FROM llm_cache").run();

    searchCalls = 0;
    const spy = spyVision();
    const second = await visuals.executeStage(stageContext(), llm);
    expect(searchCalls).toBe(0);
    expect(visionCalls(spy)).toBeGreaterThan(0);
    const scene = visuals.getProjectVisuals(project.id).scenes[0]!;
    expect(scene.selection).toBeTruthy();
    expect(scene.selectedCandidate?.visionCheck?.fit).toBeGreaterThanOrEqual(7);
    expect(second.message).toMatch(/vision checked [1-9]\d* \(web 0\)/);
    expect(second.message).toContain("re-verified 1 scene");
  });

  it("still skips a scene whose selection is valid and checked", async () => {
    const visuals = service("highfit-b");
    await visuals.executeStage(stageContext(), llm);
    searchCalls = 0;
    const spy = spyVision();
    await visuals.executeStage(stageContext(), llm);
    expect(searchCalls).toBe(0);
    expect(visionCalls(spy)).toBe(0);
  });

  it("vision-checks Brave hits added after a vision reject and selects a passing one", async () => {
    const braveHit = result("brave", "highfit-web-0", true);
    const web = vi.spyOn(BraveImageProvider.prototype, "search").mockResolvedValue([braveHit]);
    const visuals = service("lowfit-stock", { BRAVE_SEARCH_API_KEY: "fixture-key" });
    const outcome = await visuals.executeStage(stageContext(), llm);
    expect(web).toHaveBeenCalledTimes(1);
    const scene = visuals.getProjectVisuals(project.id).scenes[0]!;
    expect(scene.selectedCandidate?.provider).toBe("brave");
    expect(scene.selectedCandidate?.providerItemId).toBe("highfit-web-0");
    expect(scene.selectedCandidate?.visionCheck?.fit).toBeGreaterThanOrEqual(7);
    expect(outcome.message).toMatch(/vision checked \d+ \(web 1\)/);
  });

  it("marks vision_unavailable and selects nothing when the web pass cannot be vision-checked", async () => {
    const braveHit = result("brave", "web-0", true);
    vi.spyOn(BraveImageProvider.prototype, "search").mockResolvedValue([braveHit]);
    spyVision((labels) => (labels.some((label) => label.startsWith("brave:"))
      ? {
        text: "broken",
        usage: { inputTokens: 1, outputTokens: 1 },
        model: "mock-v1",
        provider: "mock",
        finishReason: "stop",
      }
      : null));
    const visuals = service("lowfit-stock", { BRAVE_SEARCH_API_KEY: "fixture-key" });
    const outcome = await visuals.executeStage(stageContext(), llm);
    const detail = visuals.getSceneVisuals(project.id, sceneId);
    expect(detail.visionMeta?.needsAttention).toBe(true);
    expect(detail.visionMeta?.cause).toBe("vision_unavailable");
    expect(detail.selectedCandidate?.status === "NEEDS_ATTENTION" || detail.selectedCandidate == null).toBe(true);
    // The unchecked web image stays in the pool for Visual Review, but it was not auto-selected as a pass.
    const web = detail.candidates.find((candidate) => candidate.provider === "brave");
    expect(web).toBeTruthy();
    expect(web?.visionCheck ?? null).toBeNull();
    expect(outcome.message).toContain("vision_unavailable");
  });
});
