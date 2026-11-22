import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Project } from "@vg/shared";
import { buildApp } from "../src/app.js";
import { testActor } from "./testActor.js";
import { parseConfig, type AppConfig } from "../src/lib/config.js";

// TASK-146 outline editing over HTTP (commit A): only centralQuestion and beat concreteMoment change, and only while the outline is parked.
// Written, not run (no-test rule in force).

const root = mkdtempSync(join(tmpdir(), "vg-task146-edit-test-"));
let config: AppConfig;
let app: ReturnType<typeof buildApp>;

beforeAll(() => {
  config = parseConfig({ DATA_DIR: root, DATABASE_PATH: join(root, "boot.db"), WORKER_ENABLED: "false", LOG_LEVEL: "silent", HOST: "127.0.0.1" });
});
beforeEach(() => {
  const dataDir = join(root, `run-${randomUUID()}`);
  config = { ...config, DATA_DIR: dataDir, DATABASE_PATH: join(dataDir, "app.db") };
  app = buildApp({ testActor, config });
});
afterEach(async () => {
  await app.close();
});
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const HOOK_CANDIDATES = '{"candidates":[],"chosenHookId":null,"hookAssessments":[]}';

const OUTLINE = {
  centralQuestion: "Vì sao vũ trụ giãn nở?",
  promise: "Lời hứa gốc",
  framework: "three_act",
  surprises: [
    { fact: "Sự thật một", factIds: ["f1"] },
    { fact: "Sự thật hai", factIds: ["f2"] },
  ],
  beats: [
    {
      id: "b1", sectionKey: "hook", purpose: "hook", emotion: "curious", concreteMoment: "Khoảnh khắc gốc một",
      newInformation: "Thông tin một", opensLoops: [], closesLoops: [], factIds: ["f1"], visualIntent: "Ý hình một", targetSec: 10,
    },
    {
      id: "b2", sectionKey: "evidence", purpose: "evidence", emotion: "awe", concreteMoment: "Khoảnh khắc gốc hai",
      newInformation: "Thông tin hai", opensLoops: [], closesLoops: [], factIds: ["f2"], visualIntent: "Ý hình hai", targetSec: 12,
    },
  ],
  loops: [],
  setupPayoffs: [],
};

// A project whose SCRIPT stage is parked on the outline: stage WAITING_USER, draft phase as given.
async function parkWith(outline: unknown, phase: string = "outline_ready") {
  const project = (await app.inject({ method: "POST", url: "/api/projects", payload: { title: "Outline edit", topic: "Outline" } })).json<Project>();
  const sqlite = new Database(config.DATABASE_PATH);
  const now = new Date().toISOString();
  sqlite.prepare("INSERT OR REPLACE INTO project_stages (project_id, stage, state, progress, updated_at) VALUES (?, 'SCRIPT', 'WAITING_USER', 0, ?)").run(project.id, now);
  sqlite.prepare("UPDATE projects SET status = 'REVIEW', stage = 'SCRIPT', run_mode = NULL WHERE id = ?").run(project.id);
  sqlite.prepare(
    `INSERT INTO script_drafts (project_id, outline, hook_candidates, critique, critique_history, engine_mode, input_hash, updated_at, phase)
     VALUES (?, ?, ?, NULL, NULL, 'off', 'edit-hash', ?, ?)`,
  ).run(project.id, JSON.stringify(outline), HOOK_CANDIDATES, now, phase);
  return { project, sqlite };
}

const editUrl = (projectId: string) => `/api/projects/${projectId}/script/outline`;

function draftRow(sqlite: Database.Database, projectId: string) {
  return sqlite.prepare("SELECT outline, phase, hook_candidates, input_hash FROM script_drafts WHERE project_id = ?").get(projectId) as {
    outline: string;
    phase: string;
    hook_candidates: string;
    input_hash: string;
  };
}

