import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Project } from "@vg/shared";
import { buildApp } from "../src/app.js";
import { testActor } from "./testActor.js";
import { parseConfig, type AppConfig } from "../src/lib/config.js";

const root = mkdtempSync(join(tmpdir(), "vg-visuals-api-"));
const pngFixture = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "images", "tiny.png"));
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
  app = buildApp({ testActor,  config });
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

  it("uploads, validates, serves and approves a local image without networking", async () => {
    const bytes = pngFixture;
    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/scenes/${sceneId}/visuals/upload`,
      headers: { "content-type": "image/png", "x-file-name": "river.png" },
      payload: bytes,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      selection: { status: "CUSTOM", selectedBy: "USER" },
      status: "READY_FOR_RENDER",
      candidates: [{
        origin: "UPLOAD",
        license: { kind: "USER_PROVIDED", evidence: "user" },
        actualWidth: 640,
        actualHeight: 480,
      }],
    });
    const candidate = response.json().candidates[0];
    expect(candidate.localPath).toMatch(/^visuals\/[a-f0-9]{64}\.png$/);

    const file = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/visual-files/${candidate.localPath.split("/").at(-1)}`,
    });
    expect(file.statusCode).toBe(200);
    expect(file.headers["content-type"]).toBe("image/png");
    expect(file.headers["cache-control"]).toBe("private, max-age=86400");
    expect(file.rawPayload).toEqual(bytes);

    const traversal = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/visual-files/${encodeURIComponent("../app.db")}`,
    });
    expect(traversal.statusCode).toBe(404);
  });

  it("approves eligible local selections sequentially and invalidates only timeline onward", async () => {
    const uploaded = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/scenes/${sceneId}/visuals/upload`,
      headers: { "content-type": "image/png", "x-file-name": "river.png" },
      payload: pngFixture,
    });
    expect(uploaded.statusCode).toBe(200);
    sqlite.prepare(
      "UPDATE visual_selections SET status = 'DISCOVERED' WHERE project_id = ? AND scene_id = ?",
    ).run(project.id, sceneId);
    sqlite.prepare(
      "UPDATE project_stages SET state = 'DONE', progress = 100 WHERE project_id = ?",
    ).run(project.id);

    const result = await app.inject({ method: "POST", url: `/api/projects/${project.id}/visuals/approve-all` });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toEqual({ approved: 1, failed: [], skipped: 0, skipReasons: {} });
    expect(sqlite.prepare(
      "SELECT status FROM visual_selections WHERE project_id = ? AND scene_id = ?",
    ).get(project.id, sceneId)).toEqual({ status: "APPROVED" });
    const stages = sqlite.prepare(
      "SELECT stage, state FROM project_stages WHERE project_id = ?",
    ).all(project.id) as { stage: string; state: string }[];
    expect(stages.find((stage) => stage.stage === "SCRIPT")?.state).toBe("DONE");
    expect(stages.find((stage) => stage.stage === "VOICE")?.state).toBe("DONE");
    expect(stages.find((stage) => stage.stage === "MUSIC_SEARCH")?.state).toBe("DONE");
    expect(stages.find((stage) => stage.stage === "MUSIC_REVIEW")?.state).toBe("DONE");
    expect(stages.find((stage) => stage.stage === "TIMELINE")?.state).toBe("STALE");
    expect(stages.find((stage) => stage.stage === "RENDER")?.state).toBe("STALE");
  });

  it("supports edited queries and rejects a selected result in favor of a distinct candidate", async () => {
    const updated = await app.inject({
      method: "PATCH",
      url: `/api/projects/${project.id}/scenes/${sceneId}/visuals/query`,
      payload: {
        visualQueries: { primary: "edited river at sunrise", alternatives: ["sunrise river"] },
        visualDescription: "A broad river beneath a sunrise.",
      },
    });
    expect(updated.statusCode).toBe(200);
    const search = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/scenes/${sceneId}/visuals/search`,
      payload: { query: "edited river at sunrise", providers: ["mock"] },
    });
    expect(search.statusCode).toBe(200);
    const first = search.json().candidates[0];
    const selected = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/scenes/${sceneId}/visuals/select`,
      payload: { candidateId: first.id },
    });
    expect(selected.json().selection).toMatchObject({ candidateId: first.id, status: "REPLACED" });
    const rejected = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/scenes/${sceneId}/visuals/reject`,
    });
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json().selection).toMatchObject({ status: "REVIEW_REQUIRED", selectedBy: "AGENT" });
    expect(rejected.json().selection.candidateId).not.toBe(first.id);
  });

  it("rejects SSRF URLs, malformed uploads, wrong magic and oversized uploads", async () => {
    const ssrf = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/scenes/${sceneId}/visuals/custom-url`,
      payload: { url: "http://127.0.0.1/image.png" },
    });
    expect(ssrf.statusCode).toBe(422);
    expect(ssrf.json().error.message).toMatch(/private|loopback|link-local/);

    const wrongMagic = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/scenes/${sceneId}/visuals/upload`,
      headers: { "content-type": "image/png" },
      payload: Buffer.from("<html>not an image</html>"),
    });
    expect(wrongMagic.statusCode).toBe(422);

    const tooLarge = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/scenes/${sceneId}/visuals/upload`,
      headers: { "content-type": "image/png" },
      payload: Buffer.alloc(25 * 1024 * 1024 + 1),
    });
    expect(tooLarge.statusCode).toBe(413);
  });

  it("blocks visual mutations during jobs and refuses the review gate until all scenes are ready", async () => {
    const now = new Date().toISOString();
    sqlite.prepare(
      `INSERT INTO jobs (id, project_id, stage, status, progress, attempt, max_attempts, created_at, run_after, previous_state)
       VALUES (?, ?, 'VISUAL_SEARCH', 'RUNNING', 0, 1, 3, ?, ?, 'PENDING')`,
    ).run(randomUUID(), project.id, now, now);
    const blocked = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/scenes/${sceneId}/visuals/remove`,
    });
    expect(blocked.statusCode).toBe(409);
    sqlite.prepare("UPDATE jobs SET status = 'SUCCEEDED'").run();

    await app.inject({ method: "GET", url: `/api/projects/${project.id}/pipeline` });
    sqlite.prepare(
      "UPDATE project_stages SET state = 'WAITING_USER' WHERE project_id = ? AND stage = 'VISUAL_REVIEW'",
    ).run(project.id);
    const rejected = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/pipeline/gates/VISUAL_REVIEW/approve`,
    });
    expect(rejected.statusCode).toBe(409);
    expect(rejected.json().error.message).toContain("1 cảnh");
    await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/scenes/${sceneId}/visuals/remove`,
    });
    const allowed = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/pipeline/gates/VISUAL_REVIEW/approve`,
    });
    expect(allowed.statusCode).toBe(200);
  });
});
