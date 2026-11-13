import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import type { Project } from "@vg/shared";
import { VisionCheckBatchSchema, normalizeVisionCheckBatch } from "@vg/shared";
import { buildApp } from "../src/app.js";
import { testActor } from "./testActor.js";
import { parseConfig, type AppConfig } from "../src/lib/config.js";
import { PipelineEventBus } from "../src/jobs/eventBus.js";
import { JobRepository } from "../src/jobs/jobRepository.js";
import { ImageStore, type StoredImage } from "../src/services/imageStore.js";
import { solidPng } from "./pngFixture.js";
import { LlmProviderRegistry } from "../src/providers/llm/registry.js";
import { LlmCache } from "../src/providers/llm/cache.js";
import { generateStructured } from "../src/providers/llm/structured.js";
import { TokenBucketRateLimiter } from "../src/providers/images/rateLimiter.js";
import { VisualService } from "../src/services/visualService.js";
import type { StageContext } from "../src/pipeline/stageExecutor.js";
import { LlmError } from "../src/providers/llm/types.js";
import type { LlmRequest, LlmResponse } from "../src/providers/llm/types.js";

const root = mkdtempSync(join(tmpdir(), "vg-vision-schema-"));
let dataDir: string;
let config: AppConfig;
let app: ReturnType<typeof buildApp>;
let sqlite: Database.Database;
let project: Project;
let sceneIds: string[];
let visuals: VisualService;
let llm: LlmProviderRegistry;

function noWaitLimiter() {
  return new TokenBucketRateLimiter({ mock: 60_000 }, () => 0, async () => undefined);
}

class OfflineImageStore extends ImageStore {
  override async download(projectId: string, _url: string): Promise<StoredImage> {
    return this.storeBuffer(projectId, solidPng(320, 320));
  }
}

function stageContext(overrides: Partial<StageContext> = {}): StageContext {
  return {
    project,
    signal: new AbortController().signal,
    logger: app.log,
    reportProgress: () => undefined,
    recordUsage: () => undefined,
    ...overrides,
  } as StageContext;
}

function visionBatchText(labels: string[], issue?: string) {
  return JSON.stringify({
    images: labels.map((label) => ({
      label,
      fit: 8,
      depicts: `Scene for ${label}`,
      issues: issue ? [issue] : [],
      cropOk: true,
    })),
  });
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
  app = buildApp({ testActor,  config });
  const created = await app.inject({
    method: "POST",
    url: "/api/projects",
    payload: {
      topic: "Vision schema fixture",
      mode: "AUTO",
      settings: { budget: { mode: "MAX" } },
    },
  });
  project = created.json<Project>();
  sqlite = new Database(config.DATABASE_PATH);
  sceneIds = [randomUUID(), randomUUID()];
  const insertScene = sqlite.prepare(
    `INSERT INTO scenes (id, project_id, "order", kind, section_id, label, narration, visual_notes, visual_description, visual_queries,
      music_mood, energy, est_duration_sec, duration_override_sec, start_sec, transition_note, origin, edited,
      input_hash, created_at, updated_at)
     VALUES (?, ?, ?, 'section', NULL, ?, 'A river at sunrise.', 'river sunrise', 'documentary river sunrise', ?,
      '', 'medium', 4, NULL, ?, '', 'AGENT', 0, 'fixture', ?, ?)`,
  );
  const now = new Date().toISOString();
  sceneIds.forEach((id, order) => insertScene.run(
    id,
    project.id,
    order,
    order === 0 ? "force-lowfit Scene 1" : `Scene ${order + 1}`,
    JSON.stringify({ primary: `river sunrise ${order}`, alternatives: [], queryVariant: false }),
    order * 4,
    now,
    now,
  ));
  for (const stage of ["RESEARCH", "SCRIPT", "SCENE_PLAN"]) {
    sqlite.prepare("UPDATE project_stages SET state = 'DONE' WHERE project_id = ? AND stage = ?").run(project.id, stage);
  }
  const repository = new JobRepository(sqlite, new PipelineEventBus());
  visuals = new VisualService(sqlite, repository, config, app.log, {
    limiter: noWaitLimiter(),
    imageStore: new OfflineImageStore(dataDir, config.IMAGE_SEARCH_USER_AGENT),
  });
  llm = new LlmProviderRegistry(config);
});

afterEach(async () => {
  await app.close();
  sqlite.close();
});