describe("TASK-146 outline editing over HTTP", () => {
  it("changes only centralQuestion and the named beat's concreteMoment; phase, hook candidates and input hash stay", async () => {
    const { project, sqlite } = await parkWith(OUTLINE);
    const before = draftRow(sqlite, project.id);

    const response = await app.inject({
      method: "POST",
      url: editUrl(project.id),
      payload: { centralQuestion: "Câu hỏi mới?", beats: [{ id: "b2", concreteMoment: "Khoảnh khắc sửa" }] },
    });
    expect({ status: response.statusCode, body: response.body }).toMatchObject({ status: 200 });

    const after = draftRow(sqlite, project.id);
    const outline = JSON.parse(after.outline) as typeof OUTLINE;
    expect(outline.centralQuestion).toBe("Câu hỏi mới?");
    expect(outline.beats[1]).toEqual({ ...OUTLINE.beats[1], concreteMoment: "Khoảnh khắc sửa" });
    expect(outline.beats[0]).toEqual(OUTLINE.beats[0]);
    expect(outline.promise).toBe(OUTLINE.promise);
    expect(outline.framework).toBe(OUTLINE.framework);
    expect(after.phase).toBe("outline_ready");
    expect(after.hook_candidates).toBe(before.hook_candidates);
    expect(after.input_hash).toBe(before.input_hash);
    sqlite.close();
  });

  it("with only a beat in the body, the central question stays as it was", async () => {
    const { project, sqlite } = await parkWith(OUTLINE);
    const response = await app.inject({
      method: "POST",
      url: editUrl(project.id),
      payload: { beats: [{ id: "b1", concreteMoment: "Chỉ đổi khoảnh khắc" }] },
    });
    expect(response.statusCode).toBe(200);
    const outline = JSON.parse(draftRow(sqlite, project.id).outline) as typeof OUTLINE;
    expect(outline.centralQuestion).toBe(OUTLINE.centralQuestion);
    expect(outline.beats[0]!.concreteMoment).toBe("Chỉ đổi khoảnh khắc");
    sqlite.close();
  });

  it("an approved outline (phase outline_approved) returns 409 INVALID_PIPELINE_STATE and writes nothing", async () => {
    const { project, sqlite } = await parkWith(OUTLINE, "outline_approved");
    const before = draftRow(sqlite, project.id).outline;
    const response = await app.inject({ method: "POST", url: editUrl(project.id), payload: { centralQuestion: "Không được ghi" } });
    expect({ status: response.statusCode, body: response.body }).toMatchObject({ status: 409 });
    expect(response.body).toContain("INVALID_PIPELINE_STATE");
    expect(draftRow(sqlite, project.id).outline).toBe(before);
    sqlite.close();
  });

  it("no draft at all returns 409 INVALID_PIPELINE_STATE", async () => {
    const project = (await app.inject({ method: "POST", url: "/api/projects", payload: { title: "No draft", topic: "Outline" } })).json<Project>();
    const sqlite = new Database(config.DATABASE_PATH);
    sqlite.prepare("INSERT OR REPLACE INTO project_stages (project_id, stage, state, progress, updated_at) VALUES (?, 'SCRIPT', 'WAITING_USER', 0, ?)").run(project.id, new Date().toISOString());
    const response = await app.inject({ method: "POST", url: editUrl(project.id), payload: { centralQuestion: "Không có bản nháp" } });
    expect({ status: response.statusCode, body: response.body }).toMatchObject({ status: 409 });
    expect(response.body).toContain("INVALID_PIPELINE_STATE");
    sqlite.close();
  });

  it("an unknown beat id returns 404 BEAT_NOT_FOUND and writes nothing, even when another beat in the same request is valid", async () => {
    const { project, sqlite } = await parkWith(OUTLINE);
    const before = draftRow(sqlite, project.id).outline;
    const response = await app.inject({
      method: "POST",
      url: editUrl(project.id),
      payload: { centralQuestion: "Không được ghi", beats: [{ id: "b1", concreteMoment: "Hợp lệ" }, { id: "nope", concreteMoment: "Sai" }] },
    });
    expect({ status: response.statusCode, body: response.body }).toMatchObject({ status: 404 });
    expect(response.body).toContain("BEAT_NOT_FOUND");
    expect(draftRow(sqlite, project.id).outline).toBe(before);
    sqlite.close();
  });

  it("empty, whitespace-only and over-length text returns 400 and writes nothing", async () => {
    const { project, sqlite } = await parkWith(OUTLINE);
    const before = draftRow(sqlite, project.id).outline;
    const bodies = [
      { centralQuestion: "" },
      { centralQuestion: "   " },
      { centralQuestion: "x".repeat(4001) },
      { beats: [{ id: "b1", concreteMoment: "" }] },
      { beats: [{ id: "b1", concreteMoment: "   " }] },
      { beats: [{ id: "b1", concreteMoment: "y".repeat(4001) }] },
    ];
    for (const payload of bodies) {
      const response = await app.inject({ method: "POST", url: editUrl(project.id), payload });
      expect({ payload: Object.keys(payload), status: response.statusCode }).toMatchObject({ status: 400 });
    }
    expect(draftRow(sqlite, project.id).outline).toBe(before);
    sqlite.close();
  });

  it("any key other than centralQuestion, beats, id and concreteMoment returns 400 and writes nothing", async () => {
    const { project, sqlite } = await parkWith(OUTLINE);
    const before = draftRow(sqlite, project.id).outline;
    const bodies: unknown[] = [
      { centralQuestion: "ok", promise: "không được sửa" },
      { beats: [{ id: "b1", concreteMoment: "ok", purpose: "reveal" }] },
      { beats: [{ id: "b1", concreteMoment: "ok", targetSec: 99 }] },
      { beats: [{ id: "b1", concreteMoment: "ok", emotion: "tense" }] },
    ];
    for (const payload of bodies) {
      const response = await app.inject({ method: "POST", url: editUrl(project.id), payload: payload as object });
      expect({ payload, status: response.statusCode }).toMatchObject({ status: 400 });
    }
    expect(draftRow(sqlite, project.id).outline).toBe(before);
    sqlite.close();
  });

  it("an empty body returns 400 NOTHING_TO_EDIT and writes nothing", async () => {
    const { project, sqlite } = await parkWith(OUTLINE);
    const before = draftRow(sqlite, project.id).outline;
    const response = await app.inject({ method: "POST", url: editUrl(project.id), payload: {} });
    expect({ status: response.statusCode, body: response.body }).toMatchObject({ status: 400 });
    expect(response.body).toContain("NOTHING_TO_EDIT");
    expect(draftRow(sqlite, project.id).outline).toBe(before);
    sqlite.close();
  });
});
