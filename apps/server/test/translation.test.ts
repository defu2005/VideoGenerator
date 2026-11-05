import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { parseConfig, type AppConfig } from "../src/lib/config.js";

const root = mkdtempSync(join(tmpdir(), "vg-translate-"));
let config: AppConfig;
let app: ReturnType<typeof buildApp>;

beforeAll(() => {
  config = parseConfig({
    DATA_DIR: join(root, "data"),
    DATABASE_PATH: join(root, "translate.db"),
    PORT: "3001",
    HOST: "127.0.0.1",
    LOG_LEVEL: "silent",
    CORS_ORIGIN: "http://localhost:5173",
    LLM_ENABLE_MOCK: "true",
    LLM_DEFAULT_PROVIDER: "mock",
    TTS_PROVIDER: "mock",
    WORKER_ENABLED: "false",
    JOB_MAX_ATTEMPTS: "3",
    JOB_RETRY_BASE_MS: "10",
    FAKE_STAGE_DELAY_MS: "0",
  });
});

beforeEach(() => {
  const dataDir = join(root, `data-${randomUUID()}`);
  mkdirSync(dataDir, { recursive: true });
  config = { ...config, DATA_DIR: dataDir, DATABASE_PATH: join(dataDir, "app.db") };
  app = buildApp({ config });
});