describe("BUGFIX-VISION-SCHEMA", () => {
  it("parses blurry/fan_art with normalize and skips repair", async () => {
    const provider = llm.get("mock")!;
    const original = provider.generate.bind(provider);
    const spy = vi.spyOn(provider, "generate").mockImplementation(async (req: LlmRequest, signal: AbortSignal): Promise<LlmResponse> => {
      if (req.schemaName !== "VisionCheck") {
        return original(req, signal);
      }
      const labels = req.images?.map((image) => image.label) ?? ["img"];
      return {
        text: JSON.stringify({
          images: labels.map((label) => ({
            label,
            fit: 8,
            depicts: "ok",
            issues: ["blurry", "fan_art"],
            cropOk: true,
            reason: "noise",
          })),
        }),
        usage: { inputTokens: 2, outputTokens: 3 },
        model: "mock-v1",
        provider: "mock",
        finishReason: "stop",
      };
    });
  try {
    const result = await visuals.executeStage(stageContext(), llm);
    expect(result.message).not.toContain("FAILED");
    expect(spy).toHaveBeenCalled();
    const visionCalls = spy.mock.calls.filter((call) => call[0].schemaName === "VisionCheck");
    expect(visionCalls.length).toBeGreaterThan(0);
    expect(visionCalls.every((call) => call[0].messages.length === 1)).toBe(true);
    const projectVisuals = visuals.getProjectVisuals(project.id);
    const checked = projectVisuals.scenes
      .map((scene) => scene.selectedCandidate)
      .find((candidate) => candidate?.visionCheck?.issues.includes("low_quality"));
    expect(checked).toBeTruthy();
  } finally {
    spy.mockRestore();
  }
  });

  it("falls back to single-image vision calls after batch parse fails", async () => {
    const provider = llm.get("mock")!;
    const original = provider.generate.bind(provider);
    const spy = vi.spyOn(provider, "generate").mockImplementation(async (req: LlmRequest, signal: AbortSignal): Promise<LlmResponse> => {
      if (req.schemaName !== "VisionCheck") {
        return original(req, signal);
      }
      if ((req.images?.length ?? 0) > 1) return {
        text: "not-json",
        usage: { inputTokens: 1, outputTokens: 1 },
        model: "mock-v1",
        provider: "mock",
        finishReason: "stop",
      };
      const label = req.images?.[0]?.label ?? "img";
      return {
        text: visionBatchText([label]),
        usage: { inputTokens: 1, outputTokens: 1 },
        model: "mock-v1",
        provider: "mock",
        finishReason: "stop",
      };
    });
    try {
      await visuals.executeStage(stageContext(), llm);
      const visionCalls = spy.mock.calls.filter((call) => call[0].schemaName === "VisionCheck");
      const batchCalls = visionCalls.filter((call) => (call[0].images?.length ?? 0) > 1);
      const singleCalls = visionCalls.filter((call) => (call[0].images?.length ?? 0) === 1);
      expect(batchCalls.length).toBeGreaterThan(0);
      expect(singleCalls.length).toBeGreaterThanOrEqual(3);
      expect(visuals.getProjectVisuals(project.id).scenes.some((scene) => scene.selectedCandidate?.visionCheck)).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("finishes the stage when all vision parses fail and marks vision_missing", async () => {
    const provider = llm.get("mock")!;
    const original = provider.generate.bind(provider);
    vi.spyOn(provider, "generate").mockImplementation(async (req: LlmRequest, signal: AbortSignal): Promise<LlmResponse> => {
      if (req.schemaName === "VisionCheck") {
        return {
          text: "broken",
          usage: { inputTokens: 1, outputTokens: 1 },
          model: "mock-v1",
          provider: "mock",
          finishReason: "stop",
        };
      }
      return original(req, signal);
    });
    const result = await visuals.executeStage(stageContext(), llm);
    expect(result.message).toContain("Vision:");
    expect(result.message).toContain("không đọc được kết quả");
    const lowfit = visuals.getSceneVisuals(project.id, sceneIds[0]!);
    expect(lowfit.visionMeta?.reSearchHistory?.length ?? 0).toBe(0);
    const status = lowfit.selectedCandidate?.status;
    expect(status === "NEEDS_ATTENTION" || lowfit.selectedCandidate == null).toBe(true);
  });

  it("still fails the stage on LLM_AUTH", async () => {
    const provider = llm.get("mock")!;
    const original = provider.generate.bind(provider);
    vi.spyOn(provider, "generate").mockImplementation(async (req: LlmRequest, signal: AbortSignal): Promise<LlmResponse> => {
      if (req.schemaName === "VisionCheck") {
        throw new LlmError("Vision auth failed", "LLM_AUTH", false);
      }
      return original(req, signal);
    });
    await expect(visuals.executeStage(stageContext(), llm)).rejects.toMatchObject({ code: "LLM_AUTH" });
  });

  it("parses cached raw vision output through normalize", async () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE llm_cache (key TEXT PRIMARY KEY, provider TEXT NOT NULL, model TEXT NOT NULL, response_text TEXT NOT NULL, created_at TEXT NOT NULL)");
    const cache = new LlmCache(db, true);
    const schema = VisionCheckBatchSchema;
    const provider = llm.get("mock")!;
    const generate = vi.fn(async () => ({
      text: JSON.stringify({
        images: [{
          label: "a",
          fit: 7,
          depicts: "ok",
          issues: ["blurry"],
          cropOk: true,
        }],
      }),
      usage: { inputTokens: 2, outputTokens: 3 },
      model: "mock-v1",
      provider: "mock",
      finishReason: "stop" as const,
    }));
    provider.generate = generate;
    const request = {
      provider,
      model: "mock-v1",
      system: "sys",
      prompt: "prompt",
      schema,
      schemaName: "VisionCheck",
      schemaVersion: "cache-fixture",
      maxOutputTokens: 500,
      signal: new AbortController().signal,
      cache,
      repairAttempts: 0 as const,
      normalize: (value: unknown) => normalizeVisionCheckBatch(value).value,
    };
    const result = await generateStructured(request);
    expect(result.value.images[0]?.issues).toEqual(["low_quality"]);
    expect(generate).toHaveBeenCalledTimes(1);
    const cached = await generateStructured(request);
    expect(cached.cached).toBe(true);
    expect(cached.value.images[0]?.issues).toEqual(["low_quality"]);
    expect(generate).toHaveBeenCalledTimes(1);
    db.close();
  });
});
