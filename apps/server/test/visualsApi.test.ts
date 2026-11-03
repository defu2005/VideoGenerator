import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Project } from "@vg/shared";
import { buildApp } from "../src/app.js";
import { parseConfig, type AppConfig } from "../src/lib/config.js";

const root = mkdtempSync(join(tmpdir(), "vg-visuals-api-"));
let dataDir: string;
let config: AppConfig;
let app: ReturnType<typeof buildApp>;
let project: Project;
let sceneId: string;
let sqlite: Database.Database;

beforeEach(async () => {
  dataDir = join(root, `run-${randomUUID()}`);
  config = parseConfig({
    DATA_DIR: dataDir,
    DATABASE_PATH: join(dataDir, "app.db"),
    WORKER_ENABLED: "false",
    LOG_LEVEL: "silent",
    IMAGE_PROVIDERS: "mock",
  });
  app = buildApp({ config });
  const created = await app.inject({
    method: "POST",
    url: "/api/projects",
    payload: { topic: "Visual API fixture", settings: { budget: { mode: "ECO" } } },
  });
  expect(created.statusCode).toBe(201);
  project = created.json<Project>();
  sceneId = randomUUID();
  sqlite = new Database(config.DATABASE_PATH);
  const now = new Date().toISOString();
  sqlite.prepare(
    `INSERT INTO scenes (id, project_id, "order", kind, section_id, label, narration, visual_notes, visual_queries,
      music_mood, energy, est_duration_sec, duration_override_sec, start_sec, transition_note, origin, edited,
      input_hash, created_at, updated_at)
     VALUES (?, ?, 0, 'section', NULL, 'Fixture scene', 'A river at sunrise.', 'river sunrise',
      ?, '', 'medium', 4, NULL, 0, '', 'AGENT', 0, 'fixture', ?, ?)`,
  ).run(sceneId, project.id, JSON.stringify({ primary: "river sunrise", alternatives: [], queryVariant: false }), now, now);
});

afterEach(async () => {
  sqlite.close();
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("visual API", () => {
  it("searches through the mock provider, caches repeats, and supports user selection", async () => {
    const empty = await app.inject({ method: "GET", url: `/api/projects/${project.id}/visuals` });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toMatchObject({
      summary: { withImage: 0, needsUser: 1, lowRelevance: 0 },
      scenes: [{ sceneId, needsUser: true, lowRelevance: false }],
    });

    const first = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/scenes/${sceneId}/visuals/search`,
      payload: { query: "river sunrise", providers: ["mock"] },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().candidates.length).toBeGreaterThan(0);
    expect(first.json().usage).toEqual({ providerRequests: 1, cacheHits: 0 });

    const repeated = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/scenes/${sceneId}/visuals/search`,
      payload: { query: "river sunrise", providers: ["mock"] },
    });
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json().usage).toEqual({ providerRequests: 0, cacheHits: 1 });

    const candidateId = first.json().candidates[0].id as string;
    const selected = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/scenes/${sceneId}/visuals/select`,
      payload: { candidateId },
    });
    expect(selected.statusCode).toBe(200);
    expect(selected.json().selection).toMatchObject({ candidateId, status: "REPLACED", selectedBy: "USER" });
  });

  it("validates manual searches and returns 409 during an active job", async () => {
    const invalid = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/scenes/${sceneId}/visuals/search`,
      payload: { query: "  " },
    });
    expect(invalid.statusCode).toBe(400);

    sqlite.prepare(
      `INSERT INTO jobs (id, project_id, stage, status, progress, attempt, max_attempts, created_at, run_after, previous_state)
       VALUES (?, ?, 'RESEARCH', 'RUNNING', 0, 1, 3, ?, ?, 'PENDING')`,
    ).run(randomUUID(), project.id, new Date().toISOString(), new Date().toISOString());
    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/scenes/${sceneId}/visuals/search`,
      payload: { query: "river", providers: ["mock"] },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("JOB_ACTIVE");
  });
});
