import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BraveImageProvider } from "../src/providers/images/brave.js";
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
import { VisualService } from "../src/services/visualService.js";
import { projectDir } from "../src/storage/paths.js";
import type { StageContext } from "../src/pipeline/stageExecutor.js";
import { buildClaudeArgs } from "../src/providers/llm/claudeCli.js";
import { buildCopilotArgs } from "../src/providers/llm/copilotCli.js";
import { buildAnthropicMessages } from "../src/providers/llm/anthropic.js";
import { mockVisionFit } from "../src/providers/llm/mock.js";
import Database from "better-sqlite3";

const root = mkdtempSync(join(tmpdir(), "vg-vision-max-"));
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
      topic: "Vision MAX fixture",
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

describe("TASK-004G MAX vision", () => {
  it("mock vision fit is deterministic from label", () => {
    expect(mockVisionFit("lowfit-x")).toBe(3);
    expect(mockVisionFit("highfit-y")).toBe(9);
    expect(mockVisionFit("same")).toBe(mockVisionFit("same"));
  });

  it("builds CLI vision args for copilot and claude", () => {
    const request = {
      model: "m",
      system: "sys",
      messages: [{ role: "user" as const, content: "hi" }],
      maxOutputTokens: 100,
      json: true,
      images: [{ path: "C:/tmp/a.jpg", label: "a" }, { path: "C:/tmp/b.jpg", label: "b" }],
    };
    expect(buildCopilotArgs(request, "C:/cwd")).toEqual(expect.arrayContaining([
      "--attachment", "C:/tmp/a.jpg", "--attachment", "C:/tmp/b.jpg",
    ]));
    expect(buildClaudeArgs(request)).toEqual(expect.arrayContaining([
      "--allowedTools", "Read", "--add-dir", "C:/tmp",
    ]));
    const claudeArgs = buildClaudeArgs(request);
    expect(claudeArgs[claudeArgs.indexOf("--max-turns") + 1]).toBe("4");
    expect(claudeArgs[claudeArgs.indexOf("--tools") + 1]).toBe("Read");
    expect(claudeArgs).toContain("--disallowedTools");
  });

  it("builds anthropic multimodal content when images are present", () => {
    const jpeg = join(dataDir, "tiny.jpg");
    writeFileSync(jpeg, Buffer.from(
      "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGfAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//Z",
      "base64",
    ));
    const messages = buildAnthropicMessages({
      model: "m",
      system: "sys",
      messages: [{ role: "user", content: "check" }],
      maxOutputTokens: 100,
      json: true,
      images: [{ path: jpeg, label: "img-1" }],
    });
    const content = (messages[0] as { content: unknown[] }).content;
    expect(content[0]).toMatchObject({ type: "image" });
  });

  it("runs vision verification, re-searches a low-fit scene, and records visionCheck", async () => {
    const usage: { calls?: Array<{ task: string }> } = {};
    await visuals.executeStage(stageContext({
      recordUsage: (payload) => {
        Object.assign(usage, payload);
      },
    }), llm);

    const projectVisuals = visuals.getProjectVisuals(project.id);
    expect(projectVisuals.scenes.some((scene) => scene.selectedCandidate?.visionCheck)).toBe(true);
    expect(usage.calls?.some((call) => call.task === "visionCheck")).toBe(true);

    const first = projectVisuals.scenes.find((scene) => scene.sceneId === sceneIds[0]);
    expect(first?.visionMeta?.reSearchHistory?.length ?? 0).toBeGreaterThan(0);
  });

  it("calls Brave once after vision rejects a scene", async () => {
    const enabled = { ...config, BRAVE_SEARCH_API_KEY: "fixture-key" };
    const web = vi.spyOn(BraveImageProvider.prototype, "search").mockResolvedValue([]);
    const service = new VisualService(
      sqlite,
      new JobRepository(sqlite, new PipelineEventBus()),
      enabled,
      app.log,
      {
        limiter: noWaitLimiter(),
        imageStore: new OfflineImageStore(dataDir, enabled.IMAGE_SEARCH_USER_AGENT),
      },
    );
    try {
      const result = await service.executeStage(stageContext(), llm);
      const rejects = result.message.split("vision_reject:").length - 1;
      expect(rejects).toBeGreaterThan(0);
      expect(web).toHaveBeenCalledTimes(rejects);
    } finally {
      web.mockRestore();
    }
  });

  it("fails fast with VISION_PROVIDER_REQUIRED when the vision route cannot accept images", async () => {
    const mock = llm.get("mock");
    expect(mock).toBeTruthy();
    mock!.capabilities = { vision: false, maxImagesPerCall: 0 };
    await expect(visuals.executeStage(stageContext(), llm)).rejects.toMatchObject({
      code: "VISION_PROVIDER_REQUIRED",
    });
  });

  it("exposes vision-check on the single-candidate route", async () => {
    await visuals.executeStage(stageContext(), llm);
    const scene = visuals.getSceneVisuals(project.id, sceneIds[1]!);
    const candidate = scene.candidates[0];
    expect(candidate).toBeTruthy();
    const relative = "visuals/vision-check.png";
    const absolute = join(projectDir(dataDir, project.id), relative);
    mkdirSync(join(absolute, ".."), { recursive: true });
    writeFileSync(absolute, solidPng(320, 320));
    sqlite.prepare("UPDATE visual_candidates SET local_path = ? WHERE id = ?").run(relative, candidate!.id);
    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/scenes/${sceneIds[1]}/visuals/${candidate!.id}/vision-check`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().candidate.visionCheck.fit).toBeTypeOf("number");
  });

  it("refuses a missing or undersized source instead of scoring a placeholder", async () => {
    await visuals.executeStage(stageContext(), llm);
    const candidate = visuals.getSceneVisuals(project.id, sceneIds[1]!).candidates[0]!;
    sqlite.prepare("UPDATE visual_candidates SET local_path = ? WHERE id = ?").run("visuals/missing.png", candidate.id);
    const missing = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/scenes/${sceneIds[1]}/visuals/${candidate.id}/vision-check`,
    });
    expect(missing.statusCode).toBe(422);
    expect(missing.json().error.code).toBe("VISION_SOURCE_MISSING");

    const relative = "visuals/tiny.png";
    const absolute = join(projectDir(dataDir, project.id), relative);
    mkdirSync(join(absolute, ".."), { recursive: true });
    writeFileSync(absolute, solidPng(32, 32));
    sqlite.prepare("UPDATE visual_candidates SET local_path = ? WHERE id = ?").run(relative, candidate.id);
    const invalid = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/scenes/${sceneIds[1]}/visuals/${candidate.id}/vision-check`,
    });
    expect(invalid.statusCode).toBe(422);
    expect(invalid.json().error.code).toBe("VISION_SOURCE_INVALID");
    const row = sqlite.prepare("SELECT score_breakdown FROM visual_candidates WHERE id = ?").get(candidate.id) as { score_breakdown: string };
    expect(JSON.parse(row.score_breakdown).invalidSource).toBe(true);
  });

  it("estimate endpoint includes MAX vision call counts", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/budget-estimate`,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      mode: string;
      features: { visionCheck: boolean };
      perStage: { stage: string; calls: { min: number; max: number } }[];
    };
    expect(body.mode).toBe("MAX");
    expect(body.features.visionCheck).toBe(true);
    expect(body.perStage.find((stage) => stage.stage === "VISUAL_SEARCH")?.calls.min).toBeGreaterThan(0);
  });
});
