import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Project } from "@vg/shared";
import { buildApp } from "../src/app.js";
import { parseConfig, type AppConfig } from "../src/lib/config.js";
import { MockTtsProvider } from "../src/providers/tts/mockTts.js";

const root = mkdtempSync(join(tmpdir(), "vg-voice-api-"));
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
    TTS_PROVIDER: "mock",
  });
  app = buildApp({ config });
  const created = await app.inject({
    method: "POST",
    url: "/api/projects",
    payload: { topic: "Voice API fixture", settings: { budget: { mode: "ECO" } } },
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
     VALUES (?, ?, 0, 'section', NULL, 'Voice fixture', 'Hello there.', '', ?, '', 'medium', 3, NULL, 0, '', 'AGENT', 0, 'fixture', ?, ?)`,
  ).run(sceneId, project.id, JSON.stringify({ primary: "", alternatives: [], queryVariant: false }), now, now);
});

afterEach(async () => {
  sqlite.close();
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("voice API", () => {
  it("lists voices, summarizes missing tracks, regenerates, streams ranges, uploads, and marks downstream stages stale", async () => {
    const voices = await app.inject({ method: "GET", url: "/api/tts/voices" });
    expect(voices.statusCode).toBe(200);
    expect(voices.json().voices).toContainEqual({ language: "vi", gender: "female", name: "vi-VN-HoaiMyNeural", multilingual: false });

    const empty = await app.inject({ method: "GET", url: `/api/projects/${project.id}/voice` });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toMatchObject({ missingSceneIds: [sceneId], tracks: [], totalDurationSec: 0 });

    await app.inject({ method: "GET", url: `/api/projects/${project.id}/pipeline` });
    sqlite.prepare("UPDATE project_stages SET state = 'DONE', progress = 100 WHERE project_id = ?").run(project.id);
    const regenerated = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/scenes/${sceneId}/voice/regenerate`,
      payload: { rate: "+10%" },
    });
    expect(regenerated.statusCode).toBe(200);
    expect(regenerated.json()).toMatchObject({ sceneId, provider: "mock", origin: "AGENT", rate: "+10%" });

    const trackId = regenerated.json().id as string;
    const ranged = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/voice/${trackId}/audio`,
      headers: { range: "bytes=0-3" },
    });
    expect(ranged.statusCode).toBe(206);
    expect(ranged.headers["content-range"]).toMatch(/^bytes 0-3\//);
    expect(ranged.headers["content-type"]).toBe("audio/wav");
    expect(ranged.rawPayload.length).toBe(4);
    expect(sqlite.prepare("SELECT state FROM project_stages WHERE project_id = ? AND stage = 'MUSIC_SEARCH'").get(project.id))
      .toEqual({ state: "STALE" });

    const fixturePath = join(root, "fixture.wav");
    await new MockTtsProvider().synthesize({ text: "Uploaded wav.", voice: "mock", rate: "+0%", outPath: fixturePath });
    const fixture = readFileSync(fixturePath);
    const boundary = "vg-voice-upload-boundary";
    const prefix = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="voice.wav"\r\nContent-Type: audio/wav\r\n\r\n`);
    const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
    const uploaded = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/scenes/${sceneId}/voice/upload`,
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.concat([prefix, fixture, suffix]),
    });
    expect(uploaded.statusCode).toBe(200);
    expect(uploaded.json()).toMatchObject({ sceneId, origin: "USER", provider: "USER" });

    const summary = await app.inject({ method: "GET", url: `/api/projects/${project.id}/voice` });
    expect(summary.json()).toMatchObject({ missingSceneIds: [], tracks: [{ id: uploaded.json().id, origin: "USER" }] });
  });
});
