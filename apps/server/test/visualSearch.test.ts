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
import { StageError } from "../src/pipeline/stageExecutor.js";
import { HostDownloadRateLimiter, TokenBucketRateLimiter } from "../src/providers/images/rateLimiter.js";
import { ImageProviderBlockedError } from "../src/providers/images/http.js";
import { ImageStore } from "../src/services/imageStore.js";
import { getImageSourcesSettingsStatus } from "../src/settings/imageSources.js";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { StageContext } from "../src/pipeline/stageExecutor.js";
import type { VisualProvider } from "@vg/shared";
import { BraveImageProvider } from "../src/providers/images/brave.js";
import { runWithAutonomyBudget } from "../src/operator/autonomyBudget.js";

const root = mkdtempSync(join(tmpdir(), "vg-visual-search-"));
let dataDir: string;
let config: AppConfig;
let app: ReturnType<typeof buildApp>;
let sqlite: Database.Database;
let project: Project;
let sceneIds: string[];
let visuals: VisualService;

function noWaitLimiter() {
  return new TokenBucketRateLimiter(
    { mock: 60_000 },
    () => 0,
    async () => undefined,
  );
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
    payload: { topic: "Visual search fixture", settings: { budget: { mode: "ECO" } } },
  });
  project = created.json<Project>();
  sqlite = new Database(config.DATABASE_PATH);
  sceneIds = [randomUUID(), randomUUID()];
  const insertScene = sqlite.prepare(
    `INSERT INTO scenes (id, project_id, "order", kind, section_id, label, narration, visual_notes, visual_queries,
      music_mood, energy, est_duration_sec, duration_override_sec, start_sec, transition_note, origin, edited,
      input_hash, created_at, updated_at)
     VALUES (?, ?, ?, 'section', NULL, ?, 'A river at sunrise.', 'river sunrise', ?,
      '', 'medium', 4, NULL, ?, '', 'AGENT', 0, 'fixture', ?, ?)`,
  );
  const now = new Date().toISOString();
  sceneIds.forEach((id, order) => insertScene.run(
    id,
    project.id,
    order,
    `Scene ${order + 1}`,
    JSON.stringify({ primary: "shared river sunrise", alternatives: [], queryVariant: false }),
    order * 4,
    now,
    now,
  ));
  const repository = new JobRepository(sqlite, new PipelineEventBus());
  visuals = new VisualService(sqlite, repository, config, app.log, { limiter: noWaitLimiter() });
});

