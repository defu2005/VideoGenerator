import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { parseConfig, type AppConfig } from "../src/lib/config.js";
import {
  advisorCacheHash,
  buildAdvisorCatalog,
  buildAdvisorHealth,
  getCachedProposal,
  putCachedProposal,
  validateAdvisorRoutes,
  type AdvisorCatalogModel,
} from "../src/services/modelAdvisor.js";
import { LlmProviderRegistry } from "../src/providers/llm/registry.js";
import { openDatabase } from "../src/db/client.js";
import { migrateDatabase } from "../src/db/migrate.js";
import type { ModelAdvisorProposal } from "@vg/shared";

const root = mkdtempSync(join(tmpdir(), "vg-advisor-test-"));
let config: AppConfig;
let app: ReturnType<typeof buildApp>;

beforeAll(() => {
  config = parseConfig({
    DATA_DIR: join(root, "data"),
    DATABASE_PATH: join(root, "advisor.db"),
    PORT: "3001",
    HOST: "127.0.0.1",
    LOG_LEVEL: "silent",
    CORS_ORIGIN: "http://localhost:5173",
    LLM_DEFAULT_PROVIDER: "mock",
    LLM_ENABLE_MOCK: "true",
    WORKER_ENABLED: "false",
  });
});

beforeEach(() => {
  const dataDir = join(root, `data-${randomUUID()}`);
  config = {
    ...config,
    DATA_DIR: dataDir,
    DATABASE_PATH: join(dataDir, "app.db"),
  };
  app = buildApp({ config });
});

