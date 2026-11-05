import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import type { Project } from "@vg/shared";
import { buildApp } from "../src/app.js";
import { parseConfig } from "../src/lib/config.js";

const root = mkdtempSync(join(tmpdir(), "vg-usage-test-"));
const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
});
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function createApp() {
  const dataDir = join(root, randomUUID());
  const config = parseConfig({
    DATA_DIR: dataDir,
    DATABASE_PATH: join(dataDir, "app.db"),
    WORKER_ENABLED: "false",
    LOG_LEVEL: "silent",
    USD_VND_RATE: "25000",
  });
  const app = buildApp({ config });
  apps.push(app);
  return { app, config };
}

function insertJob(
  databasePath: string,
  projectId: string,
  input: {
    stage: string;
    status: string;
    attempt: number;
    usage: Record<string, unknown>;
    date: string;
    scope?: string;
  },
) {
  const db = new Database(databasePath);
  try {
    const id = randomUUID();
    const startedAt = `${input.date}T10:00:00.000Z`;
    const finishedAt = `${input.date}T10:00:02.500Z`;
    db.prepare(`
      INSERT INTO jobs (id, project_id, stage, scope, status, progress, message, attempt, max_attempts,
        error, usage, created_at, started_at, finished_at, run_after, previous_state)
      VALUES (?, ?, ?, ?, ?, 0, NULL, ?, 3, NULL, ?, ?, ?, ?, ?, 'PENDING')
    `).run(
      id, projectId, input.stage, input.scope ?? null, input.status, input.attempt,
      JSON.stringify(input.usage), startedAt, startedAt, finishedAt, startedAt,
    );
    return id;
  } finally {
    db.close();
  }
}