afterEach(async () => {
  await app.close();
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function sqlite() {
  return (app.vgClips as unknown as { sqlite: import("better-sqlite3").Database }).sqlite;
}

async function finishedProject(profileId: string): Promise<{ projectId: string; sceneIds: string[]; audioPath: string }> {
  const created = await app.inject({
    method: "POST",
    url: "/api/projects",
    payload: { topic: "Lịch sử Đông Sơn", title: "Đông Sơn", profileId, language: "vi" },
  });
  expect(created.statusCode).toBe(201);
  const projectId = created.json<{ id: string }>().id;
  sqlite().prepare("UPDATE projects SET status = 'COMPLETED', stage = 'RENDER' WHERE id = ?").run(projectId);
  const now = new Date().toISOString();
  const sceneIds = [randomUUID(), randomUUID()];
  const audioPath = join(config.DATA_DIR, "parent-voice.wav");
  writeFileSync(audioPath, "voice");
  sceneIds.forEach((id, index) => {
    sqlite().prepare(
      `INSERT INTO scenes (
        id, project_id, "order", kind, label, narration, visual_notes, visual_description, no_visual,
        visual_queries, music_mood, energy, est_duration_sec, start_sec, transition_note, origin, edited, input_hash, created_at, updated_at
      ) VALUES (?, ?, ?, 'narration', ?, ?, '', '', 1, '{"primary":"","alternatives":[]}', '', 'medium', 2, 0, '', 'AGENT', 0, ?, ?, ?)`,
    ).run(id, projectId, index, `Cảnh ${index + 1}`, index === 0 ? "Trống đồng." : "Mũi tên đồng.", hash(id), now, now);
    sqlite().prepare(
      `INSERT INTO voice_tracks (
        id, project_id, scene_id, provider, voice, rate, origin, audio_path, duration_sec, cues, input_hash, narration_hash, created_at, updated_at
      ) VALUES (?, ?, ?, 'mock', 'vi-VN-HoaiMyNeural', '+0%', 'AGENT', ?, 2, '[]', ?, ?, ?, ?)`,
    ).run(randomUUID(), projectId, id, audioPath, hash(id), hash("narration"), now, now);
  });
  return { projectId, sceneIds, audioPath };
}

function hash(value: string): string {
  return value;
}

describe("translation children", () => {
  it("keeps scene ids, shortens once, and stops at one review gate when automation is off", async () => {
    const profile = await app.inject({
      method: "POST",
      url: "/api/profiles",
      payload: {
        name: `Dịch ${randomUUID().slice(0, 6)}`,
        direction: "Lịch sử",
        language: "vi",
        translations: [{ language: "en", accountIds: [], mode: "dub" }],
      },
    });
    expect(profile.statusCode).toBe(201);
    const profileId = profile.json<{ id: string }>().id;
    const { projectId, sceneIds } = await finishedProject(profileId);
    const started = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/translations`,
      payload: { language: "en" },
    });
    expect(started.statusCode).toBe(200);
    const body = started.json<{ childId: string; waitingReview: boolean; shortenCalls: number }>();
    expect(body.waitingReview).toBe(true);
    expect(body.shortenCalls).toBe(1);
    const script = sqlite().prepare("SELECT data FROM scripts WHERE project_id = ?").get(body.childId) as { data: string };
    const sections = (JSON.parse(script.data) as { sections: Array<{ id: string }> }).sections;
    expect(sections.map((section) => section.id)).toEqual(sceneIds);
    const gates = sqlite().prepare(
      "SELECT stage, message FROM project_stages WHERE project_id = ? AND state = 'WAITING_USER'",
    ).all(body.childId) as Array<{ stage: string; message: string }>;
    expect(gates).toEqual([{ stage: "SCRIPT", message: "Duyệt bản dịch" }]);
  });

  it("runs without a gate, retimes to the new voice, and trims metadata when automation is on", async () => {
    const profile = await app.inject({
      method: "POST",
      url: "/api/profiles",
      payload: {
        name: `Auto dịch ${randomUUID().slice(0, 6)}`,
        direction: "Lịch sử",
        language: "vi",
        automation: { enabled: true, timezone: "Asia/Ho_Chi_Minh", videosPerDay: 1, publishTimes: ["19:00"] },
        translations: [{ language: "en", accountIds: [], mode: "dub", voice: "en-US-AriaNeural" }],
      },
    });
    const profileId = profile.json<{ id: string }>().id;
    const { projectId } = await finishedProject(profileId);
    const started = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/translations`,
      payload: { language: "en" },
    });
    expect(started.statusCode).toBe(200);
    const childId = started.json<{ childId: string; waitingReview: boolean }>().childId;
    expect(started.json<{ waitingReview: boolean }>().waitingReview).toBe(false);
    const gates = sqlite().prepare(
      "SELECT COUNT(*) AS total FROM project_stages WHERE project_id = ? AND state = 'WAITING_USER'",
    ).get(childId) as { total: number };
    expect(gates.total).toBe(0);

    const voices = sqlite().prepare(
      "SELECT scene_id, duration_sec FROM voice_tracks WHERE project_id = ?",
    ).all(childId) as Array<{ scene_id: string; duration_sec: number }>;
    const timeline = JSON.parse((sqlite().prepare("SELECT data FROM timelines WHERE project_id = ?").get(childId) as { data: string }).data) as {
      scenes: Array<{ sceneId: string; durationSec: number; voice: { durationSec: number } | null }>;
    };
    expect(voices.length).toBe(2);
    for (const voice of voices) {
      const scene = timeline.scenes.find((item) => item.sceneId === voice.scene_id);
      expect(scene?.voice?.durationSec).toBeCloseTo(voice.duration_sec, 2);
      expect(scene!.durationSec).toBeGreaterThanOrEqual(voice.duration_sec);
      expect(scene!.durationSec).toBeLessThan(voice.duration_sec + 1);
    }
    const draft = JSON.parse((sqlite().prepare("SELECT draft FROM video_metadata WHERE project_id = ?").get(childId) as { draft: string }).draft) as {
      titles: string[];
      description: string;
    };
    expect(draft.titles[0]!.length).toBeLessThanOrEqual(100);
    expect(draft.description.length).toBeLessThanOrEqual(1500);
  });

  it("keeps the original audio when the mode is subtitles only", async () => {
    const profile = await app.inject({
      method: "POST",
      url: "/api/profiles",
      payload: {
        name: `Sub ${randomUUID().slice(0, 6)}`,
        direction: "Lịch sử",
        language: "vi",
        automation: { enabled: true, timezone: "Asia/Ho_Chi_Minh", videosPerDay: 1, publishTimes: ["19:00"] },
        translations: [{ language: "en", accountIds: [], mode: "subtitles_only" }],
      },
    });
    const profileId = profile.json<{ id: string }>().id;
    const { projectId, audioPath } = await finishedProject(profileId);
    const started = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/translations`,
      payload: { language: "en" },
    });
    expect(started.statusCode).toBe(200);
    const childId = started.json<{ childId: string }>().childId;
    const paths = sqlite().prepare("SELECT audio_path FROM voice_tracks WHERE project_id = ?").all(childId) as Array<{ audio_path: string }>;
    expect(paths.every((row) => row.audio_path === audioPath)).toBe(true);
  });
});