afterEach(async () => {
  sqlite.close();
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

function context(usage: Partial<{ llmCalls: number; inputTokens: number; outputTokens: number; features: Record<string, number> }>[]) {
  const timestamp = new Date().toISOString();
  const job: Job = {
    id: randomUUID(),
    projectId: project.id,
    stage: "VISUAL_SEARCH",
    scope: null,
    status: "RUNNING",
    progress: 0,
    message: null,
    attempt: 1,
    maxAttempts: 3,
    error: null,
    usage: null,
    createdAt: timestamp,
    startedAt: timestamp,
    finishedAt: null,
    runAfter: timestamp,
  };
  const value: StageContext = {
    project,
    job,
    signal: new AbortController().signal,
    reportProgress: () => undefined,
    recordUsage: (record) => usage.push(record),
    logger: app.log,
  };
  return value;
}

describe("visual search executor", () => {
  it.each(["normal", "warn", "stop"] as const)("gates optional web images in budget state %s", async (state) => {
    project = { ...project, settings: { ...project.settings, budget: { mode: "BALANCED" } } };
    sqlite.prepare("UPDATE projects SET settings = ? WHERE id = ?").run(JSON.stringify(project.settings), project.id);
    const enabledConfig = { ...config, BRAVE_SEARCH_API_KEY: "fixture-key" };
    const regular = vi.fn(async () => []);
    const web = vi.spyOn(BraveImageProvider.prototype, "search").mockResolvedValue([]);
    visuals = new VisualService(sqlite, new JobRepository(sqlite, new PipelineEventBus()), enabledConfig, app.log, {
      providers: [{ id: "mock", enabled: () => true, search: regular }], limiter: noWaitLimiter(),
    });
    try {
      await runWithAutonomyBudget(() => ({ state, retryAt: null }),
        () => visuals.executeStage(context([]), new LlmProviderRegistry(config)));
      expect(regular).toHaveBeenCalled();
      if (state === "normal") expect(web).toHaveBeenCalled();
      else expect(web).not.toHaveBeenCalled();
    } finally { web.mockRestore(); }
  });
  it("uses mock results, assigns distinct images, and skips unchanged scenes on rerun", async () => {
    const registry = new LlmProviderRegistry(config);
    const firstUsage: Parameters<StageContext["recordUsage"]>[0][] = [];
    const first = await visuals.executeStage(context(firstUsage), registry);
    const selections = visuals.getProjectVisuals(project.id).scenes.map((item) => item.selection);
    const selected = selections.map((selection) => visuals.getSceneVisuals(project.id, selection!.sceneId).candidates
      .find((candidate) => candidate.id === selection!.candidateId)!);
    expect(first.message).toContain("2 scenes ·");
    expect(selections.every(Boolean)).toBe(true);
    expect(selected[0].imageUrl).not.toBe(selected[1].imageUrl);
    expect(selected.every((candidate) => candidate.license.kind && candidate.license.evidence)).toBe(true);
    expect(firstUsage[0]).toMatchObject({
      llmCalls: 0,
      features: { imageProviderRequests: 1 },
    });

    const beforeRerun = visuals.getProjectVisuals(project.id).scenes.map((item) => item.selection);
    const repeatUsage: Parameters<StageContext["recordUsage"]>[0][] = [];
    const repeated = await visuals.executeStage(context(repeatUsage), registry);
    const afterRerun = visuals.getProjectVisuals(project.id).scenes.map((item) => item.selection);
    expect(repeated.message).toContain("LLM calls 0");
    expect(repeatUsage[0]).toMatchObject({
      llmCalls: 0,
      features: { imageProviderRequests: 0 },
    });
    expect(afterRerun).toEqual(beforeRerun);
  });

  it("preserves user selections on changed scenes and leaves unchanged scenes untouched", async () => {
    const registry = new LlmProviderRegistry(config);
    await visuals.executeStage(context([]), registry);
    const userSelectedCandidate = visuals.getSceneVisuals(project.id, sceneIds[0]).candidates[1];
    visuals.selectCandidate(project.id, sceneIds[0], userSelectedCandidate.id);
    const secondSelectionBefore = visuals.getProjectVisuals(project.id).scenes[1].selection;
    sqlite.prepare("UPDATE scenes SET visual_queries = ? WHERE id = ?").run(
      JSON.stringify({ primary: "different waterfall valley", alternatives: [], queryVariant: false }),
      sceneIds[0],
    );

    const usage: Parameters<StageContext["recordUsage"]>[0][] = [];
    await visuals.executeStage(context(usage), registry);
    const result = visuals.getProjectVisuals(project.id);
    expect(result.scenes[0].selection).toMatchObject({
      candidateId: userSelectedCandidate.id,
      selectedBy: "USER",
      status: "REPLACED",
    });
    const scene1 = result.scenes[1].selection!;
    expect(scene1.selectedBy).toBe("AGENT");
    if (scene1.candidateId === secondSelectionBefore!.candidateId) {
      expect(scene1).toEqual(secondSelectionBefore);
    } else {
      const stored = visuals.getSceneVisuals(project.id, sceneIds[1]).candidates;
      const previous = stored.find((item) => item.id === secondSelectionBefore!.candidateId);
      const next = stored.find((item) => item.id === scene1.candidateId);
      expect(next?.rank).toBeLessThan(previous?.rank ?? Number.POSITIVE_INFINITY);
    }
    expect(usage[0]?.features?.imageProviderRequests).toBeGreaterThan(0);
  });

  it("locks unchanged scene selections while assigning changed scenes", async () => {
    sqlite.prepare("UPDATE scenes SET visual_queries = ? WHERE id = ?").run(
      JSON.stringify({ primary: "scene one", alternatives: [], queryVariant: false }),
      sceneIds[0],
    );
    sqlite.prepare("UPDATE scenes SET visual_queries = ? WHERE id = ?").run(
      JSON.stringify({ primary: "scene two", alternatives: [], queryVariant: false }),
      sceneIds[1],
    );
    const result = (
      providerItemId: string,
      query: string,
      imageUrl = `https://images.test/${providerItemId}.jpg`,
    ): NormalizedImageResult => ({
      provider: "mock",
      providerItemId,
      title: `${query} photo`,
      description: "",
      tags: query.split(" "),
      previewUrl: imageUrl,
      imageUrl,
      sourceUrl: `https://source.test/${providerItemId}`,
      sourceSite: "Test provider",
      width: 1600,
      height: 900,
      fileType: "jpg",
      watermark: "NONE",
      license: {
        kind: "CC0",
        name: "CC0",
        url: null,
        author: "Test photographer",
        authorUrl: null,
        attributionRequired: false,
        attributionText: "",
        evidence: "api",
      },
    });
    const provider: ImageSearchProvider = {
      id: "mock",
      enabled: () => true,
      search: async ({ query }) => query.includes("scene two changed")
        ? [result("changed-alternate", query)]
        : query.includes("scene one")
          ? [result("shared", query), result("first-alternate", query)]
          : query.includes("scene two")
            ? [result("second-best", query), result("shared", query)]
            : [result("shared", query), result("changed-alternate", query)],
    };
    visuals = new VisualService(
      sqlite,
      new JobRepository(sqlite, new PipelineEventBus()),
      config,
      app.log,
      { providers: [provider], limiter: noWaitLimiter() },
    );
    const registry = new LlmProviderRegistry(config);
    await visuals.executeStage(context([]), registry);
    const keptSelection = visuals.getProjectVisuals(project.id).scenes[0].selection!;
    expect(visuals.getSceneVisuals(project.id, sceneIds[0]).candidates
      .find((candidate) => candidate.id === keptSelection.candidateId)?.providerItemId).toBe("shared");

    sqlite.prepare("UPDATE scenes SET visual_queries = ? WHERE id = ?").run(
      JSON.stringify({ primary: "scene two changed", alternatives: [], queryVariant: false }),
      sceneIds[1],
    );
    await visuals.executeStage(context([]), registry);
    const resultAfterChange = visuals.getProjectVisuals(project.id);
    expect(resultAfterChange.scenes[0].selection).toEqual(keptSelection);
    expect(visuals.getSceneVisuals(project.id, sceneIds[1]).candidates
      .find((candidate) => candidate.id === resultAfterChange.scenes[1].selection!.candidateId)?.providerItemId)
      .toBe("changed-alternate");
  });

  it("flags selected candidates without keyword matches and excludes Vietnamese notes from scoring", async () => {
    project = { ...project, settings: { ...project.settings, language: "vi" } };
    sqlite.prepare("UPDATE projects SET settings = ? WHERE id = ?").run(JSON.stringify(project.settings), project.id);
    sqlite.prepare("UPDATE scenes SET visual_queries = ?, visual_notes = ? WHERE id = ?").run(
      JSON.stringify({ primary: "Lee Sedol AlphaGo", alternatives: [], queryVariant: false }),
      "bản đồ Việt Nam",
      sceneIds[0],
    );
    sqlite.prepare("DELETE FROM scenes WHERE id = ?").run(sceneIds[1]);
    const irrelevantProvider: ImageSearchProvider = {
      id: "mock",
      enabled: () => true,
      search: async () => [{
        provider: "mock",
        providerItemId: "vietnam-map",
        title: "Bản đồ Việt Nam",
        description: "",
        tags: [],
        previewUrl: "https://images.test/vietnam-map.jpg",
        imageUrl: "https://images.test/vietnam-map-full.jpg",
        sourceUrl: "https://source.test/vietnam-map",
        sourceSite: "Test provider",
        width: 1920,
        height: 1080,
        fileType: "jpg",
        watermark: "NONE",
        license: {
          kind: "CC0",
          name: "CC0",
          url: null,
          author: "Test photographer",
          authorUrl: null,
          attributionRequired: false,
          attributionText: "",
          evidence: "api",
        },
      }],
    };
    visuals = new VisualService(
      sqlite,
      new JobRepository(sqlite, new PipelineEventBus()),
      config,
      app.log,
      { providers: [irrelevantProvider], limiter: noWaitLimiter() },
    );
    await visuals.executeStage(context([]), new LlmProviderRegistry(config));
    const response = await app.inject({ method: "GET", url: `/api/projects/${project.id}/visuals` });
    expect(response.statusCode).toBe(200);
    expect(response.json().scenes[0].selectedCandidate).toBeNull();
    expect(visuals.getSceneVisuals(project.id, sceneIds[0]).candidates[0]?.scoreBreakdown.lowRelevance).toBe(true);
  });

  it("strips query variants and uses code simplification without Vietnamese visual notes", async () => {
    project = { ...project, settings: { ...project.settings, language: "vi" } };
    sqlite.prepare("UPDATE projects SET settings = ? WHERE id = ?").run(JSON.stringify(project.settings), project.id);
    sqlite.prepare("UPDATE scenes SET visual_queries = ?, visual_notes = ? WHERE id = ?").run(
      JSON.stringify({
        primary: "AlphaGo Lee Sedol game 2 move 37 archival photo",
        alternatives: ["Seoul 2016 illustration"],
        queryVariant: true,
      }),
      "bản đồ Việt Nam",
      sceneIds[0],
    );
    sqlite.prepare("DELETE FROM scenes WHERE id = ?").run(sceneIds[1]);
    const queries: string[] = [];
    const emptyProvider: ImageSearchProvider = {
      id: "mock",
      enabled: () => true,
      search: async ({ query }) => {
        queries.push(query);
        return [];
      },
    };
    visuals = new VisualService(
      sqlite,
      new JobRepository(sqlite, new PipelineEventBus()),
      config,
      app.log,
      { providers: [emptyProvider], limiter: noWaitLimiter() },
    );
    await visuals.executeStage(context([]), new LlmProviderRegistry(config));
    expect(queries[0]).toBe("Visual search fixture AlphaGo Lee Sedol game 2 move 37");
    expect(queries.some((query) => query.includes("Seoul 2016"))).toBe(true);
    expect(queries.some((query) => query.includes("AlphaGo Lee Sedol"))).toBe(true);
    expect(queries.some((query) => /archival photo|illustration|bản đồ|Việt Nam/i.test(query))).toBe(false);
  });

  it("uses one batched assist only when code fallbacks return too few images and degrades on LLM failure", async () => {
    project = { ...project, settings: { ...project.settings, budget: { mode: "BALANCED" } } };
    sqlite.prepare("UPDATE projects SET settings = ? WHERE id = ?").run(JSON.stringify(project.settings), project.id);
    const emptyProvider: ImageSearchProvider = {
      id: "mock",
      enabled: () => true,
      search: async () => [],
    };
    visuals = new VisualService(
      sqlite,
      new JobRepository(sqlite, new PipelineEventBus()),
      config,
      app.log,
      { providers: [emptyProvider], limiter: noWaitLimiter() },
    );
    const usage: Parameters<StageContext["recordUsage"]>[0][] = [];
    const result = await visuals.executeStage(context(usage), new LlmProviderRegistry(config));
    expect(result.message).toContain("2 scenes · 0 relevant · 0 candidates");
    expect(usage[0]?.llmCalls).toBe(1);
    expect(visuals.getProjectVisuals(project.id).scenes.every((scene) => scene.needsUser)).toBe(true);
  });

  it("fails retryably only when every provider call fails from provider unavailability", async () => {
    const unavailableProvider: ImageSearchProvider = {
      id: "mock",
      enabled: () => true,
      search: async () => { throw new Error("provider offline"); },
    };
    visuals = new VisualService(
      sqlite,
      new JobRepository(sqlite, new PipelineEventBus()),
      config,
      app.log,
      { providers: [unavailableProvider], limiter: noWaitLimiter() },
    );
    await expect(visuals.executeStage(context([]), new LlmProviderRegistry(config)))
      .rejects.toMatchObject<Partial<StageError>>({ code: "IMAGE_SEARCH_UNAVAILABLE", retryable: true });
  });


  it("circuit-breaks a Cloudflare-blocked provider for the rest of the stage run", async () => {
    config = parseConfig({
      DATA_DIR: dataDir,
      DATABASE_PATH: join(dataDir, "app.db"),
      WORKER_ENABLED: "false",
      LOG_LEVEL: "silent",
      IMAGE_PROVIDERS: "loc,nasa",
      LLM_ENABLE_MOCK: "true",
      LLM_DEFAULT_PROVIDER: "mock",
    });
    // Distinct queries so cache does not collapse provider calls across scenes.
    const now = new Date().toISOString();
    sceneIds.forEach((id, order) => {
      sqlite.prepare("UPDATE scenes SET visual_queries = ?, updated_at = ? WHERE id = ?").run(
        JSON.stringify({
          primary: order === 0 ? "river sunrise landscape" : "mountain lake dusk",
          alternatives: [],
          queryVariant: false,
        }),
        now,
        id,
      );
    });
    let locCalls = 0;
    let nasaCalls = 0;
    const sample = (provider: VisualProvider, id: string): NormalizedImageResult => ({
      provider,
      providerItemId: id,
      title: `${provider} ${id}`,
      description: "river sunrise",
      tags: ["river", "sunrise"],
      previewUrl: `https://images.test/${provider}/${id}.jpg`,
      imageUrl: `https://images.test/${provider}/${id}-full.jpg`,
      sourceUrl: `https://source.test/${provider}/${id}`,
      sourceSite: provider,
      width: 1920,
      height: 1080,
      fileType: "jpg",
      watermark: "NONE",
      license: {
        kind: "CC0",
        name: "CC0",
        url: null,
        author: null,
        authorUrl: null,
        attributionRequired: false,
        attributionText: "",
        evidence: "api",
      },
    });
    const locProvider: ImageSearchProvider = {
      id: "loc",
      enabled: () => true,
      search: async () => {
        locCalls += 1;
        throw new ImageProviderBlockedError("Image provider blocked by Cloudflare (HTTP 403)", 403);
      },
    };
    const nasaProvider: ImageSearchProvider = {
      id: "nasa",
      enabled: () => true,
      search: async ({ query }) => {
        nasaCalls += 1;
        return [sample("nasa", query.slice(0, 24) || "river")];
      },
    };
    const limiter = new TokenBucketRateLimiter(
      { loc: 60_000, nasa: 60_000 },
      () => 0,
      async () => undefined,
    );
    visuals = new VisualService(
      sqlite,
      new JobRepository(sqlite, new PipelineEventBus()),
      config,
      app.log,
      { providers: [locProvider, nasaProvider], limiter },
    );
    const result = await visuals.executeStage(context([]), new LlmProviderRegistry(config));
    expect(locCalls).toBe(1);
    expect(nasaCalls).toBeGreaterThan(1);
    expect(result.message).toContain("loc: blocked (Cloudflare)");
    const status = getImageSourcesSettingsStatus(sqlite, config);
    expect(status.sources.find((row) => row.id === "loc")?.lastBlockedAt).toBeTruthy();
    expect(status.sources.find((row) => row.id === "loc")?.enabled).toBe(true);
  });

  it("approve-all keeps other scenes approved when one hits 429 and retries only that scene later", async () => {
    await visuals.executeStage(context([]), new LlmProviderRegistry(config));
    const png = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "images", "tiny.png"));
    const firstSelection = visuals.getProjectVisuals(project.id).scenes[0].selection!;
    const failingCandidate = visuals.getSceneVisuals(project.id, firstSelection.sceneId).candidates
      .find((candidate) => candidate.id === firstSelection.candidateId)!;
    let rateLimit = true;
    const fetchImpl = async (input: string | URL) => {
      if (rateLimit && String(input) === failingCandidate.imageUrl) {
        return new Response(null, { status: 429, headers: { "retry-after": "0" } });
      }
      return new Response(png, { status: 200, headers: { "content-type": "image/png" } });
    };
    const imageStore = new ImageStore(dataDir, "test-agent (https://example.test)", {
      fetchImpl: fetchImpl as typeof fetch,
      resolveHost: async () => ["203.0.113.10"],
      hostRateLimiter: new HostDownloadRateLimiter(0, Date.now, async () => undefined),
    });
    const repository = new JobRepository(sqlite, new PipelineEventBus());
    visuals = new VisualService(sqlite, repository, config, app.log, { limiter: noWaitLimiter(), imageStore });

    const first = await visuals.approveAll(project.id);
    expect(first.approved).toBe(1);
    expect(first.failed).toEqual([{
      sceneId: firstSelection.sceneId,
      reason: "Máy chủ ảnh đang giới hạn tốc độ (HTTP 429) — thử lại sau ít phút",
      retryable: true,
    }]);

    rateLimit = false;
    const second = await visuals.approveAll(project.id);
    expect(second).toEqual({ approved: 1, failed: [], skipped: 0, skipReasons: {} });
    expect(visuals.getProjectVisuals(project.id).scenes.every((scene) => scene.selection?.status === "APPROVED")).toBe(true);
  });

  it("raises one Cần bạn when web image search has no key and refuses a rendering project", async () => {
    const first = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/visuals/research`,
      payload: { reason: "low_relevance" },
    });
    const second = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/visuals/research`,
      payload: {},
    });
    expect(first.statusCode).toBe(200);
    expect(second.json().webSearch).toBe(false);
    const open = sqlite.prepare("SELECT COUNT(*) AS n FROM operator_requests WHERE dedupe_key = ? AND status = 'open'")
      .get(`visual-search:${project.id}`) as { n: number };
    expect(open.n).toBe(1);
    sqlite.prepare("UPDATE projects SET status = 'RENDERING' WHERE id = ?").run(project.id);
    const blocked = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/visuals/research`,
      payload: {},
    });
    expect(blocked.statusCode).toBe(409);
  });

  it("keeps finished scene searches across an abort and a rerun", async () => {
    sqlite.prepare("DELETE FROM scenes WHERE project_id = ?").run(project.id);
    const now = new Date().toISOString();
    const insertScene = sqlite.prepare(
      `INSERT INTO scenes (id, project_id, "order", kind, section_id, label, narration, visual_notes, visual_queries,
        music_mood, energy, est_duration_sec, duration_override_sec, start_sec, transition_note, origin, edited,
        input_hash, created_at, updated_at)
       VALUES (?, ?, ?, 'section', NULL, ?, 'narration', 'notes', ?, '', 'medium', 4, NULL, ?, '', 'AGENT', 0, 'fixture', ?, ?)`,
    );
    const ids = Array.from({ length: 6 }, () => randomUUID());
    ids.forEach((id, order) => insertScene.run(
      id, project.id, order, `Scene ${order + 1}`,
      JSON.stringify({ primary: `alpha${order}`, alternatives: [], queryVariant: false }),
      order * 4, now, now,
    ));
    const calls: string[] = [];
    const provider: ImageSearchProvider = {
      id: "mock",
      enabled: () => true,
      search: async ({ query }) => {
        calls.push(query);
        return Array.from({ length: 8 }, (_, index) => ({
          provider: "mock" as const,
          providerItemId: `${query}-${index}`,
          title: query,
          description: query,
          tags: [query],
          previewUrl: `https://img.example/${query}-${index}.jpg`,
          imageUrl: `https://img.example/${query}-${index}.jpg`,
          sourceUrl: `https://example.com/${query}-${index}`,
          sourceSite: "example.com",
          width: 1600,
          height: 900,
          fileType: "jpg",
          watermark: "NONE" as const,
          license: {
            kind: "CC0" as const,
            name: "CC0",
            url: null,
            author: null,
            authorUrl: null,
            attributionRequired: false,
            attributionText: "",
            evidence: "api" as const,
          },
        }));
      },
    };
    visuals = new VisualService(sqlite, new JobRepository(sqlite, new PipelineEventBus()), config, app.log, {
      providers: [provider], limiter: noWaitLimiter(),
    });
    const controller = new AbortController();
    const usage: Parameters<StageContext["recordUsage"]>[0][] = [];
    const stopped = context(usage);
    await expect(visuals.executeStage({
      ...stopped,
      signal: controller.signal,
      reportProgress: (_progress, message) => {
        if (String(message).includes("scene 4/")) controller.abort(new Error("stop after 4"));
      },
    }, new LlmProviderRegistry(config))).rejects.toThrow(/stop after 4/);
    const saved = sqlite.prepare("SELECT COUNT(*) AS n FROM visual_search_checkpoints WHERE project_id = ?")
      .get(project.id) as { n: number };
    expect(saved.n).toBe(4);
    expect(calls.some((query) => query.includes("alpha4") || query.includes("alpha5"))).toBe(false);

    calls.length = 0;
    const rerunUsage: Parameters<StageContext["recordUsage"]>[0][] = [];
    const finished = await visuals.executeStage(context(rerunUsage), new LlmProviderRegistry(config));
    expect(finished.message).toContain("dùng lại 4 cảnh đã tìm");
    expect(calls.every((query) => query.includes("alpha4") || query.includes("alpha5"))).toBe(true);
    expect(calls.length).toBeGreaterThan(0);
    const left = sqlite.prepare("SELECT COUNT(*) AS n FROM visual_search_checkpoints WHERE project_id = ?")
      .get(project.id) as { n: number };
    expect(left.n).toBe(0);
  });

  it("ignores a stale or mismatched checkpoint and keeps a user selection", async () => {
    sqlite.prepare("DELETE FROM scenes WHERE project_id = ?").run(project.id);
    const now = new Date().toISOString();
    const sceneId = randomUUID();
    const otherId = randomUUID();
    const insertScene = sqlite.prepare(
      `INSERT INTO scenes (id, project_id, "order", kind, section_id, label, narration, visual_notes, visual_queries,
        music_mood, energy, est_duration_sec, duration_override_sec, start_sec, transition_note, origin, edited,
        input_hash, created_at, updated_at)
       VALUES (?, ?, ?, 'section', NULL, 'Scene', 'narration', 'notes', ?, '', 'medium', 4, NULL, ?, '', 'AGENT', 0, 'fixture', ?, ?)`,
    );
    insertScene.run(sceneId, project.id, 0, JSON.stringify({ primary: "alpha0", alternatives: [], queryVariant: false }), 0, now, now);
    insertScene.run(otherId, project.id, 1, JSON.stringify({ primary: "alpha1", alternatives: [], queryVariant: false }), 4, now, now);
    const calls: string[] = [];
    const provider: ImageSearchProvider = {
      id: "mock",
      enabled: () => true,
      search: async ({ query }) => {
        calls.push(query);
        return [{
          provider: "mock" as const,
          providerItemId: `${query}-0`,
          title: query,
          description: query,
          tags: [query],
          previewUrl: "https://img.example/a.jpg",
          imageUrl: "https://img.example/a.jpg",
          sourceUrl: "https://example.com/a",
          sourceSite: "example.com",
          width: 1600,
          height: 900,
          fileType: "jpg",
          watermark: "NONE" as const,
          license: {
            kind: "CC0" as const, name: "CC0", url: null, author: null, authorUrl: null,
            attributionRequired: false, attributionText: "", evidence: "api" as const,
          },
        }];
      },
    };
    visuals = new VisualService(sqlite, new JobRepository(sqlite, new PipelineEventBus()), config, app.log, {
      providers: [provider], limiter: noWaitLimiter(),
    });
    const controller = new AbortController();
    await expect(visuals.executeStage({
      ...context([]),
      signal: controller.signal,
      reportProgress: (_progress, message) => {
        if (String(message).includes("scene 1/")) controller.abort(new Error("stop after 1"));
      },
    }, new LlmProviderRegistry(config))).rejects.toThrow(/stop after 1/);
    const row = sqlite.prepare("SELECT search_hash, queries, candidates FROM visual_search_checkpoints WHERE scene_id = ?")
      .get(sceneId) as { search_hash: string; queries: string; candidates: string };
    sqlite.prepare("UPDATE visual_search_checkpoints SET search_hash = ? WHERE scene_id = ?").run("different-hash", sceneId);
    sqlite.prepare("DELETE FROM image_search_cache").run();
    calls.length = 0;
    const mismatched = await visuals.executeStage(context([]), new LlmProviderRegistry(config));
    expect(mismatched.message).not.toContain("dùng lại");
    expect(calls.some((query) => query.includes("alpha0"))).toBe(true);

    sqlite.prepare("DELETE FROM visual_search_state WHERE scene_id = ?").run(sceneId);
    sqlite.prepare("DELETE FROM visual_search_checkpoints WHERE scene_id = ?").run(sceneId);
    sqlite.prepare(
      `INSERT INTO visual_search_checkpoints (scene_id, project_id, search_hash, queries, candidates, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(sceneId, project.id, row.search_hash, row.queries, row.candidates, new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString());
    sqlite.prepare("DELETE FROM image_search_cache").run();
    calls.length = 0;
    const stale = await visuals.executeStage(context([]), new LlmProviderRegistry(config));
    expect(stale.message).not.toContain("dùng lại");
    expect(calls.some((query) => query.includes("alpha0"))).toBe(true);

    const keptId = randomUUID();
    sqlite.prepare("DELETE FROM visual_search_state WHERE scene_id = ?").run(sceneId);
    sqlite.prepare("DELETE FROM visual_candidates WHERE scene_id = ?").run(sceneId);
    sqlite.prepare("DELETE FROM visual_selections WHERE scene_id = ?").run(sceneId);
    sqlite.prepare(
      `INSERT INTO visual_candidates (
        id, project_id, scene_id, origin, provider, provider_item_id, query, title, description, tags,
        preview_url, image_url, source_url, source_site, width, height, aspect_ratio, file_type, watermark,
        relevance_score, score_breakdown, license, rank, created_at, search_hash)
       VALUES (?, ?, ?, 'SEARCH', 'mock', 'kept', 'alpha0', 'alpha0', 'alpha0', '[]',
        'https://img.example/kept.jpg', 'https://img.example/kept.jpg', 'https://example.com/kept', 'example.com',
        1600, 900, 1.777, 'jpg', 'NONE', 1, '{}', ?, 0, ?, ?)`,
    ).run(keptId, project.id, sceneId, JSON.stringify({
      kind: "CC0", name: "CC0", url: null, author: null, authorUrl: null,
      attributionRequired: false, attributionText: "", evidence: "api",
    }), now, row.search_hash);
    sqlite.prepare(
      `INSERT INTO visual_selections (id, project_id, scene_id, slot, candidate_id, status, selected_by, created_at, updated_at)
       VALUES (?, ?, ?, 0, ?, 'APPROVED', 'USER', ?, ?)`,
    ).run(randomUUID(), project.id, sceneId, keptId, now, now);
    sqlite.prepare(
      `INSERT INTO visual_search_checkpoints (scene_id, project_id, search_hash, queries, candidates, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(scene_id) DO UPDATE SET search_hash = excluded.search_hash, queries = excluded.queries, candidates = excluded.candidates, created_at = excluded.created_at`,
    ).run(sceneId, project.id, row.search_hash, row.queries, row.candidates, new Date().toISOString());
    await visuals.executeStage(context([]), new LlmProviderRegistry(config));
    expect(visuals.getProjectVisuals(project.id).scenes[0]?.selection).toMatchObject({
      candidateId: keptId,
      selectedBy: "USER",
      status: "APPROVED",
    });
  });
});