describe("usage aggregation API", () => {
  it("counts failed and cancelled jobs, cache, fallback, unknown tokens, legacy jobs, and attempts", async () => {
    const { app, config } = createApp();
    const created = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { topic: "Usage aggregation" },
    });
    const project = created.json<Project>();

    insertJob(config.DATABASE_PATH, project.id, {
      stage: "VISUAL_SEARCH",
      status: "FAILED",
      attempt: 2,
      date: "2026-11-02",
      scope: "scene-1",
      usage: {
        llmCalls: 2, inputTokens: 12, outputTokens: 4, costUsd: 0.02,
        calls: [
          { task: "visualRerank", provider: "gemini", model: "gemini-fast", inputTokens: 7, outputTokens: 3, cached: false, fallback: true, ok: true },
          { task: "visualRerank", provider: "openai", model: "gpt-mini", inputTokens: 5, outputTokens: 1, cached: false, fallback: true, ok: false },
        ],
      },
    });
    insertJob(config.DATABASE_PATH, project.id, {
      stage: "VISUAL_SEARCH",
      status: "SUCCEEDED",
      attempt: 1,
      date: "2026-11-02",
      usage: {
        llmCalls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0,
        calls: [
          { task: "visualRerank", provider: "gemini", model: "gemini-fast", inputTokens: 100, outputTokens: 100, cached: true, fallback: false, ok: true },
        ],
      },
    });
    insertJob(config.DATABASE_PATH, project.id, {
      stage: "SCRIPT",
      status: "CANCELLED",
      attempt: 2,
      date: "2026-11-02",
      usage: { llmCalls: 2, inputTokens: 50, outputTokens: 10, costUsd: 0.1, provider: "openai", model: "gpt-legacy" },
    });
    insertJob(config.DATABASE_PATH, project.id, {
      stage: "RESEARCH",
      status: "SUCCEEDED",
      attempt: 1,
      date: "2026-11-03",
      usage: {
        llmCalls: 1, inputTokens: 0, outputTokens: 0, costUsd: 0.07,
        tokensUnknown: true,
        calls: [
          { task: "research", provider: "claude-cli", model: "sonnet", inputTokens: 0, outputTokens: 0, premiumRequests: 2, cached: false, fallback: false, ok: true },
        ],
      },
    });

    const response = await app.inject({ method: "GET", url: `/api/projects/${project.id}/usage` });
    expect(response.statusCode).toBe(200);
    const data = response.json();
    expect(data.totals).toMatchObject({
      llmCalls: 5,
      inputTokens: 62,
      outputTokens: 14,
      cachedCalls: 1,
      fallbackCalls: 2,
      failedCalls: 3,
      premiumRequests: 2,
      tokensUnknown: true,
    });
    expect(data.totals.costUsd).toBeCloseTo(0.12);
    expect(data.byStage).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "VISUAL_SEARCH", llmCalls: 2, cachedCalls: 1 }),
      expect.objectContaining({ key: "SCRIPT", llmCalls: 2, inputTokens: 50 }),
      expect.objectContaining({ key: "RESEARCH", tokensUnknown: true, premiumRequests: 2 }),
    ]));
    expect(data.byTask).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "visualRerank", llmCalls: 2, fallbackCalls: 2 }),
      expect.objectContaining({ key: "SCRIPT", llmCalls: 2 }),
    ]));
    expect(data.runs).toHaveLength(4);
    expect(data.runs.find((run: { attempt: number; status: string }) => run.attempt === 2 && run.status === "FAILED")).toMatchObject({
      stage: "VISUAL_SEARCH",
      scope: "scene-1",
      durationMs: 2500,
      tokens: { input: 12, output: 4, unknown: false },
      totals: { llmCalls: 2, fallbackCalls: 2, failedCalls: 1 },
    });
    expect(data.runs.find((run: { stage: string }) => run.stage === "SCRIPT")?.calls).toMatchObject([
      { task: "SCRIPT", provider: "openai", model: "gpt-legacy", callCount: 2, inputTokens: 50 },
    ]);

    const appUsage = await app.inject({
      method: "GET",
      url: "/api/usage?from=2026-11-03&to=2026-11-03&groupBy=provider",
    });
    expect(appUsage.statusCode).toBe(200);
    expect(appUsage.json()).toMatchObject({
      usdVndRate: 25000,
      totals: { llmCalls: 1, premiumRequests: 2, tokensUnknown: true },
      byGroup: [expect.objectContaining({ key: "claude-cli", llmCalls: 1 })],
    });
  });

  it("skips unreadable jobs and marks only the calls that reported no tokens", async () => {
    const { app, config } = createApp();
    const created = await app.inject({ method: "POST", url: "/api/projects", payload: { topic: "Mixed usage" } });
    const project = created.json<Project>();
    insertJob(config.DATABASE_PATH, project.id, {
      stage: "SCRIPT", status: "SUCCEEDED", attempt: 1, date: "2026-11-03",
      usage: { llmCalls: "two", inputTokens: 5 },
    });
    insertJob(config.DATABASE_PATH, project.id, {
      stage: "NOT_A_STAGE", status: "SUCCEEDED", attempt: 1, date: "2026-11-03",
      usage: { llmCalls: 1, inputTokens: 5, outputTokens: 1, costUsd: 0 },
    });
    insertJob(config.DATABASE_PATH, project.id, {
      stage: "RESEARCH", status: "SUCCEEDED", attempt: 1, date: "2026-11-03",
      usage: {
        llmCalls: 2, inputTokens: 30, outputTokens: 6, costUsd: 0, tokensUnknown: true,
        calls: [
          { task: "research", provider: "claude-cli", model: "sonnet", inputTokens: 30, outputTokens: 6, cached: false, fallback: false, ok: true },
          { task: "research", provider: "copilot-cli", model: "auto", inputTokens: 0, outputTokens: 0, cached: false, fallback: true, ok: true },
        ],
      },
    });

    const response = await app.inject({ method: "GET", url: `/api/projects/${project.id}/usage` });
    expect(response.statusCode).toBe(200);
    const data = response.json();
    expect(data.runs).toHaveLength(1);
    expect(data.runs[0].calls).toMatchObject([
      { provider: "claude-cli", tokensUnknown: false },
      { provider: "copilot-cli", tokensUnknown: true },
    ]);
    expect(data.byModel).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "claude-cli/sonnet", tokensUnknown: false }),
      expect.objectContaining({ key: "copilot-cli/auto", tokensUnknown: true }),
    ]));
  });

  it("returns empty aggregates for projects without usage and rejects reversed date ranges", async () => {
    const { app } = createApp();
    const created = await app.inject({ method: "POST", url: "/api/projects", payload: { topic: "No usage" } });
    const project = created.json<Project>();
    const response = await app.inject({ method: "GET", url: `/api/projects/${project.id}/usage` });
    expect(response.statusCode).toBe(200);
    expect(response.json().totals.llmCalls).toBe(0);

    const invalid = await app.inject({ method: "GET", url: "/api/usage?from=2026-11-04&to=2026-11-03" });
    expect(invalid.statusCode).toBe(400);
    const invalidDate = await app.inject({ method: "GET", url: "/api/usage?from=2026-11-31" });
    expect(invalidDate.statusCode).toBe(400);
  });

  it("keeps TTS character counts and the recorded cost on the provider line", async () => {
    const { app, config } = createApp();
    const created = await app.inject({ method: "POST", url: "/api/projects", payload: { topic: "TTS usage" } });
    const project = created.json<Project>();
    insertJob(config.DATABASE_PATH, project.id, {
      stage: "VOICE",
      status: "SUCCEEDED",
      attempt: 1,
      date: "2026-11-04",
      usage: {
        llmCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0.016,
        calls: [{
          task: "tts",
          provider: "google_cloud",
          model: "vi-VN-Neural2-A",
          inputTokens: 0,
          outputTokens: 0,
          cached: false,
          fallback: false,
          ok: true,
          characters: 1000,
          costUsd: 0.016,
        }],
      },
    });
    const response = await app.inject({ method: "GET", url: `/api/projects/${project.id}/usage` });
    expect(response.statusCode).toBe(200);
    expect(response.json().runs[0].calls[0]).toMatchObject({
      task: "tts",
      provider: "google_cloud",
      characters: 1000,
      costUsd: 0.016,
    });
  });
});