afterEach(async () => {
  await app.close();
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function catalogFixture(extra: AdvisorCatalogModel[] = []): AdvisorCatalogModel[] {
  return [
    { provider: "anthropic", model: "claude-sonnet", vision: true, subscription: false, pricing: { inputPerMTok: 3, outputPerMTok: 15 } },
    { provider: "gemini", model: "gemini-flash", vision: true, subscription: false },
    { provider: "gemini", model: "gemini-pro", vision: false, subscription: false },
    { provider: "mock", model: "mock-v1", vision: true, subscription: false },
    ...extra,
  ];
}

describe("model advisor catalog and validation", () => {
  it("builds catalog from configured providers and excludes unconfigured ones", () => {
    const registry = new LlmProviderRegistry(parseConfig({
      LLM_ENABLE_MOCK: "true",
      LLM_DEFAULT_PROVIDER: "mock",
      ANTHROPIC_API_KEY: "test-key",
    }));
    const catalog = buildAdvisorCatalog(registry, {
      mock: ["mock-v1"],
      anthropic: ["claude-sonnet"],
    });
    expect(catalog.some((row) => row.provider === "mock")).toBe(true);
    expect(catalog.some((row) => row.provider === "anthropic" && row.model === "claude-sonnet")).toBe(true);
    expect(catalog.some((row) => row.provider === "openai")).toBe(false);
  });

  it("aggregates health from jobs usage over the last 7 days", async () => {
    const { default: Database } = await import("better-sqlite3");
    const sqlite = new Database(":memory:");
    sqlite.exec("CREATE TABLE jobs (created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT, usage TEXT)");
    const now = new Date();
    sqlite.prepare(
      "INSERT INTO jobs (created_at, started_at, finished_at, usage) VALUES (?, ?, ?, ?)",
    ).run(
      now.toISOString(),
      new Date(now.getTime() - 1_000).toISOString(),
      now.toISOString(),
      JSON.stringify({
        llmCalls: 2,
        inputTokens: 10,
        outputTokens: 20,
        costUsd: 0,
        calls: [
          { task: "script", provider: "anthropic", model: "claude-sonnet", inputTokens: 5, outputTokens: 10, cached: false, fallback: false, ok: true },
          { task: "script", provider: "anthropic", model: "claude-sonnet", inputTokens: 5, outputTokens: 0, cached: false, fallback: false, ok: false },
        ],
      }),
    );
    const health = buildAdvisorHealth(sqlite, now);
    sqlite.close();
    expect(health).toEqual([
      expect.objectContaining({
        provider: "anthropic",
        model: "claude-sonnet",
        calls: 2,
        successRate: 0.5,
        parseFailures: 1,
      }),
    ]);
  });

  it("replaces invalid, non-vision, and mock picks unless mock is the only provider", () => {
    const current = {
      script: { provider: "anthropic", model: "claude-sonnet" },
      visionCheck: { provider: "gemini", model: "gemini-flash" },
      musicAssist: { provider: "gemini", model: "gemini-flash" },
    };
    const validated = validateAdvisorRoutes({
      routes: {
        script: { provider: "nope", model: "x", reason: "sai" },
        visionCheck: { provider: "gemini", model: "gemini-pro", reason: "không vision" },
        musicAssist: { provider: "mock", model: "mock-v1", reason: "mock" },
        metadata: { provider: "gemini", model: "gemini-flash", reason: "ổn" },
      },
      notes: "test",
    }, catalogFixture(), current);

    expect(validated.routes.script).toMatchObject({ provider: "anthropic", model: "claude-sonnet", reason: "giữ nguyên (đề xuất không hợp lệ)" });
    expect(validated.routes.visionCheck).toMatchObject({ provider: "gemini", model: "gemini-flash", reason: "giữ nguyên (đề xuất không hợp lệ)" });
    expect(validated.routes.musicAssist).toMatchObject({ provider: "gemini", model: "gemini-flash", reason: "giữ nguyên (đề xuất không hợp lệ)" });
    expect(validated.routes.metadata).toMatchObject({ provider: "gemini", model: "gemini-flash", reason: "ổn" });

    const onlyMock = validateAdvisorRoutes({
      routes: { script: { provider: "mock", model: "mock-v1", reason: "ok" } },
      notes: "mock only",
    }, [{ provider: "mock", model: "mock-v1", vision: true, subscription: false }], {});
    expect(onlyMock.routes.script).toMatchObject({ provider: "mock", model: "mock-v1" });
  });

  it("caches proposals by catalog/budget/language/health hash for 24h", () => {
    const dataDir = join(root, `cache-${randomUUID()}`);
    const database = openDatabase(join(dataDir, "app.db"));
    migrateDatabase(database.db, { info() {}, error() {} } as never, database.sqlite);
    const catalog = catalogFixture().filter((row) => row.provider !== "mock");
    const health = [{ provider: "anthropic", model: "claude-sonnet", calls: 2, successRate: 1, avgLatencyMs: 100, parseFailures: 0 }];
    const hash = advisorCacheHash({ catalog, budgetMode: "BALANCED", language: "vi", health });
    const proposal: ModelAdvisorProposal = {
      proposalId: "prop-1",
      scope: "app",
      budgetMode: "BALANCED",
      language: "vi",
      routes: { script: { provider: "anthropic", model: "claude-sonnet", reason: "mạnh" } },
      notes: "cached",
      diff: [],
      cached: false,
      createdAt: new Date().toISOString(),
    };
    putCachedProposal(database.sqlite, hash, proposal);
    expect(getCachedProposal(database.sqlite, hash)?.proposalId).toBe("prop-1");
    expect(getCachedProposal(database.sqlite, hash, Date.now() + 25 * 60 * 60 * 1000)).toBeUndefined();
    database.sqlite.close();
  });
});

describe("model advisor API", () => {
  it("proposes routes for app scope and applies selected task ids", async () => {
    const propose = await app.inject({
      method: "POST",
      url: "/api/llm/advisor/propose",
      payload: { scope: "app", budgetMode: "BALANCED" },
    });
    expect(propose.statusCode).toBe(200);
    const body = propose.json<ModelAdvisorProposal>();
    expect(body.proposalId).toBeTruthy();
    expect(body.cached).toBe(false);
    expect(body.diff.length).toBeGreaterThan(5);
    expect(body.routes.script?.provider).toBe("mock");

    const again = await app.inject({
      method: "POST",
      url: "/api/llm/advisor/propose",
      payload: { scope: "app", budgetMode: "BALANCED" },
    });
    expect(again.statusCode).toBe(200);
    expect(again.json<ModelAdvisorProposal>().cached).toBe(true);
    expect(again.json<ModelAdvisorProposal>().proposalId).toBe(body.proposalId);

    const apply = await app.inject({
      method: "POST",
      url: "/api/llm/advisor/apply",
      payload: {
        scope: "app",
        proposalId: body.proposalId,
        taskIds: ["script", "musicAssist"],
      },
    });
    expect(apply.statusCode).toBe(200);
    const applied = apply.json<{ applied: string[]; llm: { tasks?: Record<string, { provider: string }> } }>();
    expect(applied.applied).toEqual(["script", "musicAssist"]);
    expect(applied.llm.tasks?.script?.provider).toBe("mock");
    expect(applied.llm.tasks?.musicAssist?.provider).toBe("mock");
    expect(applied.llm.tasks?.metadata).toBeUndefined();

    const routing = await app.inject({ method: "GET", url: "/api/settings/llm-routing" });
    expect(routing.json()).toMatchObject({
      tasks: {
        script: { provider: "mock" },
        musicAssist: { provider: "mock" },
      },
    });
  });

  it("applies to profile and project scopes", async () => {
    const profileRes = await app.inject({
      method: "POST",
      url: "/api/profiles",
      payload: { name: `Advisor ${randomUUID().slice(0, 8)}`, language: "vi" },
    });
    expect(profileRes.statusCode).toBe(201);
    const profile = profileRes.json<{ id: string }>();

    const projectRes = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { topic: "Advisor project", mode: "ASSISTED" },
    });
    expect(projectRes.statusCode).toBe(201);
    const project = projectRes.json<{ id: string }>();

    const proposeProfile = await app.inject({
      method: "POST",
      url: "/api/llm/advisor/propose",
      payload: { scope: "profile", id: profile.id, budgetMode: "ECO" },
    });
    expect(proposeProfile.statusCode).toBe(200);
    const profileProposal = proposeProfile.json<ModelAdvisorProposal>();

    const applyProfile = await app.inject({
      method: "POST",
      url: "/api/llm/advisor/apply",
      payload: { scope: "profile", id: profile.id, proposalId: profileProposal.proposalId },
    });
    expect(applyProfile.statusCode).toBe(200);
    const profileGet = await app.inject({ method: "GET", url: `/api/profiles/${profile.id}` });
    expect(profileGet.json().llm?.tasks?.script?.provider).toBe("mock");
    expect(profileGet.json().llm?.autoModel).toBe(true);

    const proposeProject = await app.inject({
      method: "POST",
      url: "/api/llm/advisor/propose",
      payload: { scope: "project", id: project.id },
    });
    expect(proposeProject.statusCode).toBe(200);
    const projectProposal = proposeProject.json<ModelAdvisorProposal>();
    const applyProject = await app.inject({
      method: "POST",
      url: "/api/llm/advisor/apply",
      payload: {
        scope: "project",
        id: project.id,
        proposalId: projectProposal.proposalId,
        taskIds: ["metadata"],
      },
    });
    expect(applyProject.statusCode).toBe(200);
    const projectGet = await app.inject({ method: "GET", url: `/api/projects/${project.id}` });
    expect(projectGet.json().settings.llm?.tasks?.metadata?.provider).toBe("mock");
  });
});
